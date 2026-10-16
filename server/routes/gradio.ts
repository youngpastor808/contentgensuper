import express from 'express';
import multer from 'multer';
import { Client } from '@gradio/client';
import fs from 'node:fs';
import os from 'node:os';
import dns from 'node:dns/promises';
import net from 'node:net';

const router = express.Router();

// Cache clients to avoid reconnecting
const clients = new Map<string, any>();

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe8') || lower.startsWith('fe9')) return true; // link local
    if (lower.startsWith('fea') || lower.startsWith('feb')) return true;
    const mapped = lower.match(/^::ffff:(.+)$/); // IPv4-mapped
    if (mapped && net.isIPv4(mapped[1])) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

// Helper to validate external URL and prevent SSRF
export async function isAllowedExternalUrl(urlString: string): Promise<boolean> {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // Block loopback & metadata addresses
    if (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local')
    ) {
      return false;
    }

    const addresses = await dns.lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    if (addresses.some((a) => isPrivateAddress(a.address))) return false;

    return true;
  } catch {
    return false;
  }
}

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB cap
});

router.post('/', upload.single('referenceAudio'), async (req, res) => {
  const uploadedFilePath = req.file?.path;
  try {
    const { apiUrl, text, provider, voiceName, instruction, voiceDescription, refTranscript, useFastMode } = req.body;

    if (!apiUrl || !(await isAllowedExternalUrl(apiUrl))) {
      return res.status(400).send('A valid external Gradio TTS API URL is required');
    }

    let client = clients.get(apiUrl);
    if (!client) {
      try {
        client = await Client.connect(apiUrl);
        clients.set(apiUrl, client);
      } catch (err) {
        return res.status(500).send(`Failed to connect to Gradio API: ${err}`);
      }
    }

    let result: any;
    try {
      switch (provider) {
        case 'gradio_custom':
          result = await client.predict('/custom_voice', {
            text,
            voice_name: voiceName || 'serena',
            instruction: instruction || '',
          });
          break;
        case 'gradio_design':
          result = await client.predict('/voice_design', {
            text,
            voice_description: voiceDescription || 'A clear, neutral voice.',
          });
          break;
        case 'gradio_clone': {
          if (!req.file || !uploadedFilePath) {
            return res.status(400).send('Reference audio is required for voice cloning.');
          }
          const fileData = await fs.promises.readFile(uploadedFilePath);
          const blob = new Blob([fileData], { type: req.file.mimetype || 'audio/wav' });
          result = await client.predict('/voice_clone', {
            text,
            reference_audio: blob,
            ref_transcript: refTranscript || '',
            use_fast_mode: useFastMode !== 'false',
          });
          break;
        }
        default:
          return res.status(400).send(`Unsupported Gradio provider: ${provider}`);
      }
    } catch (error) {
      clients.delete(apiUrl);
      return res.status(500).send(`Gradio API call failed: ${error}`);
    }

    let audioUrl: string;
    if (result?.data?.[0]?.url) {
      audioUrl = result.data[0].url;
    } else if (result?.data?.[0]?.path) {
      audioUrl = new URL(result.data[0].path, apiUrl).toString();
    } else if (typeof result?.data?.[0] === 'string') {
      const p = result.data[0];
      audioUrl = p.startsWith('http') ? p : new URL(p, apiUrl).toString();
    } else if (result?.data?.url) {
      audioUrl = result.data.url;
    } else {
      console.error('Could not extract audio URL from Gradio response:', result);
      return res.status(500).send('Could not extract audio URL from Gradio response');
    }

    // Secondary SSRF check on the returned audio URL
    if (!(await isAllowedExternalUrl(audioUrl))) {
      return res.status(400).send('Gradio returned a disallowed or private audio URL');
    }

    const audioResponse = await fetch(audioUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!audioResponse.ok) {
      return res.status(500).send(`Failed to fetch generated audio: ${audioResponse.statusText}`);
    }

    const arrayBuffer = await audioResponse.arrayBuffer();
    res.setHeader('Content-Type', audioResponse.headers.get('content-type') || 'audio/wav');
    return res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    return res.status(500).send(err?.message || 'Gradio request failed');
  } finally {
    if (uploadedFilePath) {
      fs.promises.unlink(uploadedFilePath).catch(() => {});
    }
  }
});

export default router;
