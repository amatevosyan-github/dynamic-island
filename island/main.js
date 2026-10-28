const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, shell, Notification, dialog } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./main/config');
const dock = require('./main/dock');
const hooks = require('./main/hooks');
const providers = require('./main/providers');
const secrets = require('./main/secrets');
const { watchFullscreen } = require('./main/fullscreen');

const BUNDLED_HOOK = path.join(__dirname, 'hooks', 'agent-status.js');
// Packaged builds can't point hooks into the app archive, so the script is copied here.
const INSTALLED_HOOK = path.join(config.DIR, 'hooks', 'agent-status.js');

let win;
let tray;
let settings = config.load().config;
let fullscreen = false;
let drag = null; // { edge, timer } while the pill is being dragged
let snapTimer;
const stopFns = [];
const commandHandlers = new Map(); // provider id -> command(name, payload)
const liveNotifications = new Set(); // keeps click handlers alive until dismissed

const send = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload);

// ---------- window & docking ----------

function displayFor(d) {
  return screen.getAllDisplays().find((s) => s.id === d.display) || screen.getPrimaryDisplay();
}

// Moves the window to its dock; `animate` glides it there like a snap.
function place({ animate = false } = {}) {
  if (!win || win.isDestroyed() || drag) return;
  const d = settings.dock;
  const to = dock.windowPosition(d.edge, d.offset, displayFor(d).workArea);
  clearInterval(snapTimer);
  if (!animate) {
    win.setBounds({ ...to, ...dock.WIN });
    return;
  }
  const [fx, fy] = win.getPosition();
  const start = Date.now();
  const DURATION = 280;
  // easeOutBack: a small overshoot, like the island settling into place.
  const ease = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
  snapTimer = setInterval(() => {
    const t = Math.min(1, (Date.now() - start) / DURATION);
    const k = ease(t);
    win.setBounds({ x: Math.round(fx + (to.x - fx) * k), y: Math.round(fy + (to.y - fy) * k), ...dock.WIN });
    if (t === 1) clearInterval(snapTimer);
  }, 16);
}

function createWindow() {
  win = new BrowserWindow({
    ...dock.WIN,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // made focusable only while the settings panel is open
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  place();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', updateVisibility);
  win.webContents.on('did-finish-load', () => {
    send('island:dock', { edge: settings.dock.edge });
    startProviders();
  });
  win.on('blur', () => send('island:blur'));

  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => place());
}

function updateVisibility() {
  if (!win || win.isDestroyed()) return;
  if (fullscreen && settings.hideInFullscreen) win.hide();
  else if (!win.isVisible()) win.showInactive();
}

// Dragging: the window follows the cursor and the pill turns to face the nearest edge;
// on release it snaps to that edge of the display under the cursor.
function startDrag() {
  if (drag || !win) return;
  clearInterval(snapTimer);
  win.setIgnoreMouseEvents(false);
  drag = { edge: settings.dock.edge };
  drag.timer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    const edge = dock.nearestEdge(p, screen.getDisplayNearestPoint(p).workArea);
    if (edge !== drag.edge) {
      drag.edge = edge;
      send('island:dock', { edge, dragging: true });
    }
    const at = dock.followCursor(edge, p);
    win.setBounds({ ...at, ...dock.WIN });
  }, 16);
}

function endDrag() {
  if (!drag) return;
  clearInterval(drag.timer);
  drag = null;
  const p = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(p);
  const edge = dock.nearestEdge(p, display.workArea);
  settings.dock = { edge, offset: dock.offsetOn(edge, p, display.workArea), display: display.id };
  config.update((c) => {
    c.dock = settings.dock;
  });
  send('island:dock', { edge });
  place({ animate: true });
}

// ---------- providers ----------

function openUrl(url) {
  try {
    if (OPENABLE.has(new URL(url).protocol)) shell.openExternal(url);
  } catch {
    // not a URL
  }
}

function notify(title, body, url) {
  if (!settings.notifications || !Notification.isSupported()) return;
  const n = new Notification({ title, body });
  liveNotifications.add(n);
  n.on('click', () => url && openUrl(url));
  n.on('close', () => liveNotifications.delete(n));
  n.show();
}

function startProviders() {
  stopProviders();
  // Providers get tokens in the clear; the stored config keeps them encrypted.
  const providerConfig = { ...settings, gitlab: settings.gitlab.map((a) => ({ ...a, token: secrets.reveal(a) })) };
  const ctx = {
    config: providerConfig,
    notify,
    open: openUrl,
    popupMenu: (template) => win && Menu.buildFromTemplate(template).popup({ window: win }),
  };
  for (const provider of providers) {
    const emit = (data) => send('island:data', { id: provider.id, data });
    try {
      const stop = provider.start(emit, ctx);
      if (typeof stop === 'function') stopFns.push(stop);
      if (provider.command) commandHandlers.set(provider.id, provider.command);
    } catch (e) {
      console.error(`provider ${provider.id} failed to start:`, e); // the others still run
    }
  }
}

function stopProviders() {
  while (stopFns.length) stopFns.pop()();
  commandHandlers.clear();
}

// Applies the config file to the running island (after the panel saves or a hand edit).
function reloadSettings() {
  const { config: next, error } = config.load();
  if (error) return error; // keep running on the last good settings
  const providersChanged = JSON.stringify(next.gitlab) !== JSON.stringify(settings.gitlab);
  const dockChanged = JSON.stringify(next.dock) !== JSON.stringify(settings.dock);
  settings = next;
  updateVisibility();
  if (dockChanged && !drag) {
    send('island:dock', { edge: settings.dock.edge });
    place({ animate: true });
  }
  if (providersChanged) startProviders();
  return null;
}

function watchConfig() {
  config.ensure();
  let debounce;
  // Watch the folder: editors that save by replacing the file would end a file watch.
  fs.watch(config.DIR, (_event, name) => {
    if (name && name !== path.basename(config.FILE)) return;
    clearTimeout(debounce);
    debounce = setTimeout(reloadSettings, 200);
  });
}

// ---------- settings panel ----------

// Autostart registers this exact executable (+ app path in dev), so read it back the same way.
const loginItem = () => ({ path: process.execPath, args: app.isPackaged ? [] : [path.resolve(__dirname)] });

function hookScript() {
  if (!app.isPackaged) return BUNDLED_HOOK;
  fs.mkdirSync(path.dirname(INSTALLED_HOOK), { recursive: true });
  fs.copyFileSync(BUNDLED_HOOK, INSTALLED_HOOK);
  return INSTALLED_HOOK;
}

// What the panel shows. Tokens never leave the main process: only whether one is set.
function settingsView(extra = {}) {
  return {
    notifications: settings.notifications,
    hideInFullscreen: settings.hideInFullscreen,
    launchAtStartup: app.getLoginItemSettings(loginItem()).openAtLogin,
    edge: settings.dock.edge,
    hooksInstalled: !!hooks.installedScript(),
    gitlab: settings.gitlab.map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      ref: a.ref,
      projects: a.projects,
      hasToken: !!(a.token || a.tokenEnc),
    })),
    ...extra,
  };
}

const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);

function saveConfig(mutate) {
  const error = config.update(mutate);
  if (error) return settingsView({ error: `Settings file is not valid JSON, fix it first. ${error}` });
  reloadSettings();
  return settingsView();
}

ipcMain.handle('settings:get', () => settingsView());

ipcMain.handle('settings:set', (_e, patch = {}) => {
  if ('launchAtStartup' in patch) app.setLoginItemSettings({ ...loginItem(), openAtLogin: !!patch.launchAtStartup });
  return saveConfig((c) => {
    for (const key of ['notifications', 'hideInFullscreen']) if (key in patch) c[key] = !!patch[key];
    if (config.EDGES.includes(patch.edge) && patch.edge !== c.dock.edge) c.dock = { ...c.dock, edge: patch.edge, offset: 0.5 };
  });
});

// accounts: [{ id?, name, url, ref, projects, token? }]; a blank token keeps the saved one.
ipcMain.handle('settings:gitlab', (_e, accounts = []) => {
  const saved = new Map(settings.gitlab.map((a) => [a.id, a]));
  const next = [].concat(accounts).slice(0, 20).map((a) => {
    const old = saved.get(a.id) || {};
    const projects = [].concat(a.projects || []).slice(0, 100).map((p) => {
      if (typeof p === 'string') return str(p, 300);
      return p && p.ref ? { path: str(p.path, 300), ref: str(p.ref, 200) } : str(p && p.path, 300);
    }).filter((p) => (typeof p === 'string' ? p : p.path));
    const account = {
      id: typeof a.id === 'string' && a.id ? a.id.slice(0, 40) : `acct-${crypto.randomUUID().slice(0, 8)}`,
      name: str(a.name, 60),
      url: str(a.url, 300) || 'https://gitlab.com',
      ref: str(a.ref, 200),
      projects,
    };
    const token = str(a.token, 500);
    if (token) Object.assign(account, secrets.seal(token));
    else Object.assign(account, { token: old.token || '', ...(old.tokenEnc ? { tokenEnc: old.tokenEnc } : {}) });
    return account;
  });
  return saveConfig((c) => {
    c.gitlab = next;
  });
});

ipcMain.handle('settings:hooks', (_e, install) => {
  try {
    if (install) hooks.install(hookScript());
    else hooks.uninstall();
    return settingsView();
  } catch (e) {
    return settingsView({ error: e.message });
  }
});

// ---------- tray ----------

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Settings…', click: () => send('island:open-settings') },
    { label: 'Reload', click: () => win && win.reload() },
    { type: 'separator' },
    { label: 'Quit Dynamic Island', click: () => app.quit() },
  ]);
}

// Packaged first run: offer to install the hooks; afterwards keep the copied script current.
async function checkHooks() {
  if (!app.isPackaged) return;
  const installed = hooks.installedScript();
  if (installed) {
    if (path.resolve(installed) === path.resolve(INSTALLED_HOOK)) hookScript();
    return;
  }
  const { config: c } = config.load();
  if (c.hooksOffered) return;
  config.update((cfg) => {
    cfg.hooksOffered = true;
  });
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Install', 'Not now'],
    defaultId: 0,
    title: 'Dynamic Island',
    message: 'Show your Claude Code and Cursor chats on the island?',
    detail:
      'This adds status hooks to ~/.claude/settings.json and ~/.cursor/hooks.json (your other settings are kept, a .bak copy is made). ' +
      'You can remove them later in the island settings.',
  });
  if (response !== 0) return;
  try {
    hooks.install(hookScript());
  } catch (e) {
    dialog.showErrorBox('Dynamic Island', e.message);
  }
}

// 16x16 white dot drawn as a raw BGRA bitmap, so no icon file is needed.
function trayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const a = Math.max(0, Math.min(1, 6.5 - d));
      buf.fill(Math.round(255 * a), (y * size + x) * 4, (y * size + x) * 4 + 4);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

// ---------- IPC ----------

// Only links the modules are expected to produce: app deep links and web pages.
const OPENABLE = new Set(['claude:', 'cursor:', 'https:']);

ipcMain.on('island:interactive', (_e, interactive) => {
  if (!win || drag) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
});

// Text fields in the settings panel need keyboard focus; the island never takes it otherwise.
ipcMain.on('island:focusable', (_e, focusable) => {
  if (!win) return;
  win.setFocusable(!!focusable);
  if (focusable) win.focus();
});

ipcMain.on('island:drag', (_e, active) => (active ? startDrag() : endDrag()));
ipcMain.on('island:open', (_e, url) => openUrl(url));
ipcMain.on('island:menu', () => win && buildMenu().popup({ window: win }));
ipcMain.on('app:quit', () => app.quit());

ipcMain.on('island:command', (_e, { id, name, payload } = {}) => {
  const handler = commandHandlers.get(id);
  if (handler) handler(name, payload);
});

// ---------- app ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('Dynamic Island');
  app.whenReady().then(() => {
    watchConfig();
    createWindow();
    tray = new Tray(trayIcon());
    tray.setToolTip('Dynamic Island');
    tray.on('click', () => send('island:open-settings'));
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
    const stopFullscreen = watchFullscreen((value) => {
      fullscreen = value;
      updateVisibility();
    });
    app.on('before-quit', stopFullscreen);
    checkHooks();
  });
  app.on('before-quit', stopProviders);
  app.on('window-all-closed', () => app.quit());
}
