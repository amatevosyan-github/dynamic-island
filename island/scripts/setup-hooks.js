#!/usr/bin/env node
// Installs (or with --uninstall removes) the island's agent-status hooks in
//   ~/.claude/settings.json   (Claude Code: CLI and the desktop app's Code tab)
//   ~/.cursor/hooks.json      (Cursor, only if Cursor is installed)
// Existing settings and other hooks are kept; only entries running agent-status.js
// are touched, so running it again is safe. A .bak copy is written before each change.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER = 'agent-status.js';
const SCRIPT = path.resolve(__dirname, '..', 'hooks', MARKER).replace(/\\/g, '/');
const cmd = (tool, event) => `node "${SCRIPT}" ${tool} ${event}`;

const CLAUDE_EVENTS = {
  UserPromptSubmit: 'working',
  Stop: 'done',
  Notification: 'notify',
  PostToolUse: 'resume',
  SessionEnd: 'end',
};
const CURSOR_EVENTS = {
  beforeSubmitPrompt: 'working',
  stop: 'done',
};

const uninstall = process.argv.includes('--uninstall');
const home = os.homedir();

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}); fix it first, nothing was changed.`);
  }
}

function writeJson(file, data) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

// Claude: hooks.<Event> = [{ matcher?, hooks: [{ type, command, ... }] }]
function updateClaude() {
  const file = path.join(home, '.claude', 'settings.json');
  const settings = readJson(file);
  const hooks = settings.hooks || {};

  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event]
      .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !String(h.command || '').includes(MARKER)) }))
      .filter((group) => group.hooks.length);
    if (!hooks[event].length) delete hooks[event];
  }

  if (!uninstall) {
    for (const [event, arg] of Object.entries(CLAUDE_EVENTS)) {
      const group = { hooks: [{ type: 'command', async: true, command: cmd('claude', arg) }] };
      if (event === 'PostToolUse') group.matcher = '*';
      (hooks[event] = hooks[event] || []).push(group);
    }
  }

  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  writeJson(file, settings);
  return file;
}

// Cursor: { version: 1, hooks: { <event>: [{ command }] } }
function updateCursor() {
  const dir = path.join(home, '.cursor');
  if (!fs.existsSync(dir)) return null;
  const file = path.join(dir, 'hooks.json');
  if (uninstall && !fs.existsSync(file)) return null;

  const config = readJson(file);
  const hooks = config.hooks || {};
  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event].filter((h) => !String(h.command || '').includes(MARKER));
    if (!hooks[event].length) delete hooks[event];
  }

  if (!uninstall) {
    for (const [event, arg] of Object.entries(CURSOR_EVENTS)) {
      (hooks[event] = hooks[event] || []).push({ command: cmd('cursor', arg) });
    }
  }

  writeJson(file, { ...config, version: config.version || 1, hooks });
  return file;
}

try {
  const done = [updateClaude(), updateCursor()].filter(Boolean);
  const verb = uninstall ? 'Removed island hooks from' : 'Installed island hooks in';
  for (const file of done) console.log(`${verb} ${file}`);
  if (!uninstall) {
    console.log(`Hook script: ${SCRIPT}`);
    console.log('Re-run this after moving the project folder. Restart Cursor to pick up its hooks.');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
