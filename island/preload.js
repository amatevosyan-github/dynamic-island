const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  setInteractive: (value) => ipcRenderer.send('island:interactive', !!value),
  showMenu: () => ipcRenderer.send('island:menu'),
  open: (url) => ipcRenderer.send('island:open', String(url)),
  // Module -> its main-process provider (e.g. the agents row menu).
  command: (id, name, payload) => ipcRenderer.send('island:command', { id, name, payload }),
  onData: (cb) => ipcRenderer.on('island:data', (_e, msg) => cb(msg)),
});
