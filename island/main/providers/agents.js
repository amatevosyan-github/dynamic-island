// Agent chats (Claude Code, Cursor) reported by hooks/agent-status.js.
// Each chat is one JSON file in ~/.vistry-island/agents/; we watch the folder.
// Claude chats are enriched from the Claude desktop app's session index
// (title, archived flag, deep link to open the chat).
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.vistry-island', 'agents');
const HOUR = 60 * 60 * 1000;
// Chats drop off the island after this long without an update.
const TTL = { done: HOUR, error: HOUR, waiting: 12 * HOUR, working: 6 * HOUR };

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

function enrich(a, desktop) {
  if (a.tool === 'claude') {
    const d = desktop.get(a.session);
    if (d && d.archived) return null;
    if (d) return { ...a, title: d.title, openUrl: `claude://code/continue?session=${encodeURIComponent(d.id)}` };
    return a; // CLI session: nothing to open
  }
  if (a.tool === 'cursor' && a.cwd) {
    // Cursor can't target a chat; this brings up the window for that workspace.
    return { ...a, openUrl: `cursor://file/${encodeURI(fsPath(a.cwd))}` };
  }
  return a;
}

function scan() {
  const now = Date.now();
  const desktop = desktopIndex();
  const items = [];
  for (const name of fs.readdirSync(DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const a = JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
      if (now - a.updatedAt >= (TTL[a.state] || HOUR)) continue;
      const item = enrich(a, desktop);
      if (item) items.push(item);
    } catch {
      // half-written or foreign file
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

module.exports = {
  id: 'agents',
  start(emit) {
    fs.mkdirSync(DIR, { recursive: true });
    let last = '';
    let debounce;

    const refresh = () => {
      const items = scan();
      const json = JSON.stringify(items);
      if (json !== last) {
        last = json;
        emit(items);
      }
    };

    const watcher = fs.watch(DIR, () => {
      clearTimeout(debounce);
      debounce = setTimeout(refresh, 100);
    });
    const timer = setInterval(refresh, 30 * 1000); // expire stale chats, pick up renames

    refresh();
    return () => {
      watcher.close();
      clearInterval(timer);
      clearTimeout(debounce);
    };
  },
};
