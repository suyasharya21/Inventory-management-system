const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const electronPath = require('electron');
const result = spawnSync(electronPath, [join(__dirname, 'smoke-test.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});

if (result.error) throw result.error;
if (result.signal) console.error(`Electron smoke test stopped with ${result.signal}.`);
process.exit(result.status ?? 1);
