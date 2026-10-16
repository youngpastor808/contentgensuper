import express from 'express';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import os from 'node:os';
import { pipeline } from '@xenova/transformers';
import * as wavefile from 'wavefile';
import { log } from '../utils';
import { DeepgramClient } from "@deepgram/sdk";

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });
const WaveFile = wavefile.WaveFile;

const transcriberCache = new Map<string, Promise<any>>();

router.post('/download-model', async (req, res) => {
    const requestedModel = req.body.model || 'Xenova/whisper-base.en';
    try {
        if (!transcriberCache.has(requestedModel)) {
            log('Whisper', `Downloading/Loading Whisper model (${requestedModel})... This may take a while.`);
            const promise = pipeline('automatic-speech-recognition', requestedModel).then((model: any) => {
                log('Whisper', 'Model loaded successfully.');
                return model;
            });
            transcriberCache.set(requestedModel, promise);
        }
        await transcriberCache.get(requestedModel);
        res.json({ success: true, message: `Model ${requestedModel} is ready.` });
    } catch (err: any) {
        log('Whisper', `Error loading model: ${err.message}`, true);
        res.status(500).json({ error: err.message });
    }
});

router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputPath = req.file.path;
    const outputPath = `${inputPath}.wav`;
    const engine = req.headers['x-engine'];
    const requestedModel = req.headers['x-whisper-model'] as string || 'Xenova/whisper-base.en';
    const deepgramApiKey = req.headers['x-deepgram-api-key'] || req.body.deepgramApiKey || process.env.DEEPGRAM_API_KEY;
    const useDeepgram = !!deepgramApiKey && engine !== 'local_whisper';

    try {
        if (useDeepgram) {
            log('Deepgram', `Transcribing ${req.file.originalname} using Deepgram...`);
            try {
                fs.renameSync(inputPath, outputPath);
                const deepgram = new DeepgramClient({ apiKey: deepgramApiKey as string });
            
                const fileStream = fs.createReadStream(outputPath);
                const response = await deepgram.listen.v1.media.transcribeFile(
                    fileStream,
                    {
                        model: "nova-3",
                        smart_format: false,
                        punctuate: true,
                        // @ts-ignore - Deepgram SDK types might be missing this
                        words: true,
                    }
                ) as any;
                
                const result = response.result || response;
                const error = response.error;
                
                if (error) throw new Error(`Deepgram error: ${error.message}`);

                const text = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
                const words = result?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
                const altConfidence = result?.results?.channels?.[0]?.alternatives?.[0]?.confidence;
                const confidence = typeof altConfidence === 'number' ? altConfidence : (words.length > 0 ? words.reduce((acc: number, w: any) => acc + (w.confidence || 0.98), 0) / words.length : 0.98);
                const chunks: any[] = [];
                
                let currentChunkWords: string[] = [];
                let chunkStart = 0;
                let currentEnd = 0;
                
                words.forEach((w: any, i: number) => {
                    if (currentChunkWords.length === 0) {
                        chunkStart = w.start;
                    }
                    currentChunkWords.push(w.punctuated_word || w.word);
                    currentEnd = w.end;
                    
                    if (i === words.length - 1 || words[i+1].start - w.end > 0.5 || currentEnd - chunkStart > 5) {
                        chunks.push({
                            text: currentChunkWords.join(' '),
                            timestamp: [chunkStart, currentEnd]
                        });
                        currentChunkWords = [];
                    }
                });

                if (currentChunkWords.length > 0) {
                    chunks.push({
                        text: currentChunkWords.join(' '),
                        timestamp: [chunkStart, currentEnd]
                    });
                }

                log('Deepgram', 'Transcription complete.');
                return res.json({ text, chunks, words, confidence });
            } catch (dgErr) {
                log('Deepgram', `Deepgram transcription failed: ${(dgErr as Error).message}. Falling back to Whisper.`);
                if (fs.existsSync(outputPath)) {
                    fs.renameSync(outputPath, inputPath);
                }
            }
        }

        // 1. Initialize transcriber if not already done
        if (!transcriberCache.has(requestedModel)) {
            log('Whisper', `Loading Whisper model (${requestedModel})...`);
            const promise = pipeline('automatic-speech-recognition', requestedModel).then((model: any) => {
                log('Whisper', 'Model loaded successfully.');
                return model;
            });
            transcriberCache.set(requestedModel, promise);
        }
        const transcriber = await transcriberCache.get(requestedModel);

        // 2. Convert to 16kHz WAV using FFmpeg
        log('FFmpeg', `Converting ${req.file.originalname} to 16kHz WAV...`);
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .toFormat('wav')
                .audioChannels(1)
                .audioFrequency(16000)
                .on('end', resolve)
                .on('error', reject)
                .save(outputPath);
        });

        // 3. Read WAV file and convert to Float32Array
        log('Whisper', 'Reading audio data...');
        const buffer = fs.readFileSync(outputPath);
        const wav = new WaveFile(buffer);
        wav.toBitDepth('32f'); // Convert to 32-bit float
        wav.toSampleRate(16000); // Ensure 16kHz
        
        const rawSamples: any = wav.getSamples();
        let audioData: Float32Array;
        if (Array.isArray(rawSamples)) {
            if (rawSamples.length > 0) {
                audioData = new Float32Array(rawSamples[0]);
            } else {
                audioData = new Float32Array(0);
            }
        } else {
            audioData = new Float32Array(rawSamples);
        }

        // 4. Run transcription
        log('Whisper', 'Transcribing audio...');
        const result = await transcriber(audioData, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: 'word',
        });

        log('Whisper', 'Transcription complete.');
        return res.json({ text: result.text, chunks: result.chunks });

    } catch (err: any) {
        log('Whisper', `Error: ${err.message}`, true);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    } finally {
        // Guarantee cleanup of both input and output temp files
        try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        } catch (e) {
            console.warn('Failed to cleanup inputPath temp file', e);
        }
        try {
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (e) {
            console.warn('Failed to cleanup outputPath temp file', e);
        }
    }
});

export default router;
