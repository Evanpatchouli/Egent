const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('egentUpdates', {
  install: (version) => ipcRenderer.invoke('egent:install-update', version),
  cancel: () => ipcRenderer.send('egent:cancel-update'),
  onProgress: (callback) => {
    const listener = (_event, percent) => callback(percent);
    ipcRenderer.on('egent:update-progress', listener);
    return () => ipcRenderer.removeListener('egent:update-progress', listener);
  },
});
