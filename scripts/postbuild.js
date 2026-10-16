import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

console.log('[Postbuild] Verifying build artifacts in:', distDir);

if (!fs.existsSync(distDir)) {
  console.error('[Postbuild ERROR] dist directory does not exist!');
  process.exit(1);
}

const requiredFiles = ['index.html', 'server.js'];
for (const file of requiredFiles) {
  const filePath = path.join(distDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`[Postbuild ERROR] Required artifact missing: ${file}`);
    process.exit(1);
  }
}

const files = fs.readdirSync(distDir);
console.log(`[Postbuild] Build artifacts verified (${files.length} items in dist: ${files.join(', ')})`);

// Unconditionally mirror 'dist' to 'build' and fallback directories as physical copies (no symlinks)
const targetDirs = ['build', 'dist-electron'];
for (const dirName of targetDirs) {
  const targetDir = path.join(rootDir, dirName);
  try {
    if (fs.existsSync(targetDir)) {
      const stats = fs.lstatSync(targetDir);
      if (stats.isSymbolicLink() || stats.isFile()) {
        fs.unlinkSync(targetDir);
      } else {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    }
    fs.cpSync(distDir, targetDir, { recursive: true });
    console.log(`[Postbuild] Physical mirror created: ${dirName} -> dist`);
  } catch (err) {
    console.warn(`[Postbuild] Could not mirror to ${dirName}:`, err.message);
  }
}

console.log('[Postbuild] All artifact outputs ready.');
