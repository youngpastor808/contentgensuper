import puppeteer, { type Browser } from 'puppeteer-core';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  uploadToS3,
  isS3Configured,
} from './s3Storage';

import {
  uploadFileToGcs,
  isGcsConfigured,
} from './gcsStorage';

import {
  findChromeExecutable,
} from './cloudCanvasWorker';

const cache = new Map<string, string>();
let globalBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (globalBrowser && globalBrowser.connected) {
    return globalBrowser;
  }

  const chrome = findChromeExecutable();
  if (!chrome) {
    throw new Error(
      'Chromium is required to rasterize HyperFrames during cloud preparation.'
    );
  }

  globalBrowser = await puppeteer.launch({
    headless: true,
    executablePath: chrome,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  globalBrowser.on('disconnected', () => {
    globalBrowser = null;
  });

  return globalBrowser;
}

export async function closeHyperframeBrowser(): Promise<void> {
  if (globalBrowser) {
    try {
      await globalBrowser.close();
    } catch {}
    globalBrowser = null;
  }
}

function hashHyperFrame(
  html: string,
  css: string | undefined,
  presetId: string | undefined,
  scale: number
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        html,
        css,
        presetId,
        scale,
      })
    )
    .digest('hex');
}

function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]+;/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/url\s*\(\s*(?!['"]?data:)[^)]+\)/gi, 'none');
}

function customCssText(css?: string): string {
  return css ? sanitizeCss(css) : '';
}

async function rasterizeOne(
  html: string,
  css: string | undefined,
  key: string,
  appBaseUrl: string
): Promise<{
  url: string;
  width: number;
  height: number;
}> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    });

    try {
      await page.goto(`${appBaseUrl}/?hyperFrameCapture=1`, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });

      /*
       * Extract the actual stylesheet URLs used by ContentGen,
       * fetch them in the browser and convert them to inline styles.
       */
      await page.evaluate(async () => {
        const links = Array.from(
          document.querySelectorAll('link[rel="stylesheet"]')
        ) as HTMLLinkElement[];

        for (const link of links) {
          try {
            const response = await fetch(link.href);
            if (!response.ok) continue;
            const text = await response.text();
            const style = document.createElement('style');
            style.textContent = text;
            document.head.appendChild(style);
            link.remove();
          } catch {
            // Continue with successfully loaded stylesheets.
          }
        }
      });
    } catch {
      // If local app navigation times out, continue with injected default styling
    }

    const sanitizedHtml = await page.evaluate((source: string) => {
      const host = document.createElement('div');
      host.innerHTML = source;

      for (const element of Array.from(
        host.querySelectorAll('script,iframe,object,embed,link,meta')
      )) {
        element.remove();
      }

      for (const element of Array.from(host.querySelectorAll('*'))) {
        for (const attribute of Array.from(element.attributes)) {
          if (attribute.name.toLowerCase().startsWith('on')) {
            element.removeAttribute(attribute.name);
          }
          if (
            (attribute.name === 'src' || attribute.name === 'href') &&
            !attribute.value.startsWith('data:')
          ) {
            element.removeAttribute(attribute.name);
          }
        }
      }

      return host.innerHTML;
    }, html);

    await page.evaluate(
      ({ markup, customCss }: { markup: string; customCss: string }) => {
        document.body.innerHTML = '';
        document.body.style.margin = '0';
        document.body.style.background = 'transparent';

        const style = document.createElement('style');
        style.textContent = `
          html, body {
            margin: 0 !important;
            background: transparent !important;
            overflow: hidden !important;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }

          #contentgen-hyperframe-capture {
            display: inline-block;
            width: fit-content;
            max-width: 90vw;
            position: relative;
          }

          *, *::before, *::after {
            animation: none !important;
            transition: none !important;
          }

          ${customCss || ''}
        `;

        document.head.appendChild(style);

        const root = document.createElement('div');
        root.id = 'contentgen-hyperframe-capture';
        root.innerHTML = markup;
        document.body.appendChild(root);
      },
      {
        markup: sanitizedHtml,
        customCss: customCssText(css),
      }
    );

    await page.evaluate(async () => {
      if (document.fonts) {
        await document.fonts.ready;
      }
    });

    const box = await page.evaluate(() => {
      const element = document.getElementById('contentgen-hyperframe-capture');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      };
    });

    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error('HyperFrame produced an empty render box.');
    }

    const png = await page.screenshot({
      type: 'png',
      omitBackground: true,
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: Math.min(box.width, 1900),
        height: Math.min(box.height, 1000),
      },
    });

    const tempPath = path.join(os.tmpdir(), `hyperframe_${key}.png`);
    await fs.writeFile(tempPath, png);

    let resultUrl: string | undefined;

    if (isS3Configured()) {
      const uploaded = await uploadToS3(
        `hyperframes/${key}.png`,
        Buffer.from(png),
        'image/png',
        {
          generatePresigned: true,
          expiresInSeconds: 7 * 24 * 60 * 60,
        }
      );

      resultUrl = uploaded?.signedUrl || uploaded?.url;
    }

    if (!resultUrl && isGcsConfigured()) {
      const uploaded = await uploadFileToGcs(
        `hyperframes/${key}.png`,
        tempPath,
        'image/png',
        {
          expiresInSeconds: 7 * 24 * 60 * 60,
        }
      );

      resultUrl = uploaded?.signedUrl || uploaded?.url;
    }

    try {
      await fs.rm(tempPath, { force: true });
    } catch {}

    if (!resultUrl) {
      // Base64 fallback if cloud storage is not connected
      const b64 = Buffer.from(png).toString('base64');
      resultUrl = `data:image/png;base64,${b64}`;
    }

    return {
      url: resultUrl,
      width: box.width,
      height: box.height,
    };
  } finally {
    try {
      await page.close();
    } catch {}
  }
}

export async function prepareHyperFramesForCloud(
  inputProps: any,
  appBaseUrl: string
): Promise<any> {
  if (!inputProps) return inputProps;
  const props = structuredClone(inputProps);

  if (!Array.isArray(props.graphics)) {
    return props;
  }

  for (let i = 0; i < props.graphics.length; i++) {
    const graphic = props.graphics[i];

    if (!graphic || graphic.type !== 'hyperFrame' || !graphic.html) {
      continue;
    }

    if (graphic.rasterUrl) {
      continue;
    }

    const key = hashHyperFrame(
      graphic.html,
      graphic.css,
      graphic.presetId || graphic.templateId,
      graphic.scale || 1
    );

    const cached = cache.get(key);

    if (cached) {
      props.graphics[i] = {
        ...graphic,
        rasterUrl: cached,
      };
      continue;
    }

    try {
      const raster = await rasterizeOne(
        graphic.html,
        graphic.css,
        key,
        appBaseUrl
      );

      cache.set(key, raster.url);

      props.graphics[i] = {
        ...graphic,
        rasterUrl: raster.url,
        rasterWidth: raster.width,
        rasterHeight: raster.height,
      };
    } catch (rasterErr) {
      console.warn(`[HyperFrame Rasterize Warning] Graphic ${graphic.id || i}:`, rasterErr);
    }
  }

  return props;
}
