#!/usr/bin/env node
// Status hook for Claude Code and Cursor agents.
//
//   node agent-status.js <claude|cursor> <working|done|notify|resume|end>
//
// Reads the hook payload (JSON) from stdin and keeps one file per chat in
// ~/.dynamic-island/agents/, which the island's "agents" provider watches.
// Never fails the host tool: any error is swallowed and the hook exits 0.
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentsDir = () => path.join(os.homedir(), '.dynamic-island', 'agents');
// A long-running chat refreshes its record this often, so it doesn't expire mid-run.
const HEARTBEAT_MS = 5 * 60 * 1000;

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Cursor keeps transcripts at ~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl.
function cursorTranscript(session) {
  const root = path.join(os.homedir(), '.cursor', 'projects');
  const id = String(session).replace(/[^\w-]/g, '');
  try {
    for (const slug of fs.readdirSync(root)) {
      const file = path.join(root, slug, 'agent-transcripts', id, `${id}.jsonl`);
      if (fs.existsSync(file)) return file;
    }
  } catch {
    // no Cursor projects folder
  }
  return null;
}

// Did the turn that just ended ask the user something? Reads the tail of a Claude or
// Cursor transcript (JSONL; entries carry `type` or `role`) back to the last real user
// prompt. Returns the question text or null.
const TAIL_BYTES = 512 * 1024;

function lastTurnQuestion(transcript) {
  if (!transcript) return null;
  let text;
  try {
    const fd = fs.openSync(transcript, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch {
    return null;
  }

  const entries = text.split('\n').map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null; // first line of the tail is usually cut
    }
  });

  let lastText = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || !e.message) continue;
    const content = e.message.content;
    const kind = e.type || e.role;
    if (kind === 'user') {
      const isPrompt = typeof content === 'string' || (Array.isArray(content) && content.some((c) => c.type === 'text'));
      if (isPrompt) break;
      continue;
    }
    if (kind !== 'assistant' || !Array.isArray(content)) continue;
    for (const c of content) {
      // Desktop app: the turn's question goes into the next-step box.
      if (c.type === 'tool_use' && /wrap_up$/.test(c.name) && c.input && c.input.ask) return String(c.input.ask);
      if (c.type === 'tool_use' && c.name === 'AskUserQuestion') return 'Claude asked a question';
      if (c.type === 'text' && lastText === null && c.text.trim()) lastText = c.text.trim();
    }
  }

  // CLI and plain replies: the answer ends with a question.
  if (lastText && /[?？]$/.test(lastText.replace(/[*_`\s]+$/, ''))) {
    const line = lastText.split('\n').filter((l) => l.trim()).pop();
    return line.replace(/[*_`#>]/g, '').trim().slice(0, 120);
  }
  return null;
}

// Claude's "waiting for your input" idle reminder isn't news: the chat already reported done.
function isIdleNotice(p) {
  return p.notification_type === 'idle_prompt' || /waiting for your input/i.test(p.message || '');
}

function run(tool, event, p) {
  const session = p.session_id || p.conversation_id;
  if (!tool || !session) return;
  // Cursor also runs the hooks from ~/.claude/settings.json; its own hooks.json
  // already reports the chat, so drop the Claude-flavoured duplicate.
  if (tool === 'claude' && (p.conversation_id || p.workspace_roots || p.cursor_version)) return;

  const dir = agentsDir();
  const file = path.join(dir, `${tool}-${String(session).replace(/[^\w-]/g, '')}.json`);
  if (event === 'end') return fs.rmSync(file, { force: true });

  const now = Date.now();
  const prev = read(file);
  // Tool activity means the chat is working: picks up sessions that started before the
  // hooks existed and clears "waiting" after a permission prompt. Rewrites of a working
  // chat are throttled to the heartbeat, and a late async PostToolUse can't undo a fresh Stop.
  if (event === 'resume' && prev) {
    if (prev.state === 'working' && now - prev.updatedAt < HEARTBEAT_MS) return;
    if (prev.state !== 'waiting' && prev.state !== 'working' && now - prev.updatedAt < 5000) return;
  }
  if (event === 'notify' && isIdleNotice(p)) return;

  let state = { working: 'working', resume: 'working', done: 'done', notify: 'waiting' }[event];
  if (!state) return;
  if (event === 'done' && p.status === 'error') state = 'error';

  let message = event === 'notify' ? p.message : undefined;
  if (event === 'done' && state === 'done') {
    const transcript = p.transcript_path || (tool === 'cursor' ? cursorTranscript(session) : null);
    const question = lastTurnQuestion(transcript);
    if (question) {
      state = 'waiting';
      message = question;
    }
  }

  // Claude Code delivers background-task and app events as prompts (<task-notification>…);
  // they aren't the user's words, so they neither replace the prompt nor restart the clock.
  const injected = typeof p.prompt === 'string' && /^\s*<(task-notification|system-reminder|[a-z-]+-event)\b/.test(p.prompt);
  const userPrompt = event === 'working' && !injected;

  const cwd = p.cwd || (p.workspace_roots || [])[0] || (prev && prev.cwd) || '';
  const prompt = typeof p.prompt === 'string' && !injected
    ? p.prompt.replace(/\s+/g, ' ').trim().slice(0, 100)
    : prev && prev.prompt;
  // When the current state began: kept across heartbeats, reset by a new prompt.
  const since = prev && prev.state === state && !userPrompt ? prev.since || prev.updatedAt : now;

  const record = {
    tool,
    session,
    cwd,
    project: path.basename(cwd.replace(/[\\/]+$/, '')) || tool,
    prompt,
    message,
    state,
    since,
    updatedAt: now,
  };

  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, file);
}

module.exports = { lastTurnQuestion, run };

if (require.main === module) {
  const [tool, event] = process.argv.slice(2);
  const finish = () => {
    // Cursor's beforeSubmitPrompt expects an explicit go-ahead.
    if (tool === 'cursor' && event === 'working') process.stdout.write('{"continue":true}\n');
    process.exit(0);
  };

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    try {
      run(tool, event, JSON.parse(input || '{}'));
    } catch {
      // ignore: status is best-effort
    }
    finish();
  });
  setTimeout(finish, 1500).unref();
}
