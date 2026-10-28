// Agent chats (Claude Code, Cursor) reported by hooks/agent-status.js.
// Each chat is one JSON file in ~/.dynamic-island/agents/; we watch the folder.
// Claude chats are enriched from the Claude desktop app's session index
// (title, archived flag, deep link to open the chat).
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.dynamic-island', 'agents');
const HOUR = 60 * 60 * 1000;
// Chats drop off the island after this long without an update (working chats refresh
// every few minutes via the hook's heartbeat), and their files are deleted after a day.
const TTL = { done: HOUR, error: HOUR, waiting: 12 * HOUR, working: 6 * HOUR };
const DELETE_AFTER = 24 * HOUR;

const NOTIFY = {
  waiting: (a) => [`${a.title || a.project} needs you`, a.message || a.prompt || ''],
  done: (a) => [`${a.title || a.project} is done`, a.prompt || ''],
  error: (a) => [`${a.title || a.project} stopped with an error`, a.prompt || ''],
};

// Claude desktop keeps one local_<id>.json per Code session: MSIX installs under
// %LOCALAPPDATA%\Claude-Data\<package>\, regular installs under %APPDATA%\Claude\.
function desktopSessionRoots() {
  const roots = [];
  const data = path.join(process.env.LOCALAPPDATA || '', 'Claude-Data');
  try {
    for (const pkg of fs.readdirSync(data)) roots.push(path.join(data, pkg, 'claude-code-sessions'));
  } catch {
    // not an MSIX install
  }
  roots.push(path.join(process.env.APPDATA || '', 'Claude', 'claude-code-sessions'));
  return roots.filter((r) => fs.existsSync(r));
}

const desktopCache = new Map(); // file -> { mtimeMs, record }

function desktopIndex() {
  const byCli = new Map();
  const seen = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!/^local_.*\.json$/.test(entry.name)) continue;
      seen.add(file);
      const { mtimeMs } = fs.statSync(file);
      let cached = desktopCache.get(file);
      if (!cached || cached.mtimeMs !== mtimeMs) {
        try {
          const j = JSON.parse(fs.readFileSync(file, 'utf8'));
          cached = { mtimeMs, record: { id: j.sessionId, cli: j.cliSessionId, title: j.title, archived: !!j.isArchived } };
        } catch {
          cached = { mtimeMs, record: null }; // mid-write; retried on the next mtime change
        }
        desktopCache.set(file, cached);
      }
      if (cached.record && cached.record.cli) byCli.set(cached.record.cli, cached.record);
    }
  };
  for (const root of desktopSessionRoots()) {
    try {
      walk(root);
    } catch {
      // unreadable root
    }
  }
  for (const file of desktopCache.keys()) if (!seen.has(file)) desktopCache.delete(file);
  return byCli;
}

// "/c:/Projects/x" (Cursor's workspace_roots) -> "c:/Projects/x"
const fsPath = (p) => (p || '').replace(/^\/([a-zA-Z]:)/, '$1').replace(/\\/g, '/');

// Cursor chats have no title we can read, so use the chat's first request
// (first line of ~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl).
const cursorTitles = new Map(); // session -> title | null

function cursorTitle(session) {
  if (cursorTitles.has(session)) return cursorTitles.get(session);
  let title = null;
  const root = path.join(os.homedir(), '.cursor', 'projects');
  const id = String(session).replace(/[^\w-]/g, '');
  try {
    for (const slug of fs.readdirSync(root)) {
      const file = path.join(root, slug, 'agent-transcripts', id, `${id}.jsonl`);
      if (!fs.existsSync(file)) continue;
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(8192);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const first = JSON.parse(buf.toString('utf8', 0, n).split('\n')[0]);
      const text = (first.message.content.find((c) => c.type === 'text') || {}).text || '';
      const query = (text.match(/<user_query>([\s\S]*?)<\/user_query>/) || [])[1] || text;
      title = query.replace(/\s+/g, ' ').trim().slice(0, 80) || null;
      break;
    }
  } catch {
    // no transcript (yet) or an unexpected format
  }
  if (title) cursorTitles.set(session, title);
  return title;
}

function enrich(a, desktop) {
  if (a.tool === 'claude') {
    const d = desktop.get(a.session);
    if (d && d.archived) return null;
    if (d) return { ...a, title: d.title, openUrl: `claude://code/continue?session=${encodeURIComponent(d.id)}` };
    return a; // CLI session: nothing to open
  }
  if (a.tool === 'cursor' && a.cwd) {
    // Cursor can't target a chat; this brings up the window for that workspace.
    return { ...a, title: cursorTitle(a.session), openUrl: `cursor://file/${encodeURI(fsPath(a.cwd))}` };
  }
  return a;
}

function scan() {
  const now = Date.now();
  const desktop = desktopIndex();
  const items = [];
  for (const name of fs.readdirSync(DIR)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(DIR, name);
    try {
      const a = JSON.parse(fs.readFileSync(file, 'utf8'));
      const age = now - a.updatedAt;
      if (age >= DELETE_AFTER) fs.rmSync(file, { force: true });
      if (age >= (TTL[a.state] || HOUR)) continue;
      const item = enrich({ ...a, key: name.slice(0, -'.json'.length), since: a.since || a.updatedAt }, desktop);
      if (item) items.push(item);
    } catch {
      // half-written or foreign file
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Set by start(); command() runs while the provider is started.
let active = null;

module.exports = {
  id: 'agents',
  start(emit, ctx) {
    fs.mkdirSync(DIR, { recursive: true });
    let last = '';
    let debounce;
    let lastStates = null; // key -> state; null until the first scan, so startup doesn't notify

    const refresh = () => {
      const items = scan();
      if (lastStates) {
        for (const a of items) {
          if (lastStates.get(a.key) !== a.state && NOTIFY[a.state]) ctx.notify(...NOTIFY[a.state](a), a.openUrl);
        }
      }
      lastStates = new Map(items.map((a) => [a.key, a.state]));

      const json = JSON.stringify(items);
      if (json !== last) {
        last = json;
        emit(items);
      }
      return items;
    };

    active = { ctx, refresh };

    const watcher = fs.watch(DIR, () => {
      clearTimeout(debounce);
      debounce = setTimeout(refresh, 100);
    });
    const timer = setInterval(refresh, 30 * 1000); // expire stale chats, pick up renames

    refresh();
    return () => {
      active = null;
      watcher.close();
      clearInterval(timer);
      clearTimeout(debounce);
    };
  },

  // "menu" { key }: right-click menu of a chat row.
  command(name, payload) {
    if (!active || name !== 'menu' || !payload) return;
    const { ctx, refresh } = active;
    const key = String(payload.key || '').replace(/[^\w-]/g, '');
    const chat = refresh().find((a) => a.key === key);
    if (!chat) return;
    ctx.popupMenu([
      { label: `Open in ${chat.tool === 'cursor' ? 'Cursor' : 'Claude'}`, enabled: !!chat.openUrl, click: () => ctx.open(chat.openUrl) },
      {
        // The hook recreates the file on the chat's next activity, so it comes back then.
        label: 'Hide until it changes',
        click: () => {
          fs.rmSync(path.join(DIR, `${key}.json`), { force: true });
          refresh();
        },
      },
    ]);
  },
};
