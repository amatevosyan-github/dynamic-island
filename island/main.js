const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, shell, Notification, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const config = require('./main/config');
const hooks = require('./main/hooks');
const providers = require('./main/providers');
const { watchFullscreen } = require('./main/fullscreen');

// The window is a fixed transparent canvas big enough for the expanded island;
// everything outside the pill is click-through.
const WIN_W = 460;
const WIN_H = 320;
const TOP_OFFSET = 6;

const BUNDLED_HOOK = path.join(__dirname, 'hooks', 'agent-status.js');
// Packaged builds can't point hooks into the app archive, so the script is copied here.
const INSTALLED_HOOK = path.join(config.DIR, 'hooks', 'agent-status.js');

let win;
let tray;
let settings = config.load().config;
let fullscreen = false;
const stopFns = [];
const commandHandlers = new Map(); // provider id -> command(name, payload)
const liveNotifications = new Set(); // keeps click handlers alive until dismissed

// ---------- window ----------

function place() {
  if (!win || win.isDestroyed()) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - WIN_W) / 2),
    y: workArea.y + TOP_OFFSET,
    width: WIN_W,
    height: WIN_H,
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
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
    focusable: false,
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
  win.webContents.on('did-finish-load', startProviders);

  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, place);
}

function updateVisibility() {
  if (!win || win.isDestroyed()) return;
  if (fullscreen && settings.hideInFullscreen) win.hide();
  else if (!win.isVisible()) win.showInactive();
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
  const ctx = {
    config: settings,
    notify,
    open: openUrl,
    popupMenu: (template) => win && Menu.buildFromTemplate(template).popup({ window: win }),
  };
  for (const provider of providers) {
    const emit = (data) => {
      if (win && !win.isDestroyed()) win.webContents.send('island:data', { id: provider.id, data });
    };
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

// Config edits (by hand or from the tray) restart the providers with the new values.
function watchConfig() {
  config.ensure();
  let debounce;
  // Watch the folder: editors that save by replacing the file would end a file watch.
  fs.watch(config.DIR, (_event, name) => {
    if (name && name !== path.basename(config.FILE)) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const { config: next, error } = config.load();
      if (error) return; // keep running on the last good settings
      settings = next;
      updateVisibility();
      startProviders();
    }, 200);
  });
}

// ---------- tray & settings ----------

// Autostart registers this exact executable (+ app path in dev), so read it back the same way.
const loginItem = () => ({ path: process.execPath, args: app.isPackaged ? [] : [path.resolve(__dirname)] });

function toggleSetting(key) {
  const error = config.update((c) => {
    c[key] = !c[key];
  });
  if (error) dialog.showErrorBox('Vistry Island', `Settings file is not valid JSON, fix it first.\n\n${error}`);
}

function hookScript() {
  if (!app.isPackaged) return BUNDLED_HOOK;
  fs.mkdirSync(path.dirname(INSTALLED_HOOK), { recursive: true });
  fs.copyFileSync(BUNDLED_HOOK, INSTALLED_HOOK);
  return INSTALLED_HOOK;
}

function setHooks(install) {
  try {
    const files = install ? hooks.install(hookScript()) : hooks.uninstall();
    const verb = install ? 'Installed agent hooks in' : 'Removed agent hooks from';
    dialog.showMessageBox({
      type: 'info',
      title: 'Vistry Island',
      message: `${verb}:\n${files.join('\n')}`,
      detail: install ? 'The hooks need Node.js on PATH. Restart Cursor so it loads them.' : '',
    });
  } catch (e) {
    dialog.showErrorBox('Vistry Island', e.message);
  }
}

function buildMenu() {
  const hooksInstalled = !!hooks.installedScript();
  return Menu.buildFromTemplate([
    {
      label: 'Launch at startup',
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItem()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItem(), openAtLogin: item.checked }),
    },
    { label: 'Notifications', type: 'checkbox', checked: settings.notifications, click: () => toggleSetting('notifications') },
    {
      label: 'Hide in full screen',
      type: 'checkbox',
      checked: settings.hideInFullscreen,
      click: () => toggleSetting('hideInFullscreen'),
    },
    { type: 'separator' },
    hooksInstalled
      ? { label: 'Remove agent hooks', click: () => setHooks(false) }
      : { label: 'Install agent hooks…', click: () => setHooks(true) },
    { label: 'Open settings file', click: () => shell.openPath(config.FILE) },
    { label: 'Reload', click: () => win && win.reload() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
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
    title: 'Vistry Island',
    message: 'Show your Claude Code and Cursor chats on the island?',
    detail:
      'This adds status hooks to ~/.claude/settings.json and ~/.cursor/hooks.json (your other settings are kept, a .bak copy is made). ' +
      'You can remove them later from the tray menu.',
  });
  if (response === 0) setHooks(true);
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
  if (!win) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('island:open', (_e, url) => openUrl(url));

ipcMain.on('island:menu', () => {
  if (win) buildMenu().popup({ window: win });
});

ipcMain.on('island:command', (_e, { id, name, payload } = {}) => {
  const handler = commandHandlers.get(id);
  if (handler) handler(name, payload);
});

// ---------- app ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('Vistry Island');
  app.whenReady().then(() => {
    watchConfig();
    createWindow();
    tray = new Tray(trayIcon());
    tray.setToolTip('Vistry Island');
    tray.on('click', () => tray.popUpContextMenu(buildMenu()));
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
