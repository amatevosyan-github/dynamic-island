// Settings panel shown inside the expanded island (gear button, or the tray icon).
// Everything is applied right away except GitLab accounts, which save with "Save" or
// when the panel closes. Tokens are write-only: the panel only learns whether one is set.
import { accountsToSave, visibleAccounts } from './gitlab-draft.mjs';

const EDGES = [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']];

export function createSettings(root, { onClose }) {
  let open = false;
  let view = null;
  let accounts = []; // editable copies: { id, name, url, ref, projects (text), token, hasToken }
  let dirty = false;
  let revision = 0; // bumps on each edit so an older save can't paint the deleted account back

  // Pages like iOS Settings: the root list, and a page per section reached with "›".
  const chevron = '<svg class="chevron" viewBox="0 0 8 14" aria-hidden="true"><path d="M1.5 1.5L6.5 7l-5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const back = '<button class="back-btn" data-nav="root"><svg viewBox="0 0 8 14" aria-hidden="true"><path d="M6.5 1.5L1.5 7l5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Settings</button>';

  root.innerHTML = `
    <section class="page" data-page="root">
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

        <div class="group-label">Sources</div>
        <div class="group">
          <button class="cell nav" data-nav="agents">
            <span class="nav-icon" style="--t:#d97757">AI</span>
            <span class="nav-title">Agents</span>
            <span class="nav-value" data-role="agents-value"></span>${chevron}
          </button>
          <button class="cell nav" data-nav="gitlab">
            <span class="nav-icon" style="--t:#fc6d26">GL</span>
            <span class="nav-title">GitLab</span>
            <span class="nav-value" data-role="gitlab-value"></span>${chevron}
          </button>
        </div>

        <div class="group">
          <button class="cell danger" data-act="quit">Quit Dynamic Island</button>
        </div>
      </div>
    </section>

    <section class="page" data-page="agents" hidden>
      <div class="settings-head">${back}<span class="settings-title">Agents</span><span class="head-spacer"></span></div>
      <div class="settings-scroll">
        <div class="group">
          <div class="cell">
            <div class="cell-text"><span>Claude &amp; Cursor hooks</span><span class="cell-sub" data-role="hooks-state"></span></div>
            <button class="pill-btn" data-act="hooks"></button>
          </div>
        </div>
        <div class="group-note">The hooks report each chat's state to the island. They go into
          ~/.claude/settings.json and ~/.cursor/hooks.json; your other settings are kept.
          Restart Cursor after installing.</div>
      </div>
    </section>

    <section class="page" data-page="gitlab" hidden>
      <div class="settings-head">${back}<span class="settings-title">GitLab</span><span class="head-spacer"></span></div>
      <div class="settings-scroll">
        <div data-role="accounts"></div>
        <div class="settings-actions">
          <button class="pill-btn" data-act="add">Add account</button>
          <button class="pill-btn primary" data-act="save" disabled>Save</button>
        </div>
        <div class="group-note" data-role="status"></div>
        <div class="group-note">Projects: one per line, <code>group/project</code> or
          <code>group/project@branch</code>. The token only needs to read pipelines and projects.</div>
      </div>
    </section>`;

  const $ = (sel) => root.querySelector(sel);

  function showPage(name) {
    for (const page of root.querySelectorAll('.page')) {
      const on = page.dataset.page === name;
      page.hidden = !on;
      page.classList.toggle('from-left', on && name === 'root');
    }
  }
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

  function markDirty() {
    revision += 1;
    setDirty(true);
  }

  function apply(next) {
    view = next;
    for (const input of root.querySelectorAll('.switch')) input.checked = !!view[input.dataset.key];
    for (const btn of root.querySelectorAll('[data-edge]')) btn.classList.toggle('on', btn.dataset.edge === view.edge);
    $('[data-role="hooks-state"]').textContent = view.hooksInstalled ? 'Installed' : 'Not installed';
    $('[data-act="hooks"]').textContent = view.hooksInstalled ? 'Remove' : 'Install';
    $('[data-role="agents-value"]').textContent = view.hooksInstalled ? 'On' : 'Off';
    const n = view.gitlab.length;
    $('[data-role="gitlab-value"]').textContent = n ? `${n} account${n === 1 ? '' : 's'}` : 'Not set';
    if (view.error) status(view.error, true);
  }

  function loadAccounts() {
    accounts = visibleAccounts(view.gitlab);
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
      markDirty();
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
      remove.type = 'button';
      remove.className = 'cell danger';
      remove.textContent = 'Remove account';
      // pointerdown runs before a window blur, so a blur-save can't snapshot this account first.
      let removed = false;
      const drop = (e) => {
        e.stopPropagation();
        if (removed) return;
        removed = true;
        accounts.splice(i, 1);
        renderAccounts();
        markDirty();
      };
      remove.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        drop(e);
      });
      remove.addEventListener('click', drop);
      group.append(remove);
      return group;
    }));
  }

  async function saveAccounts() {
    const rev = revision;
    const payload = accountsToSave(accounts);
    const next = await window.island.settings.saveGitlab(payload);
    if (rev !== revision) {
      // A removal landed while this save was writing the old list. Persist the shorter one.
      if (accountsToSave(accounts).length < payload.length) return saveAccounts();
      return;
    }
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
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      showPage(nav.dataset.nav);
      return;
    }
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
      showPage('root');
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
