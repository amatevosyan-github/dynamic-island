const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const providers = require('./main/providers');

// The window is a fixed transparent canvas big enough for the expanded island;
// everything outside the pill is click-through.
const WIN_W = 460;
const WIN_H = 260;
const TOP_OFFSET = 6;

let win;
let tray;
const stopFns = [];

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: Math.round(workArea.x + (workArea.width - WIN_W) / 2),
    y: workArea.y + TOP_OFFSET,
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

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());

  win.webContents.on('did-finish-load', startProviders);
}

function startProviders() {
  stopProviders();
  for (const provider of providers) {
    const emit = (data) => {
      if (win && !win.isDestroyed()) win.webContents.send('island:data', { id: provider.id, data });
    };
    const stop = provider.start(emit);
    if (typeof stop === 'function') stopFns.push(stop);
  }
}

function stopProviders() {
  while (stopFns.length) stopFns.pop()();
}

const menu = Menu.buildFromTemplate([
  { label: 'Reload', click: () => win && win.reload() },
  { type: 'separator' },
  { label: 'Quit', click: () => app.quit() },
]);

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

ipcMain.on('island:interactive', (_e, interactive) => {
  if (!win) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('island:menu', () => {
  if (win) menu.popup({ window: win });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    tray = new Tray(trayIcon());
    tray.setToolTip('Vistry Island');
    tray.setContextMenu(menu);
  });
  app.on('before-quit', stopProviders);
  app.on('window-all-closed', () => app.quit());
}
