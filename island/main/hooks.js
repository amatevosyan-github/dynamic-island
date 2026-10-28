// Adds or removes the agent-status hooks in
//   ~/.claude/settings.json   (Claude Code: CLI and the desktop app's Code tab)
//   ~/.cursor/hooks.json      (Cursor, only if Cursor is installed)
// Existing settings and other hooks are kept; only entries running agent-status.js
// are touched, so applying it again is safe. A .bak copy is written before each change.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER = 'agent-status.js';

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

const isOurs = (h) => String((h && h.command) || '').includes(MARKER);
const claudeFile = (home) => path.join(home, '.claude', 'settings.json');
const cursorDir = (home) => path.join(home, '.cursor');

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
function applyClaude(home, cmd) {
  const file = claudeFile(home);
  const settings = readJson(file);
  const hooks = settings.hooks || {};

  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event]
      .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((group) => group.hooks.length);
    if (!hooks[event].length) delete hooks[event];
  }

  if (cmd) {
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
function applyCursor(home, cmd) {
  if (!fs.existsSync(cursorDir(home))) return null;
  const file = path.join(cursorDir(home), 'hooks.json');
  if (!cmd && !fs.existsSync(file)) return null;

  const config = readJson(file);
  const hooks = config.hooks || {};
  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event].filter((h) => !isOurs(h));
    if (!hooks[event].length) delete hooks[event];
  }

  if (cmd) {
    for (const [event, arg] of Object.entries(CURSOR_EVENTS)) {
      (hooks[event] = hooks[event] || []).push({ command: cmd('cursor', arg) });
    }
  }

  writeJson(file, { ...config, version: config.version || 1, hooks });
  return file;
}

// Installs hooks running `script`; returns the files changed.
function install(script, home = os.homedir()) {
  const target = path.resolve(script).replace(/\\/g, '/');
  const cmd = (tool, event) => `node "${target}" ${tool} ${event}`;
  return [applyClaude(home, cmd), applyCursor(home, cmd)].filter(Boolean);
}

function uninstall(home = os.homedir()) {
  return [applyClaude(home, null), applyCursor(home, null)].filter(Boolean);
}

// The script the installed Claude hooks point to, or null when not installed.
function installedScript(home = os.homedir()) {
  try {
    const hooks = readJson(claudeFile(home)).hooks || {};
    for (const group of Object.values(hooks).flat()) {
      const h = (group.hooks || []).find(isOurs);
      if (h) return (h.command.match(/node "([^"]+)"/) || [])[1] || null;
    }
  } catch {
    // unreadable settings: treat as not installed
  }
  return null;
}

module.exports = { install, uninstall, installedScript };
