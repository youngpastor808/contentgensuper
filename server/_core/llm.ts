import { callGeminiWeb, buildCookieHeader } from "./geminiCookieProxy";

export type LLMOptions = {
  messages: Array<{ role: string; content: string | unknown[] }>;
  cookieAuth?: {
    psid: string;
    psidts?: string;
    psidcc?: string;
    compass?: string;
    sid?: string;
    hsid?: string;
    ssid?: string;
    model?: string;
  };
};

// Helper function to validate Google image hosts
function isAllowedGoogleImageHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return (
      host === 'googleusercontent.com' ||
      host.endsWith('.googleusercontent.com') ||
      host === 'ggpht.com' ||
      host.endsWith('.ggpht.com') ||
      host === 'gemini.google.com' ||
      host === 'business.gemini.google'
    );
  } catch {
    return false;
  }
}

// Helper function to fetch the Google CDN image and convert to Base64
async function fetchImageAsBase64(url: string, cookieHeader: string): Promise<{ base64: string; mimeType: string } | null> {
  if (!isAllowedGoogleImageHost(url)) {
    console.warn(`[Image Fetch] Blocked request to non-Google host: ${url}`);
    return null;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        "Cookie": cookieHeader,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": "https://gemini.google.com/"
      },
      redirect: 'error',
      signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) {
      console.error(`[Image Fetch] Failed with status: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    
    return {
      base64: buffer.toString('base64'),
      mimeType: mimeType
    };
  } catch (error) {
    console.error("[Image Fetch] Error converting image to Base64:", error);
    return null;
  }
}

export async function invokeLLM(options: LLMOptions) {
  if (options.cookieAuth) {
    const { psid, psidts, psidcc, compass, sid, hsid, ssid, model } = options.cookieAuth;
    const cookieHeader = buildCookieHeader(psid, psidts, psidcc, compass, sid, hsid, ssid);
    
    const prompt = options.messages
      .map((m) => {
        const role = m.role === "system" ? "SYSTEM" : "USER";
        const text = typeof m.content === "string"
          ? m.content
          : (m.content as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === "text")
              .map((p) => p.text || "")
              .join("\n");
        return `[${role}]\n${text}`;
      })
      .join("\n\n");

    // Call Gemini via the web proxy
    const result = await callGeminiWeb(prompt, cookieHeader, model);

    // Intercept URLs and convert to Base64 to bypass 403 Forbidden CDN errors
    if (result.images && result.images.length > 0) {
      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i];
        if (img.url && !img.base64) {
          const fetched = await fetchImageAsBase64(img.url, cookieHeader);
          if (fetched) {
            img.base64 = fetched.base64;
            img.mimeType = fetched.mimeType;
          }
        }
        
        // Zero-touch frontend fix: Embed the Base64 string directly into the Markdown text
        if (img.base64) {
          result.text += `\n\n![Generated Image](data:${img.mimeType || 'image/jpeg'};base64,${img.base64})`;
        }
      }
    }

    return {
      choices: [{ 
        message: { 
          role: "assistant", 
          content: result.text // The text now natively contains the images
        } 
      }],
    };
  }
  throw new Error("Only cookieAuth is implemented in this proxy.");
}
