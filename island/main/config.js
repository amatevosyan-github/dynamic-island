// User settings in ~/.vistry-island/config.json. Edited from the island's settings panel
// or by hand. A file that doesn't parse is never overwritten.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.vistry-island');
const FILE = path.join(DIR, 'config.json');

const EDGES = ['top', 'bottom', 'left', 'right'];

// "gitlab" is a list of accounts (one object is accepted too). Each account:
//   { id, name?, url, token | tokenEnc, projects: ["group/project" | { path, ref }], ref? }
// tokenEnc is a token encrypted with the OS keystore (set from the settings panel);
// a plain "token" typed into the file by hand works too.
const GITLAB_ACCOUNT = { name: '', url: 'https://gitlab.com', token: '', projects: [], ref: '' };

const DEFAULTS = {
  notifications: false,
  hideInFullscreen: true,
  // Screen edge the island sits on, and where along it (0..1); display is a screen id.
  dock: { edge: 'top', offset: 0.5, display: null },
  gitlab: [],
};

function merge(raw) {
  const gitlab = [].concat(raw.gitlab || []).filter((a) => a && typeof a === 'object');
  const dock = { ...DEFAULTS.dock, ...(raw.dock || {}) };
  if (!EDGES.includes(dock.edge)) dock.edge = 'top';
  dock.offset = Math.min(1, Math.max(0, Number(dock.offset) || 0.5));
  return {
    ...DEFAULTS,
    ...raw,
    dock,
    gitlab: gitlab.map((account, i) => ({ ...GITLAB_ACCOUNT, id: `acct-${i + 1}`, ...account })),
  };
}

// { config, error }: on a broken file, defaults plus the parse error.
function load() {
  try {
    return { config: merge(JSON.parse(fs.readFileSync(FILE, 'utf8'))), error: null };
  } catch (e) {
    if (e.code === 'ENOENT') return { config: merge({}), error: null };
    return { config: merge({}), error: `${FILE}: ${e.message}` };
  }
}

function ensure() {
  if (fs.existsSync(FILE)) return;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(DEFAULTS, null, 2)}\n`);
}

// Applies mutate(config) and saves; returns the error instead when the file is broken.
function update(mutate) {
  const { config, error } = load();
  if (error) return error;
  mutate(config);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(config, null, 2)}\n`);
  return null;
}

module.exports = { DIR, FILE, EDGES, load, ensure, update };
