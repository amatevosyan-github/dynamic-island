const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hooks = require('../main/hooks');

const SCRIPT = 'C:/somewhere/island/hooks/agent-status.js';

function home({ claude, cursor } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'island-hooks-'));
  fs.mkdirSync(path.join(dir, '.claude'));
  if (claude !== undefined) fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), claude);
  if (cursor !== undefined) {
    fs.mkdirSync(path.join(dir, '.cursor'));
    if (cursor !== null) fs.writeFileSync(path.join(dir, '.cursor', 'hooks.json'), cursor);
  }
  return dir;
}

const read = (dir, ...p) => JSON.parse(fs.readFileSync(path.join(dir, ...p), 'utf8'));
const ours = (cmds) => cmds.filter((c) => c.includes('agent-status.js'));
const claudeCommands = (s) => Object.values(s.hooks || {}).flat().flatMap((g) => g.hooks.map((h) => h.command));

const OTHER_CLAUDE = JSON.stringify({
  model: 'opus',
  hooks: { PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }] },
});
const OTHER_CURSOR = JSON.stringify({ version: 1, hooks: { stop: [{ command: 'echo mine' }] } });

test('install keeps other settings and hooks, and is idempotent', () => {
  const dir = home({ claude: OTHER_CLAUDE, cursor: OTHER_CURSOR });
  hooks.install(SCRIPT, dir);
  hooks.install(SCRIPT, dir);

  const s = read(dir, '.claude', 'settings.json');
  assert.equal(s.model, 'opus');
  const cmds = claudeCommands(s);
  assert.ok(cmds.includes('prettier --write'));
  assert.equal(ours(cmds).length, 5, 'one entry per event, no duplicates');
  assert.ok(Object.values(s.hooks).flat().flatMap((g) => g.hooks).filter((h) => h.command.includes('agent-status')).every((h) => h.async));

  const c = read(dir, '.cursor', 'hooks.json');
  assert.deepEqual(c.hooks.stop.map((h) => h.command).filter((x) => !x.includes('agent-status')), ['echo mine']);
  assert.equal(ours(Object.values(c.hooks).flat().map((h) => h.command)).length, 2);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json.bak')));

  assert.equal(hooks.installedScript(dir), SCRIPT);
});

test('uninstall restores the original content', () => {
  const dir = home({ claude: OTHER_CLAUDE, cursor: OTHER_CURSOR });
  hooks.install(SCRIPT, dir);
  hooks.uninstall(dir);
  assert.deepEqual(read(dir, '.claude', 'settings.json'), JSON.parse(OTHER_CLAUDE));
  assert.deepEqual(read(dir, '.cursor', 'hooks.json'), JSON.parse(OTHER_CURSOR));
  assert.equal(hooks.installedScript(dir), null);
});

test('install on a fresh machine creates the Claude settings; skips Cursor when absent', () => {
  const dir = home();
  const files = hooks.install(SCRIPT, dir);
  assert.equal(files.length, 1);
  assert.equal(ours(claudeCommands(read(dir, '.claude', 'settings.json'))).length, 5);
  assert.ok(!fs.existsSync(path.join(dir, '.cursor')));
});

test('a settings file that is not JSON is left untouched', () => {
  const dir = home({ claude: '{ broken' });
  assert.throws(() => hooks.install(SCRIPT, dir), /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'), '{ broken');
});
