/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { Type, GoogleGenAI } from '@google/genai';
import { generateContentWithFallback, getApiKey, createGoogleGenAIClient, checkCredits, deductCredits } from './core';
import { sanitizeAndParseJson, wrapContentForApi } from '../utils';
import { safeJsonStringify } from '../utils-core';
import { PRIMARY_MODEL, SECONDARY_MODEL, TERTIARY_MODEL } from '../constants';

export async function extractCharacterWithTimelineContext(storyText: string, _skipPerspectiveCheck = false) {
    // Truncate story text to avoid hitting token limits or triggering safety filters on long content
    const truncatedStory = storyText.length > 15000 ? storyText.substring(0, 15000) + "..." : storyText;
    const framedStory = wrapContentForApi(truncatedStory);
    
    if (!_skipPerspectiveCheck) {
        const isFirstPerson = await detectNarrativePerspective(framedStory);
        if (!isFirstPerson) {
            throw new Error('Story is not first-person. Use extractOtherCharacters instead.');
        }
    }

    const prompt = `
Analyze this first-person narrative and extract the narrator's appearance at different life stages.

STORY:
${framedStory}

Provide a JSON profile that includes:

{
  "narratorProfile": {
    "currentAge": "narrator's age when telling the story (e.g., 'late 60s')",
    "currentDescription": "detailed visual description of narrator at current age, formatted exactly with two sections: a compact paragraph of identity anchors, followed by a new line starting with 'Never:' listing 4-8 hard locks.",
    "gender": "male/female/ambiguous",
    "name": "The Narrator"
  },
  "lifeStages": [
    {
      "ageRange": "e.g., 'late 20s to early 30s'",
      "period": "e.g., 'early career', 'young parent'",
      "visualDescription": "how they looked at this age, formatted exactly with two sections: a compact paragraph of identity anchors, followed by a new line starting with 'Never:' listing 4-8 hard locks.",
      "contextKeywords": ["keywords that indicate this timeframe in scenes"]
    },
    {
      "ageRange": "e.g., 'mid 40s to early 50s'",
      "period": "e.g., 'mid-career', 'established professional'",
      "visualDescription": "how they looked at this age, formatted exactly with two sections: a compact paragraph of identity anchors, followed by a new line starting with 'Never:' listing 4-8 hard locks.",
      "contextKeywords": ["keywords that indicate this timeframe"]
    }
  ],
  "symbolicScenes": {
    "description": "scenes that are metaphorical/abstract and shouldn't show the character literally",
    "indicators": ["keywords that suggest symbolic rather than literal scenes"]
  }
}

GUIDELINES:
- Current age is when they're reflecting/telling the story (usually the dominant timeframe)
- Life stages should cover major periods mentioned in the story
- Include keywords like "twenty years ago", "when I was younger", "in my thirties", etc.
- Symbolic scenes might include: abstract concepts, close-ups of objects, environmental shots without people
- Visual descriptions MUST follow this exact format:
  Male, late 50s. Bald, thick gray beard. Sun-weathered olive skin, long angular face, dark eyes. Lean, rugged, upright. Rough wool prophetic mantle over simple earth-toned tunic.
  Never: hair on scalp, clean-shaven, young, modern or royal clothing.

Return ONLY valid JSON.
`;

    try {
        const response = await generateContentWithFallback({
            model: PRIMARY_MODEL,
            contents: prompt,
            mimeType: "application/json",
            schema: {
                type: Type.OBJECT,
                properties: {
                    narratorProfile: {
                        type: Type.OBJECT,
                        properties: {
                            currentAge: { type: Type.STRING },
                            currentDescription: { type: Type.STRING },
                            gender: { type: Type.STRING },
                            name: { type: Type.STRING }
                        },
                        required: ["currentAge", "currentDescription", "gender", "name"]
                    },
                    lifeStages: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                ageRange: { type: Type.STRING },
                                period: { type: Type.STRING },
                                visualDescription: { type: Type.STRING },
                                contextKeywords: {
                                    type: Type.ARRAY,
                                    items: { type: Type.STRING }
                                }
                            },
                             required: ["ageRange", "period", "visualDescription", "contextKeywords"]
                        }
                    },
                    symbolicScenes: {
                        type: Type.OBJECT,
                        properties: {
                            description: { type: Type.STRING },
                            indicators: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING }
                            }
                        },
                         required: ["description", "indicators"]
                    }
                },
                 required: ["narratorProfile", "lifeStages", "symbolicScenes"]
            },
            maxOutputTokens: 8192
        });
 
        return sanitizeAndParseJson(response.text ?? '{}');
    } catch (error: any) {
        console.error('Character timeline extraction error:', error);
        if (error?.name === 'SafetyError' || /prohibited_content|blocked|safety|policy/i.test(error?.message || String(error))) {
            return {
                narratorProfile: {
                    currentAge: "adult",
                    currentDescription: "The narrator. Confident, grounded presence, natural features and attire.\nNever: modern or out-of-place clothing, distorted features, extra limbs.",
                    gender: "ambiguous",
                    name: "The Narrator"
                },
                lifeStages: [],
                symbolicScenes: { description: "Symbolic scenes.", indicators: [] }
            };
        }
        throw error;
    }
}

export async function analyzeSceneForCharacter(sceneText: string, characterTimeline: any) {
  const prompt = `
Given this scene from a first-person narrative and the narrator's character timeline, determine:

SCENE TEXT:
"${sceneText}"

CHARACTER TIMELINE:
${safeJsonStringify(characterTimeline, 2)}

Analyze and return JSON:

{
  "shouldShowCharacter": true/false,
  "reasoning": "why character should or shouldn't appear",
  "characterAge": "which age from timeline fits this scene (or null if no character)",
  "sceneType": "literal" | "symbolic" | "environmental" | "memory",
  "visualFocus": "what should be the main focus of the image"
}

RULES:
- "literal": Character is physically present in the scene's action
- "symbolic": Scene depicts concepts/metaphors (calendar, hourglass, files) - usually NO character
- "environmental": Scene shows setting/atmosphere without character
- "memory": Flashback scene - use younger character age
- shouldShowCharacter = false for: close-ups of objects, abstract concepts, pure environmental shots
- shouldShowCharacter = true for: scenes describing character's actions, feelings, interactions

Examples:
- "I sat at my desk looking at the calendar" → literal, current age, true
- "The hourglass sat on the desk, sand slowly falling" → symbolic, no age, false  
- "In my thirties, I told myself I'd travel" → memory, early career age, true
- "My kids remember me as present but distracted" → memory, mid-career age, true
- "The file labeled 'LATER' gathered dust" → symbolic, no age, false

Return ONLY valid JSON.
`;

  try {
    const response = await generateContentWithFallback({
        model: SECONDARY_MODEL, // Use faster model for this task
        contents: prompt,
        mimeType: "application/json",
        schema: {
            type: Type.OBJECT,
            properties: {
                shouldShowCharacter: { type: Type.BOOLEAN },
                reasoning: { type: Type.STRING },
                characterAge: { type: Type.STRING, description: "Can be null" },
                sceneType: { type: Type.STRING, enum: ["literal", "symbolic", "environmental", "memory"] },
                visualFocus: { type: Type.STRING }
            },
            required: ["shouldShowCharacter", "reasoning", "sceneType", "visualFocus"]
        },
        maxOutputTokens: 2048
    });

    return sanitizeAndParseJson(response.text ?? '{}');
  } catch (error) {
    console.error('Scene analysis error:', error);
    // Provide a sensible fallback
    return { 
        shouldShowCharacter: false, 
        sceneType: 'symbolic', 
        visualFocus: sceneText,
        characterAge: null,
        reasoning: 'Analysis failed, defaulting to no character.'
    };
  }
}

export async function batchAnalyzeScenesForCharacter(scenesText: string[], characterTimeline: any) {
  const prompt = `
Given these scenes from a first-person narrative and the narrator's character timeline, determine for EACH scene:

CHARACTER TIMELINE:
${safeJsonStringify(characterTimeline, 2)}

SCENES:
${scenesText.map((text, i) => `[Scene ${i}]: "${text}"`).join('\n')}

Analyze and return JSON:

{
  "results": [
    {
      "sceneIndex": 0,
      "shouldShowCharacter": true,
      "reasoning": "why character should or shouldn't appear",
      "characterAge": "which age from timeline fits this scene (or null if no character)",
      "sceneType": "literal",
      "visualFocus": "what should be the main focus of the image"
    }
  ]
}

RULES:
- "literal": Character is physically present in the scene's action
- "symbolic": Scene depicts concepts/metaphors (calendar, hourglass, files) - usually NO character
- "environmental": Scene shows setting/atmosphere without character
- "memory": Flashback scene - use younger character age
- shouldShowCharacter = false for: close-ups of objects, abstract concepts, pure environmental shots
- shouldShowCharacter = true for: scenes describing character's actions, feelings, interactions

Return ONLY valid JSON.
`;

  try {
    const response = await generateContentWithFallback({
        model: SECONDARY_MODEL,
        contents: prompt,
        mimeType: "application/json",
        schema: {
            type: Type.OBJECT,
            properties: {
                results: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            sceneIndex: { type: Type.NUMBER },
                            shouldShowCharacter: { type: Type.BOOLEAN },
                            reasoning: { type: Type.STRING },
                            characterAge: { type: Type.STRING, description: "Can be null" },
                            sceneType: { type: Type.STRING, enum: ["literal", "symbolic", "environmental", "memory"] },
                            visualFocus: { type: Type.STRING }
                        },
                        required: ["sceneIndex", "shouldShowCharacter", "reasoning", "sceneType", "visualFocus"]
                    }
                }
            },
            required: ["results"]
        },
        maxOutputTokens: 8192
    });

    const parsed = sanitizeAndParseJson(response.text ?? '{}');
    return parsed.results || [];
  } catch (error) {
    console.error('Batch scene analysis error:', error);
    return scenesText.map((text, i) => ({
        sceneIndex: i,
        shouldShowCharacter: false, 
        sceneType: 'symbolic', 
        visualFocus: text,
        characterAge: null,
        reasoning: 'Analysis failed, defaulting to no character.'
    }));
  }
}

export async function detectNarrativePerspective(story: string): Promise<boolean> {
    const prompt = `Analyze the narrative perspective of this story. 
    
    Is it written in the FIRST-PERSON perspective (where the narrator is a character in the story referring to themselves as "I", "me", "my", "we", "us", "our" OUTSIDE of dialogue)?
    
    CRITICAL: Ignore any first-person pronouns that appear ONLY inside quotation marks (dialogue). Focus on the narration itself.
    
    STORY (first 3000 chars):
    ${story.substring(0, 3000)}
    
    Return JSON: { "isFirstPerson": true/false, "confidence": 0.0-1.0 }`;

    try {
        const response = await generateContentWithFallback({
            model: TERTIARY_MODEL, // Fast model for simple classification
            contents: prompt,
            mimeType: "application/json",
            schema: {
                type: Type.OBJECT,
                properties: {
                    isFirstPerson: { type: Type.BOOLEAN },
                    confidence: { type: Type.NUMBER }
                },
                required: ["isFirstPerson", "confidence"]
            }
        });
        
        const result = sanitizeAndParseJson(response.text ?? '{}');
        return result.isFirstPerson && result.confidence > 0.7;
    } catch (error) {
        console.error('Perspective detection failed, defaulting to third-person:', error);
        return false; // safe default → routes to extractOtherCharacters
    }
}

export async function extractCharacters(storyText: string, isFirstPersonOverride?: boolean) {
    const isFirstPerson = isFirstPersonOverride ?? await detectNarrativePerspective(storyText);
    
    if (isFirstPerson) {
        try {
            const timeline = await extractCharacterWithTimelineContext(storyText, true);
            const otherChars = await extractContextualCharacters(storyText);
            return {
                type: 'narrator' as const,
                timeline,
                otherCharacters: otherChars
            };
        } catch (error) {
            console.error('Narrator extraction failed, falling back to standard extraction:', error);
            const characters = await extractContextualCharacters(storyText);
            return {
                type: 'characters' as const,
                characters
            };
        }
    } else {
        const characters = await extractContextualCharacters(storyText);
        return {
            type: 'characters' as const,
            characters
        };
    }
}

export async function extractOtherCharacters(storyText: string) {
    // Truncate story text to avoid hitting token limits or triggering safety filters on long content
    const truncatedStory = storyText.length > 15000 ? storyText.substring(0, 15000) + "..." : storyText;
    const framedStory = wrapContentForApi(truncatedStory);

    const prompt = `
Analyze the story below and extract every named character.
For each named character, output:
- name (full canonical name)
- aliases: array of all first names, last names, titles, and nicknames used in the story (e.g. ["Joseph", "Bates", "Captain Bates"])
- appearance_anchor

appearance_anchor must be a compact, production-ready description of stable visual traits for image consistency.
It MUST be formatted exactly with two sections: a compact paragraph of identity anchors, followed by a new line starting with "Never:" listing 4-8 hard locks.

Example format:
Male, late 50s. Bald, thick gray beard. Sun-weathered olive skin, long angular face, dark eyes. Lean, rugged, upright. Rough wool prophetic mantle over simple earth-toned tunic.
Never: hair on scalp, clean-shaven, young, modern or royal clothing.

Include only:
apparent age, gender presentation only if clearly implied, skin tone, face shape, hair, eyes, build, height, posture, defining marks, and default clothing style.

Rules:
- Do NOT infer ethnicity, religion, nationality, disability, or other sensitive traits unless explicitly stated.
- If details are missing, make a conservative visual production choice rather than writing "unspecified" for every field.
- The goal is visual consistency across repeated image generations.
- Add 4–8 constraints after "Never:" for traits that would break character identity.
- Do NOT include mood, actions, camera, lighting, location, props, or backstory.

Return a JSON object with a "characters" array.

Story:
"""
${framedStory}
"""
`;

    try {
        const response = await generateContentWithFallback({
            model: TERTIARY_MODEL,
            contents: prompt,
            systemInstruction: "You are a structured data extraction assistant. Always return valid JSON matching the schema. Never return empty responses.",
            mimeType: "application/json",
            schema: {
                type: Type.OBJECT,
                properties: {
                    characters: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                aliases: { 
                                    type: Type.ARRAY,
                                    items: { type: Type.STRING }
                                },
                                appearance_anchor: { type: Type.STRING }
                            },
                            required: ["name", "appearance_anchor"]
                        }
                    }
                },
                required: ["characters"]
            }
        });

        const result = sanitizeAndParseJson(response.text ?? '{}');
        return result.characters || [];
    } catch (error) {
        console.error("Error extracting other characters:", error);
        return [];
    }
}

export async function extractContextualCharacters(storyText: string) {
    const truncatedStory = storyText.length > 15000 
        ? storyText.substring(0, 15000) + "..." 
        : storyText;
    const framedStory = wrapContentForApi(truncatedStory);

    const prompt = `
Analyze the story below and extract ALL significant characters (including humans, animals, insects, robots) —
both named AND unnamed recurring figures.

For unnamed characters, create a descriptive role name 
(e.g. "Market Woman", "Chicago Baby", "Western Researcher").

For EACH character, you MUST use ALL available context clues to determine appearance:
- Geographic location (story set in Ghana → Black West African characters)
- Cultural context (West African market → traditional clothing)
- Time period, social setting, profession
- Any explicit physical descriptions

You ARE allowed and ENCOURAGED to infer race, ethnicity, and skin tone 
from geographic and cultural story context. This is essential for 
visual accuracy and cultural representation.

Format each appearance_anchor with:
1. A compact identity paragraph including: gender, age range, skin tone, 
   facial features, hair, build, clothing
2. A new line starting with "Never:" listing 4-8 hard visual locks

Example for a character in a West African market story:
Market Woman: Black West African woman, late 20s to early 30s. 
Deep brown skin, round face, dark brown eyes, black hair wrapped 
in colorful fabric. Medium build, wearing vibrant printed kente-style 
wrap dress with baby strapped to back in matching cloth.
Never: light skin, Western clothing, baby carrier device, seated alone.

Return JSON with a "characters" array. Each character needs:
- name (role name if unnamed, e.g. "Market Woman", or full name e.g. "Joseph Bates")  
- aliases: array of first names, last names, titles, or nicknames used in the story
- appearance_anchor (full visual description)
- role_keywords: 3-6 SPECIFIC phrases that uniquely identify this 
  character and would NOT match other characters in the same story.
  
  BAD: ["woman", "she", "her baby"]  ← too generic, matches everyone
  GOOD: ["selling fabric", "Accra market", "baby strapped with cloth", 
         "West African market"]  ← unique to this specific character
  
  If two characters share similar descriptions (e.g. two women), 
  ensure their keywords are drawn from their SPECIFIC scene context, 
  not shared generic words.
- location_context (the geographic/cultural setting that informs 
  their appearance)

Story:
"""
${framedStory}
"""
`;

    try {
        const response = await generateContentWithFallback({
            model: PRIMARY_MODEL,
            contents: prompt,
            systemInstruction: "You are a cultural consultant and character designer. Extract characters with full demographic accuracy based on story context. Never default to generic or Western appearance when cultural context is clear.",
            mimeType: "application/json",
            schema: {
                type: Type.OBJECT,
                properties: {
                    characters: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                aliases: {
                                    type: Type.ARRAY,
                                    items: { type: Type.STRING }
                                },
                                appearance_anchor: { type: Type.STRING },
                                role_keywords: { 
                                    type: Type.ARRAY, 
                                    items: { type: Type.STRING } 
                                },
                                location_context: { type: Type.STRING }
                            },
                            required: ["name", "appearance_anchor", 
                                       "role_keywords", "location_context"]
                        }
                    }
                },
                required: ["characters"]
            },
            maxOutputTokens: 8192
        });

        const result = sanitizeAndParseJson(response.text ?? '{}');
        return result.characters || [];
    } catch (error) {
        console.error("Error extracting contextual characters:", error);
        return [];
    }
}

export async function analyzeCharacterAppearance(image: { data: string, mimeType: string }): Promise<string> {
    const prompt = `You are an expert character designer and prompt engineer for text-to-image AI. Your task is to analyze the provided character image and extract ONLY their intrinsic physical traits and clothing.

**DO NOT** describe the background, the pose, the lighting, or the artistic style. Your focus is purely on the character's stable visual design.

Generate a concise, highly detailed, comma-separated list of physical traits, clothing, and defining features. This will be used as a stable 'appearance anchor' to generate consistent images of this character.
Focus on:
- Age, gender, ethnicity/race, body type
- Facial features, hair style and color, eye color
- Specific clothing items, colors, and accessories
- Any distinct markings or defining characteristics

The output must be a single paragraph of keywords ready to be used in another AI image generator.`;

    const response = await generateContentWithFallback({
        model: SECONDARY_MODEL,
        contents: { parts: [{ inlineData: image }, { text: prompt }] }
    });

    return response.text?.trim() || '';
}
