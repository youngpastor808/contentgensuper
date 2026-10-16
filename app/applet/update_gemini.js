const fs = require("fs");
let code = fs.readFileSync("server/routes/gemini.ts", "utf8");
const target = `    const systemInstruction = \`You are a world-class commercial and cinematic film director.Convert the user's idea or script into a structured storyboard sequence with exactly \${sceneCount} distinct scenes.For every scene:- Provide a vivid, punchy title.- Provide a detailed visual description of what appears in frame.- Provide an AI image prompt optimized for text-to-image models (flux/photorealistic).- Provide a voiceover narration script (1-2 sentences).- Provide text overlay content (punchy title or key takeaway, 2-5 words).- Suggest duration in seconds (typically between 3 and 6 seconds).- CRITICAL REQUIREMENT: Do not leave text overlay or voiceover empty for ANY scene. Every single scene, especially the final closing shot (call-to-action or conclusion), MUST have a meaningful text overlay and full voiceover text.\`;`;

const replacement = `    const systemInstruction = \`You are a world-class commercial and cinematic film director.Convert the user's idea or script into a structured storyboard sequence with exactly \${sceneCount} distinct scenes.For every scene:- Provide a vivid, punchy title.- Provide a detailed visual description of what appears in frame.- Provide an AI image prompt optimized for text-to-image models (flux/photorealistic).- Provide a voiceover narration script (1-2 sentences).- Provide text overlay content (punchy title or key takeaway, 2-5 words).- Suggest duration in seconds.- EDITORIAL SHOT CONTRAST (30-DEGREE / FOCAL RULE): Never place two consecutive scenes with the same shot scale or framing. Alternate deliberately between Extreme Wide Establishing (EWS), Medium Action (MS), Close-Up Emotion/Detail (CU), and Low/High-Angle Dynamic shots so every cut feels visually motivated.
- RHYTHMIC PACING ARC: Vary scene durations intentionally rather than making every scene the same length:
  * Scene 1 (Visual Hook): 2.0 to 3.0 seconds — immediate visual intrigue.
  * Middle Scenes (Narrative Build): 3.5 to 5.5 seconds — allow complex visuals to register.
  * Climax / Pattern-Interrupt Beat: 2.0 to 3.0 seconds — punchy cut on high energy.
  * Final Scene (Resolution / Call-to-Action): 4.0 to 5.0 seconds — hold for emotional resonance.
- CRITICAL REQUIREMENT: Do not leave text overlay or voiceover empty for ANY scene. Every single scene, especially the final closing shot (call-to-action or conclusion), MUST have a meaningful text overlay and full voiceover text.\`;`;

if (!code.includes(target)) {
  console.error("Target not found!");
  process.exit(1);
}
code = code.replace(target, replacement);
fs.writeFileSync("server/routes/gemini.ts", code, "utf8");
console.log("Successfully updated gemini.ts");
