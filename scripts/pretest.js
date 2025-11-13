const { execSync } = require('child_process');
const path = require('path');

// Skip in CI
if (process.env.CI) {
  console.log('pretest: CI=true, skipping sync_secret');
  process.exit(0);
}

// Only run the PowerShell sync on Windows (PowerShell may not be present on runners)
if (process.platform !== 'win32') {
  console.log('pretest: non-Windows platform, skipping sync_secret');
  process.exit(0);
}

const psPath = path.join(__dirname, 'sync_secret.ps1');
try {
  console.log('pretest: invoking PowerShell to sync secret (local dev only)');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, { stdio: 'inherit' });
} catch (err) {
  console.error('pretest: sync_secret.ps1 failed:', err && err.message ? err.message : err);
  process.exit(1);
}
