const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('island', {
  setInteractive: (value) => ipcRenderer.send('island:interactive', !!value),
  setFocusable: (value) => ipcRenderer.send('island:focusable', !!value),
  drag: (active) => ipcRenderer.send('island:drag', !!active),
  showMenu: () => ipcRenderer.send('island:menu'),
  open: (url) => ipcRenderer.send('island:open', String(url)),
  quit: () => ipcRenderer.send('app:quit'),
  // Module -> its main-process provider (e.g. the agents row menu).
  command: (id, name, payload) => ipcRenderer.send('island:command', { id, name, payload }),

  onData: on('island:data'),
  onDock: on('island:dock'), // { edge, dragging? }
  onBlur: on('island:blur'),
  onOpenSettings: on('island:open-settings'),

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    saveGitlab: (accounts) => ipcRenderer.invoke('settings:gitlab', accounts),
    setHooks: (install) => ipcRenderer.invoke('settings:hooks', !!install),
  },
});
