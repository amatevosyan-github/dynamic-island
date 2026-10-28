#!/usr/bin/env node
// npm run setup-hooks / npm run remove-hooks: installs the agent-status hooks pointing
// at this checkout's hooks/agent-status.js (see main/hooks.js for what is changed).
const path = require('path');
const hooks = require('../main/hooks');

const script = path.resolve(__dirname, '..', 'hooks', 'agent-status.js');
const uninstall = process.argv.includes('--uninstall');

try {
  if (uninstall) {
    for (const file of hooks.uninstall()) console.log(`Removed island hooks from ${file}`);
  } else {
    for (const file of hooks.install(script)) console.log(`Installed island hooks in ${file}`);
    console.log(`Hook script: ${script}`);
    console.log('Re-run this after moving the project folder. Restart Cursor to pick up its hooks.');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
