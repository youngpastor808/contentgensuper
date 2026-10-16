import 'dotenv/config';
import { Storage } from '@google-cloud/storage';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const remotionDir = path.join(rootDir, 'remotion');
const buildDir = path.join(remotionDir, 'build');

const bucketName = process.env.REMOTION_GCP_BUCKET || process.env.GCP_STORAGE_BUCKET || 'contentgenapp-remotion-us-central1';
const siteName = process.env.REMOTION_SITE_NAME || 'storyboard-video';
const projectId = process.env.REMOTION_GCP_PROJECT_ID || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'contentgenapp-507516';

let keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (keyFilename && (keyFilename.trim().startsWith('{') || keyFilename.includes('"client_email"'))) {
  // It's raw JSON in GOOGLE_APPLICATION_CREDENTIALS, not a path
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = keyFilename;
  keyFilename = undefined;
}

if (!keyFilename) {
  if (fs.existsSync(path.join(rootDir, 'remotion-key.json'))) {
    keyFilename = path.join(rootDir, 'remotion-key.json');
  } else if (fs.existsSync(path.join(rootDir, 'key.json'))) {
    keyFilename = path.join(rootDir, 'key.json');
  }
}

// Parse in-memory credentials if available
let credentials = undefined;
const rawJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || 
                process.env.GCP_SERVICE_ACCOUNT_KEY || 
                process.env.REMOTION_GCP_CREDENTIALS;

if (rawJson) {
  try {
    const clean = rawJson.trim().replace(/^['"]|['"]$/g, '');
    credentials = JSON.parse(clean);
  } catch (e) {
    console.warn('[Deploy GCS] Could not parse raw credentials JSON, falling back to keyFilename');
  }
} else if (process.env.REMOTION_GCP_CLIENT_EMAIL && process.env.REMOTION_GCP_PRIVATE_KEY) {
  credentials = {
    client_email: process.env.REMOTION_GCP_CLIENT_EMAIL.trim(),
    private_key: process.env.REMOTION_GCP_PRIVATE_KEY.replace(/\\n/g, '\n').trim(),
  };
}

console.log('==============================================================================');
console.log('🚀 Deploying Remotion Composition Bundle to Google Cloud Storage');
console.log('==============================================================================');
console.log(`📦 Target Bucket: ${bucketName}`);
console.log(`🌐 Site Name: ${siteName}`);
if (projectId) console.log(`🆔 Project ID: ${projectId}`);
if (credentials?.client_email) console.log(`🔑 Auth: In-memory Service Account (${credentials.client_email})`);
else if (keyFilename) console.log(`🔑 Auth: Key file (${keyFilename})`);
console.log('==============================================================================\n');

// Step 1: Ensure bundle is fresh
console.log('Step 1: Bundling Remotion composition...');
try {
  execSync('npm run bundle', { cwd: remotionDir, stdio: 'inherit' });
} catch (bundleErr) {
  console.error('[Deploy GCS Site ERROR] Failed to bundle Remotion composition:', bundleErr);
  process.exit(1);
}

if (!fs.existsSync(buildDir)) {
  console.error(`[Deploy GCS Site ERROR] Build directory does not exist: ${buildDir}`);
  process.exit(1);
}

// Step 2: Initialize Storage Client
const storage = new Storage({
  projectId: projectId || undefined,
  keyFilename: (!credentials && keyFilename) ? keyFilename : undefined,
  credentials: credentials || undefined,
});

const bucket = storage.bucket(bucketName);

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.map': 'application/json',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

async function walk(dir, baseDir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await walk(full, baseDir));
    else out.push(path.relative(baseDir, full));
  }
  return out;
}

async function syncSite() {
  const relFiles = await walk(buildDir, buildDir);
  console.log(`\nStep 2: Uploading ${relFiles.length} build artifacts to gs://${bucketName}/sites/${siteName}/...`);

  for (const rel of relFiles) {
    const filePath = path.join(buildDir, rel);
    const ext = path.extname(rel).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const destination = `sites/${siteName}/${rel.split(path.sep).join('/')}`;

    await bucket.upload(filePath, {
      destination,
      metadata: {
        contentType,
        cacheControl: ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      },
    });
  }

  const serveUrl = `https://storage.googleapis.com/${bucketName}/sites/${siteName}/index.html`;

  console.log('\n==============================================================================');
  console.log('✅ Remotion Composition Successfully Deployed to Google Cloud Storage!');
  console.log('==============================================================================');
  console.log(`🌐 Serve URL: ${serveUrl}`);
  console.log('\nAdd this to your .env file:');
  console.log('------------------------------------------------------------------');
  console.log(`REMOTION_GCP_BUCKET=${bucketName}`);
  console.log(`REMOTION_GCP_SERVE_URL=${serveUrl}`);
  console.log('==============================================================================\n');
}

syncSite().catch((err) => {
  console.error('[Deploy GCS Site ERROR]:', err);
  process.exit(1);
});
