'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('souffle', {
  onState: (cb) => ipcRenderer.on('overlay:state', (_e, data) => cb(data)),
  onLevel: (cb) => ipcRenderer.on('overlay:level', (_e, level) => cb(level)),
  stop: () => ipcRenderer.send('overlay:stop'),
  cancel: () => ipcRenderer.send('overlay:cancel')
});
