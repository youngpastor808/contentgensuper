import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Patch @remotion/cloudrun to support Google Cloud Storage Uniform Bucket-Level Access (UBLA)
try {
  const remotionCloudRunDirs = [
    path.resolve('node_modules', '@remotion', 'cloudrun'),
    path.resolve('remotion', 'node_modules', '@remotion', 'cloudrun')
  ];
  for (const dir of remotionCloudRunDirs) {
    if (fs.existsSync(dir)) {
      const filesToPatch = [
        path.join(dir, 'dist', 'functions', 'render-media-single-thread.js'),
        path.join(dir, 'dist', 'functions', 'render-still-single-thread.js'),
        path.join(dir, 'dist', 'functions', 'helpers', 'write-cloudrun-error.js')
      ];
      for (const f of filesToPatch) {
        if (fs.existsSync(f)) {
          const content = fs.readFileSync(f, 'utf8');
          if (content.includes("predefinedAcl: publicUpload ? 'publicRead' : 'projectPrivate'")) {
            const patched = content.replace(/predefinedAcl:\s*publicUpload\s*\?\s*['"]publicRead['"]\s*:\s*['"]projectPrivate['"]/g, 'predefinedAcl: undefined');
            fs.writeFileSync(f, patched, 'utf8');
            console.log(`[Postinstall] Patched UBLA support in ${f}`);
          }
        }
      }
    }
  }
} catch (patchErr) {
  // Silent catch
}

try {
  const isAiStudioOrCloud = Boolean(
    process.env.APPLET_ID ||
    process.env.APPLET_DIR ||
    process.env.CONTROL_PLANE_PORT ||
    process.env.K_SERVICE ||
    process.env.K_REVISION ||
    process.env.GAE_ENV ||
    process.env.DOCKER_BUILD ||
    process.env.CI ||
    process.env.BUN_INSTALL ||
    process.env.npm_config_user_agent?.includes('bun') ||
    process.env.NODE_ENV === 'production' ||
    !fs.existsSync(path.resolve('electron', 'package.json'))
  );

  if (isAiStudioOrCloud) {
    console.log('[Postinstall] Cloud / Container / Bun / Production build environment detected.');
    console.log('[Postinstall] Skipping desktop Electron dependency installation.');
    process.exit(0);
  }

  // Only attempt if npm exists and electron package.json exists
  if (fs.existsSync(path.resolve('electron', 'package.json'))) {
    console.log('[Postinstall] Installing Electron dependencies...');
    execSync('npm --prefix electron install --no-audit --no-fund', { stdio: 'ignore' });
  }
} catch (err) {
  console.log('[Postinstall] Electron dependencies install skipped or completed with notice.');
} finally {
  process.exit(0);
}
