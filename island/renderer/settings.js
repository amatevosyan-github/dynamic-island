// Settings panel shown inside the expanded island (gear button, or the tray icon).
// Everything is applied right away except GitLab accounts, which save with "Save" or
// when the panel closes. Tokens are write-only: the panel only learns whether one is set.
const EDGES = [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']];

// "group/project" or "group/project@branch" per line <-> config entries.
const projectsToText = (projects) => projects.map((p) => (typeof p === 'string' ? p : `${p.path}@${p.ref}`)).join('\n');
const textToProjects = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const at = l.lastIndexOf('@');
  return at > 0 ? { path: l.slice(0, at).trim(), ref: l.slice(at + 1).trim() } : l;
});

export function createSettings(root, { onClose }) {
  let open = false;
  let view = null;
  let accounts = []; // editable copies: { id, name, url, ref, projects (text), token, hasToken }
  let dirty = false;

  root.innerHTML = `
    <div class="settings-head">
      <span class="settings-title">Settings</span>
      <button class="pill-btn" data-act="close">Done</button>
    </div>
    <div class="settings-scroll">
      <div class="group-label">General</div>
      <div class="group">
        <label class="cell"><span>Launch at startup</span><input type="checkbox" class="switch" data-key="launchAtStartup"></label>
        <label class="cell"><span>Notifications</span><input type="checkbox" class="switch" data-key="notifications"></label>
        <label class="cell"><span>Hide in full screen</span><input type="checkbox" class="switch" data-key="hideInFullscreen"></label>
      </div>

      <div class="group-label">Position</div>
      <div class="group">
        <div class="cell"><div class="segmented" data-role="edge">
          ${EDGES.map(([id, label]) => `<button data-edge="${id}">${label}</button>`).join('')}
        </div></div>
      </div>
      <div class="group-note">Or drag the island to any edge of the screen.</div>

      <div class="group-label">Agents</div>
      <div class="group">
        <div class="cell">
          <div class="cell-text"><span>Claude &amp; Cursor hooks</span><span class="cell-sub" data-role="hooks-state"></span></div>
          <button class="pill-btn" data-act="hooks"></button>
        </div>
      </div>

      <div class="group-label">GitLab</div>
      <div data-role="accounts"></div>
      <div class="settings-actions">
        <button class="pill-btn" data-act="add">Add account</button>
        <button class="pill-btn primary" data-act="save" disabled>Save</button>
      </div>
      <div class="group-note" data-role="status"></div>

      <div class="group">
        <button class="cell danger" data-act="quit">Quit Dynamic Island</button>
      </div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const accountsEl = $('[data-role="accounts"]');
  const statusEl = $('[data-role="status"]');
  const saveBtn = $('[data-act="save"]');

  function status(text, error = false) {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', error);
  }

  function setDirty(value) {
    dirty = value;
    saveBtn.disabled = !value;
  }

  function apply(next) {
    view = next;
    for (const input of root.querySelectorAll('.switch')) input.checked = !!view[input.dataset.key];
    for (const btn of root.querySelectorAll('[data-edge]')) btn.classList.toggle('on', btn.dataset.edge === view.edge);
    $('[data-role="hooks-state"]').textContent = view.hooksInstalled ? 'Installed' : 'Not installed';
    $('[data-act="hooks"]').textContent = view.hooksInstalled ? 'Remove' : 'Install';
    if (view.error) status(view.error, true);
  }

  function loadAccounts() {
    accounts = view.gitlab.map((a) => ({ ...a, projects: projectsToText(a.projects), token: '' }));
    if (!accounts.length) accounts.push(blankAccount());
    renderAccounts();
    setDirty(false);
  }

  const blankAccount = () => ({ id: '', name: '', url: 'https://gitlab.com', ref: '', projects: '', token: '', hasToken: false });

  function field(account, key, label, { type = 'text', placeholder = '', multiline = false } = {}) {
    const cell = document.createElement('label');
    cell.className = multiline ? 'cell field column' : 'cell field';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = type;
    if (multiline) input.rows = 3;
    input.placeholder = placeholder;
    input.value = account[key];
    input.spellcheck = false;
    input.addEventListener('input', () => {
      account[key] = input.value;
      setDirty(true);
      status('');
    });
    cell.append(name, input);
    return cell;
  }

  function renderAccounts() {
    accountsEl.replaceChildren(...accounts.map((account, i) => {
      const group = document.createElement('div');
      group.className = 'group';
      group.append(
        field(account, 'name', 'Name', { placeholder: 'work' }),
        field(account, 'url', 'URL', { placeholder: 'https://gitlab.com' }),
        field(account, 'token', 'Token', {
          type: 'password',
          placeholder: account.hasToken ? 'Saved · type to replace' : 'read_api token',
        }),
        field(account, 'projects', 'Projects', { multiline: true, placeholder: 'group/project\ngroup/api@main' }),
      );
      const remove = document.createElement('button');
      remove.className = 'cell danger';
      remove.textContent = 'Remove account';
      remove.addEventListener('click', () => {
        accounts.splice(i, 1);
        renderAccounts();
        setDirty(true);
      });
      group.append(remove);
      return group;
    }));
  }

  async function saveAccounts() {
    const payload = accounts
      .filter((a) => a.id || a.name || a.token || a.projects.trim())
      .map((a) => ({ id: a.id, name: a.name, url: a.url, ref: a.ref, projects: textToProjects(a.projects), token: a.token }));
    const next = await window.island.settings.saveGitlab(payload);
    apply(next);
    if (!next.error) {
      loadAccounts();
      status('Saved');
    }
  }

  root.addEventListener('change', async (e) => {
    const key = e.target.dataset && e.target.dataset.key;
    if (key) apply(await window.island.settings.set({ [key]: e.target.checked }));
  });

  root.addEventListener('click', async (e) => {
    const edgeBtn = e.target.closest('[data-edge]');
    if (edgeBtn) {
      apply(await window.island.settings.set({ edge: edgeBtn.dataset.edge }));
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'close':
        onClose();
        break;
      case 'hooks':
        apply(await window.island.settings.setHooks(!view.hooksInstalled));
        break;
      case 'add':
        accounts.push(blankAccount());
        renderAccounts();
        accountsEl.lastElementChild.querySelector('input').focus();
        break;
      case 'save':
        await saveAccounts();
        break;
      case 'quit':
        window.island.quit();
        break;
      default:
    }
  });

  return {
    isOpen: () => open,
    async open() {
      if (open) return;
      open = true;
      root.hidden = false;
      status('');
      apply(await window.island.settings.get());
      loadAccounts();
    },
    close() {
      if (!open) return;
      open = false;
      root.hidden = true;
      if (dirty) saveAccounts(); // don't lose a token typed before clicking away
    },
  };
}
