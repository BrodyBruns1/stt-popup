const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideWindow:    ()        => ipcRenderer.send('hide-window'),
  dragMove:      (dx, dy)  => ipcRenderer.send('drag-move', { dx, dy }),
  onInjectText:  (cb)      => ipcRenderer.on('inject-text', (_, text) => cb(text)),
  setSilence:    (ms)      => ipcRenderer.send('set-silence', ms),
  setIndicatorDraggable: (v) => ipcRenderer.send('set-indicator-draggable', v),
});
