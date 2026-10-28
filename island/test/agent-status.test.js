const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lastTurnQuestion } = require('../hooks/agent-status');

const HOOK = path.join(__dirname, '..', 'hooks', 'agent-status.js');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'island-test-'));
}

function transcript(dir, entries) {
  const file = path.join(dir, `t-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'));
  return file;
}

// Runs the hook as Claude Code / Cursor would, with `home` as the user's home folder.
function hook(home, tool, event, payload) {
  const res = spawnSync(process.execPath, [HOOK, tool, event], {
    input: JSON.stringify(payload),
    env: { ...process.env, USERPROFILE: home, HOME: home },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  return res.stdout;
}

const record = (home, name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, '.dynamic-island', 'agents', `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
};

const prompt = { type: 'user', message: { content: 'do the thing' } };
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

test('lastTurnQuestion: question in the desktop next-step box', () => {
  const dir = tempHome();
  const file = transcript(dir, [
    prompt,
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__ccd_turn__wrap_up', input: { recap: 'r', ask: 'Commit it?' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    say('Done, see above.'),
  ]);
  assert.equal(lastTurnQuestion(file), 'Commit it?');
});

test('lastTurnQuestion: reply ending with a question, markdown stripped', () => {
  const dir = tempHome();
  assert.equal(lastTurnQuestion(transcript(dir, [prompt, say('All set.\n\n**Go with option B?**')])), 'Go with option B?');
});

test('lastTurnQuestion: plain finish is not a question', () => {
  const dir = tempHome();
  assert.equal(lastTurnQuestion(transcript(dir, [prompt, say('Finished.')])), null);
});

test('lastTurnQuestion: only the last turn counts', () => {
  const dir = tempHome();
  const file = transcript(dir, [prompt, say('Which one?'), { type: 'user', message: { content: 'the first' } }, say('Done.')]);
  assert.equal(lastTurnQuestion(file), null);
});

test('lastTurnQuestion: Cursor transcript format (role instead of type)', () => {
  const dir = tempHome();
  const file = transcript(dir, [
    { role: 'user', message: { content: [{ type: 'text', text: 'ask me something' }] } },
    { role: 'assistant', message: { content: [{ type: 'text', text: 'What are you working on?' }] } },
  ]);
  assert.equal(lastTurnQuestion(file), 'What are you working on?');
});

test('hook: prompt, permission prompt, resume, stop, end', () => {
  const home = tempHome();
  hook(home, 'claude', 'working', { session_id: 's1', cwd: 'C:/work/app', prompt: 'Fix   the\nbug' });
  let r = record(home, 'claude-s1');
  assert.equal(r.state, 'working');
  assert.equal(r.project, 'app');
  assert.equal(r.prompt, 'Fix the bug');

  hook(home, 'claude', 'notify', { session_id: 's1', message: 'Claude needs your permission to use Bash' });
  assert.equal(record(home, 'claude-s1').state, 'waiting');

  hook(home, 'claude', 'resume', { session_id: 's1' });
  assert.equal(record(home, 'claude-s1').state, 'working');

  hook(home, 'claude', 'notify', { session_id: 's1', message: 'Claude is waiting for your input' });
  assert.equal(record(home, 'claude-s1').state, 'working', 'idle reminder is ignored');

  hook(home, 'claude', 'done', { session_id: 's1', transcript_path: transcript(home, [prompt, say('Shipped.')]) });
  r = record(home, 'claude-s1');
  assert.equal(r.state, 'done');
  assert.equal(r.prompt, 'Fix the bug', 'prompt survives later events');

  hook(home, 'claude', 'end', { session_id: 's1' });
  assert.equal(record(home, 'claude-s1'), null);
});

test('hook: stop that asks a question means waiting', () => {
  const home = tempHome();
  hook(home, 'claude', 'done', { session_id: 's2', cwd: 'C:/x', transcript_path: transcript(home, [prompt, say('Which DB?')]) });
  const r = record(home, 'claude-s2');
  assert.equal(r.state, 'waiting');
  assert.equal(r.message, 'Which DB?');
});

test('hook: tool use creates a record for a chat that started before the hooks', () => {
  const home = tempHome();
  hook(home, 'claude', 'resume', { session_id: 's3', cwd: 'C:/x' });
  assert.equal(record(home, 'claude-s3').state, 'working');
});

test('hook: working heartbeat keeps the start time', () => {
  const home = tempHome();
  hook(home, 'claude', 'working', { session_id: 's4', cwd: 'C:/x' });
  const file = path.join(home, '.dynamic-island', 'agents', 'claude-s4.json');
  const old = { ...record(home, 'claude-s4'), since: 1000, updatedAt: Date.now() - 6 * 60 * 1000 };
  fs.writeFileSync(file, JSON.stringify(old));

  hook(home, 'claude', 'resume', { session_id: 's4' });
  const r = record(home, 'claude-s4');
  assert.ok(r.updatedAt > old.updatedAt, 'heartbeat refreshed updatedAt');
  assert.equal(r.since, 1000, 'state start time kept');
});

test('hook: background-task notifications are not the user prompt', () => {
  const home = tempHome();
  hook(home, 'claude', 'working', { session_id: 's5', cwd: 'C:/x', prompt: 'Build the installer' });
  const file = path.join(home, '.dynamic-island', 'agents', 'claude-s5.json');
  fs.writeFileSync(file, JSON.stringify({ ...record(home, 'claude-s5'), since: 1000 }));

  hook(home, 'claude', 'working', { session_id: 's5', prompt: '<task-notification>\n<task-id>b1</task-id>' });
  const r = record(home, 'claude-s5');
  assert.equal(r.prompt, 'Build the installer');
  assert.equal(r.since, 1000);
});

test('hook: Cursor payloads on the Claude hooks are ignored', () => {
  const home = tempHome();
  hook(home, 'claude', 'working', { conversation_id: 'c1', workspace_roots: ['/c:/x'], prompt: 'hi' });
  assert.equal(record(home, 'claude-c1'), null);
});

test('hook: Cursor beforeSubmitPrompt gets an explicit go-ahead', () => {
  const home = tempHome();
  const out = hook(home, 'cursor', 'working', { conversation_id: 'c2', workspace_roots: ['/c:/proj'], prompt: 'hi' });
  assert.deepEqual(JSON.parse(out), { continue: true });
  assert.equal(record(home, 'cursor-c2').project, 'proj');
});

test('hook: garbage input exits cleanly', () => {
  const home = tempHome();
  const res = spawnSync(process.execPath, [HOOK, 'claude', 'working'], {
    input: '{not json',
    env: { ...process.env, USERPROFILE: home, HOME: home },
  });
  assert.equal(res.status, 0);
});
