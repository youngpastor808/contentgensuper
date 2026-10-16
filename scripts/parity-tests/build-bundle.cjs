// Usage: node build-bundle.js <entry.ts> <out.js>   (run from the project root)
const esbuild = require('esbuild');
const ignored = /^(@google\/genai|firebase(\/.*)?|firebase-admin|@google-cloud\/(storage|vertexai))$/;
esbuild.build({
  entryPoints: [process.argv[2]], bundle: true, platform: 'browser', format: 'iife', outfile: process.argv[3],
  logLevel: 'error', loader: { '.png': 'dataurl', '.svg': 'dataurl' },
  external: ['@ffmpeg/*', 'jszip', 'mp4-muxer', 'webm-muxer', 'idb', 'three', '@mediapipe/*', 'onnxruntime-web', '@huggingface/*'],
  plugins: [{ name: 'ignored-like-webpack-false', setup(b) {
    b.onResolve({ filter: ignored }, a => ({ path: a.path, namespace: 'ignored' }));
    b.onLoad({ filter: /.*/, namespace: 'ignored' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
  } }],
}).catch(() => process.exit(1));
