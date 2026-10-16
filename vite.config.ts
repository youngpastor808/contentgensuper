
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'url';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: './',
      server: {
        port: 3000,
        host: process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1',
        strictPort: false,
        hmr: false,
        // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
        watch: process.env.DISABLE_HMR === 'true' ? null : {}
      },
      plugins: [tailwindcss()],
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 1200,
        rollupOptions: {
          onwarn(warning, defaultHandler) {
            if (
              warning.code === 'DYNAMIC_IMPORT_WILL_NOT_MOVE_MODULE_INTO_ANOTHER_CHUNK' ||
              warning.message?.includes('dynamic import will not move module into another chunk') ||
              warning.message?.includes('cannot be analyzed by Vite')
            ) {
              return;
            }
            defaultHandler(warning);
          },
          output: {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('firebase')) {
                  return 'vendor-firebase';
                }
                if (id.includes('@google') || id.includes('gemini-reverse')) {
                  return 'vendor-genai';
                }
                return 'vendor-libs';
              }
              if (id.includes('/src/audioWaveformVisualizer')) {
                return 'waveform-visualizer';
              }
              if (id.includes('/src/image-studio')) {
                return 'image-studio-canvas';
              }
              if (id.includes('/src/handlers-transcript-editor')) {
                return 'transcript-editor';
              }
              if (id.includes('/src/exporter')) {
                return 'export-engine';
              }
            }
          }
        }
      },
      ssr: {
        target: 'node',
        external: [
          'node:module', 'module',
          'node:crypto', 'crypto',
          'node:fs', 'fs',
          'node:path', 'path',
          'node:os', 'os',
          'node:url', 'url',
          'node:child_process', 'child_process',
          'node:http', 'http',
          'node:https', 'https',
          'node:stream', 'stream',
          'node:events', 'events',
          'node:util', 'util',
          'node:buffer', 'buffer',
          'node:net', 'net',
          'node:tls', 'tls',
          'node:zlib', 'zlib',
          'vite',
          'express',
          'cors',
          'cookie-parser',
          'ffmpeg-static',
          'fluent-ffmpeg',
          'sharp',
          '@xenova/transformers',
          'multer',
          '@deepgram/sdk',
          '@google/genai',
          '@gradio/client',
          'gemini-reverse'
        ]
      },
      define: {
        'process.env.API_KEY': JSON.stringify(''),
        'process.env.GEMINI_API_KEY': JSON.stringify(''),
        'process.env.STABILITY_API_KEY': JSON.stringify(''),
        'process.env.APP_PASSWORD': JSON.stringify(''),
        'process.env.IS_AI_STUDIO': JSON.stringify(Boolean(
          process.env.APPLET_ID ||
          process.env.APPLET_DIR ||
          process.env.CONTROL_PLANE_PORT ||
          process.env.K_SERVICE
        )),
        'process.env.APPLET_ID': JSON.stringify(process.env.APPLET_ID || '')
      },
      resolve: {
        alias: {
          '@': fileURLToPath(new URL('./src', import.meta.url)),
          '@google/genai': '@google/genai/web'
        }
      }
    };
});