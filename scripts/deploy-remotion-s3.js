import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'remotion', 'build');

const accessKeyId = process.env.REMOTION_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.REMOTION_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
const region = process.env.REMOTION_AWS_REGION || process.env.AWS_REGION || 'us-east-1';
const bucketName = process.env.REMOTION_AWS_BUCKET || 'remotionlambda-useast1-mfleks0w04';
const siteName = process.env.REMOTION_SITE_NAME || 'contentgen';

if (!accessKeyId || !secretAccessKey) {
  console.error('[Deploy S3 Site ERROR] AWS credentials missing in environment.');
  process.exit(1);
}

if (!fs.existsSync(buildDir)) {
  console.error(`[Deploy S3 Site ERROR] Build directory does not exist: ${buildDir}. Run "npm run remotion:build" first.`);
  process.exit(1);
}

const client = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.map': 'application/json',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
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
  console.log(`[Deploy S3 Site] Syncing ${relFiles.length} build artifacts to s3://${bucketName}/sites/${siteName}/...`);

  for (const rel of relFiles) {
    const filePath = path.join(buildDir, rel);
    const ext = path.extname(rel).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const key = `sites/${siteName}/${rel.split(path.sep).join('/')}`; // forward slashes on S3 regardless of OS
    await client.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: fs.readFileSync(filePath), ContentType: contentType }));
  }

  console.log(`[Deploy S3 Site SUCCESS] Deployed.`);
  console.log(`🌐 Serve URL: https://${bucketName}.s3.${region}.amazonaws.com/sites/${siteName}/index.html`);
}

syncSite().catch((err) => {
  console.error('[Deploy S3 Site ERROR]:', err);
  process.exit(1);
});
