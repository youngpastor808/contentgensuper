import { execSync } from 'node:child_process';

const isAiStudioOrCloud = Boolean(
  process.env.APPLET_ID ||
  process.env.APPLET_DIR ||
  process.env.CONTROL_PLANE_PORT ||
  process.env.K_SERVICE ||
  process.env.K_REVISION ||
  process.env.GAE_ENV ||
  process.env.CI
);

if (isAiStudioOrCloud) {
  console.log('[Electron Build] Running inside Google AI Studio / Cloud Run container.');
  console.log('[Electron Build] Desktop binary compilation (.exe/.dmg) is skipped in cloud container.');
  process.exit(0);
}

try {
  console.log('[Electron Build] Starting desktop package compilation...');
  execSync('npm --prefix electron run build', { stdio: 'inherit' });
} catch (err) {
  console.error('[Electron Build ERROR] Failed to compile desktop package:', err.message);
  process.exit(1);
}
