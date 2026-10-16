import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateIcon() {
    try {
        console.log('Generating app icon...');
        const response = await ai.models.generateContent({
            model: 'gemini-3.0-flash-image',
            contents: 'A sleek, modern, minimalist app icon for an AI content generation application called "ContentGen AI". The icon should feature a glowing spark or brain motif, dark background, vibrant purple and blue neon accents, highly detailed, 2d vector art style, flat design, no text, rounded corners.',
        });
        
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const base64Data = part.inlineData.data;
                const buildDir = path.join(process.cwd(), 'build');
                if (!fs.existsSync(buildDir)) {
                    fs.mkdirSync(buildDir, { recursive: true });
                }
                const iconPath = path.join(buildDir, 'icon.png');
                fs.writeFileSync(iconPath, Buffer.from(base64Data, 'base64'));
                console.log(`Icon generated successfully at ${iconPath}`);
                break;
            }
        }
    } catch (error) {
        console.error('Error generating icon:', error);
    }
}

generateIcon();
