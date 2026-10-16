import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateAssets() {
    try {
        console.log('Generating app icon...');
        const iconResponse = await ai.models.generateContent({
            model: 'gemini-3.0-flash-image',
            contents: 'A sleek, modern, minimalist app icon for an AI storyboard and video generation application called "ContentGen AI". The icon should feature a glowing cinematic film reel or camera lens motif, dark background, vibrant cyan and fuchsia neon accents, highly detailed, 2d vector art style, flat design, no text, rounded corners.',
            config: {
                imageConfig: {
                    aspectRatio: "1:1"
                }
            }
        });
        
        for (const part of iconResponse.candidates[0].content.parts) {
            if (part.inlineData) {
                const base64Data = part.inlineData.data;
                const publicDir = path.join(process.cwd(), 'public');
                if (!fs.existsSync(publicDir)) {
                    fs.mkdirSync(publicDir, { recursive: true });
                }
                const iconPath = path.join(publicDir, 'icon.png');
                fs.writeFileSync(iconPath, Buffer.from(base64Data, 'base64'));
                console.log(`Icon generated successfully at ${iconPath}`);
                break;
            }
        }

        console.log('Generating app logo...');
        const logoResponse = await ai.models.generateContent({
            model: 'gemini-3.0-flash-image',
            contents: 'A sleek, modern, horizontal logo for an AI storyboard and video generation application called "ContentGen AI". The logo should feature the text "ContentGen AI" in a futuristic, clean sans-serif font, accompanied by a glowing cinematic film reel or camera lens motif. Dark background, vibrant cyan and fuchsia neon accents, highly detailed, 2d vector art style, flat design.',
            config: {
                imageConfig: {
                    aspectRatio: "16:9"
                }
            }
        });
        
        for (const part of logoResponse.candidates[0].content.parts) {
            if (part.inlineData) {
                const base64Data = part.inlineData.data;
                const publicDir = path.join(process.cwd(), 'public');
                if (!fs.existsSync(publicDir)) {
                    fs.mkdirSync(publicDir, { recursive: true });
                }
                const logoPath = path.join(publicDir, 'logo.png');
                fs.writeFileSync(logoPath, Buffer.from(base64Data, 'base64'));
                console.log(`Logo generated successfully at ${logoPath}`);
                break;
            }
        }

    } catch (error) {
        console.error('Error generating assets:', error);
    }
}

generateAssets();
