const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  setInteractive: (value) => ipcRenderer.send('island:interactive', !!value),
  showMenu: () => ipcRenderer.send('island:menu'),
  open: (url) => ipcRenderer.send('island:open', String(url)),
  onData: (cb) => ipcRenderer.on('island:data', (_e, msg) => cb(msg)),
});
