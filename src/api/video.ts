/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { generateContentWithFallback, getApiKey, createGoogleGenAIClient, isUsingPersonalKey, checkCredits, deductCredits } from './core';
import { isVideoGenAllowedForCurrentUser } from '../auth';
import { SECONDARY_MODEL, CREDIT_COSTS } from '../constants';
import { state } from '../state';
import { GoogleGenAI } from '@google/genai';

export async function generateVeoStyleVideoPrompt(
    shot: any,
    styleName: string
): Promise<string> {

    const systemInstruction = `You are an expert cinematic image-to-video prompt engineer for AI video models such as Veo.

The input contains:
- a scene description
- a visual style block
- optional story context

Your task is to create an animation prompt that brings the described scene to life without changing its composition, character design, environment, lighting, or art style.

RULES
- Preserve the exact framing, angle, subject identity, wardrobe, props, background, and visual style from the original image prompt.
- Do not rewrite the full image prompt.
- Do not invent new objects or dramatic actions unless strongly implied by the scene.
- Focus on motion only: subject motion, environmental motion, camera motion, and temporal progression.
- Motion must be physically believable and emotionally appropriate.
- Use standard cinematography terms for camera direction.
- Prefer one primary camera move only.
- If the scene is mostly still, use subtle micro-motion instead of forcing large action.

OUTPUT FORMAT

[SCENE MOTION LOGIC]
Briefly explain what should animate in this frame and why.

[ANIMATION PROMPT]
Write one clean generation-ready cinematic paragraph that:
- preserves the original scene description
- describes how the subject moves
- includes facial and body micro-motion
- includes environmental motion
- includes one camera movement
- describes how the shot begins, develops, and ends
- keeps the original visual style fully intact

[NEGATIVE PROMPT]
List only motion and continuity failures to avoid:
flicker, jitter, face morphing, anatomy distortion, extra fingers, warped tools, inconsistent clothing, drifting composition, chaotic motion, broken perspective, style drift, frame deformation, unnatural physics

[MOTION LEVEL]
still / subtle / moderate / dynamic

[DURATION]
3s / 5s / 8s

DECISION RULES
- If the shot is contemplative, use breathing, blinking, dust, fabric sway, slow light shift, or a slow push-in.
- If the shot implies labor or tension, animate hands, posture adjustment, tool interaction, particles, and controlled camera movement.
- If the shot already has a strong composition, avoid excessive camera travel.
- If the style is painterly or illustrated, preserve texture and line consistency while animating motion smoothly.`;

    const userContent = `
Based on the following still image prompt, generate a video animation prompt.

**Still Image Prompt:** ${shot.image_prompt || shot.prompt || ''}
**Narration Context:** ${shot.text_reference || shot.line_text}
**Original Visual Style:** ${styleName}
${shot.camera_movement ? `**Camera Movement:** ${shot.camera_movement.replace(/_/g, ' ')}\n` : ''}

**Emotional AI Prompt Injection:**
Analyze the 'Narration Context' to determine the underlying emotional resonance. Inject this emotion directly into the animation logic:
- **Subjects:** Facial micro-expressions, posture shifts, and eye movements must physically manifest the feeling of the narration.
- **Environment:** Atmospheric motion (e.g. drifting dust, sway of trees, harsh flickers, warm glows) should act as a metaphor for the scene's emotional state.
- **Timing:** Match the pacing of motion (slow/contemplative vs fast/erratic) to the feeling of the text.
- Be explicit in the [ANIMATION PROMPT] about how the scene *feels* in motion.`;

    const response = await generateContentWithFallback({
        model: SECONDARY_MODEL, // flash is good for this kind of structured text generation
        contents: userContent,
        systemInstruction: systemInstruction,
        mimeType: 'text/plain'
    });

    return response.text!;
}

export async function generateVideo(
    prompt: string,
    model?: string,
    imagePart?: { base64: string; mimeType: string }
): Promise<{ uri?: string, base64?: string, mimeType?: string, engine: string }> {
    const hasPersonalKey = isUsingPersonalKey(true);
    if (!isVideoGenAllowedForCurrentUser()) {
        throw new Error('Video generation is disabled for your account. Please ask an administrator to grant you Video Generation access in the Admin Panel or configure your personal Gemini API key in Settings.');
    }
    if (state.systemConfig?.disableSystemVideoGeneration && !hasPersonalKey) {
        throw new Error('System-funded video generation is currently restricted by administrator. Please provide your personal Gemini / Vertex API key in Settings.');
    }

    const finalModel = model || 'veo-3.1-lite-generate-001';
    const isVeo = finalModel.startsWith('veo-');
    const isGemini = finalModel.startsWith('gemini-');

    console.log(`🎬 Starting video generation with model: ${finalModel}`);
    
    if (isVeo) {
        const apiKey = getApiKey();
        const ai = createGoogleGenAIClient(apiKey);
        
        const payload: any = {
            model: finalModel,
            prompt: prompt,
            config: {
                numberOfVideos: 1,
                resolution: '720p',
                aspectRatio: '16:9'
            }
        };

        if (imagePart) {
            payload.image = {
                imageBytes: imagePart.base64,
                mimeType: imagePart.mimeType
            };
        }
        
        let operation = await ai.models.generateVideos(payload);
        
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            operation = await ai.operations.getVideosOperation({operation: operation});
        }
        
        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) throw new Error('No video URI returned from Veo');
        
        // Return the URI directly, we'll fetch it on the client side when needed
        // Or we can fetch it here and return base64, but URI is better for video
        return { uri: downloadLink, engine: 'veo' };
    } else if (isGemini) {
        // Gemini doesn't natively support video generation yet in the same way as Veo,
        // but if it's a specific model that supports it, we would use generateVideos or similar.
        // For now, we'll fallback to Veo if gemini is selected for video, or throw an error.
        throw new Error('Gemini video generation not yet fully implemented in frontend. Please use Veo.');
    }
    
    throw new Error(`Unsupported video model: ${finalModel}`);
}
