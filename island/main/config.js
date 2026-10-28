// User settings in ~/.vistry-island/config.json. Edited by hand (GitLab) and from the
// tray menu (toggles). A file that doesn't parse is never overwritten.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.vistry-island');
const FILE = path.join(DIR, 'config.json');

// "gitlab" is a list of accounts (one object is accepted too). Each account:
//   { name?, url, token, projects: ["group/project" | { path, ref }], ref? }
const GITLAB_ACCOUNT = { name: '', url: 'https://gitlab.com', token: '', projects: [], ref: '' };

const DEFAULTS = {
  notifications: false,
  hideInFullscreen: true,
  gitlab: [GITLAB_ACCOUNT],
};

function merge(raw) {
  const gitlab = raw.gitlab === undefined ? DEFAULTS.gitlab : [].concat(raw.gitlab || []);
  return { ...DEFAULTS, ...raw, gitlab: gitlab.map((account) => ({ ...GITLAB_ACCOUNT, ...account })) };
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

module.exports = { DIR, FILE, load, ensure, update };
