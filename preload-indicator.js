const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('indicatorAPI', {
  onStart:           (cb) => ipcRenderer.on('cmd-start',       cb),
  onStop:            (cb) => ipcRenderer.on('cmd-stop',        cb),
  onSetSilence:      (cb) => ipcRenderer.on('set-silence',     (_, ms) => cb(ms)),
  onSetDraggable:    (cb) => ipcRenderer.on('set-draggable',   (_, v)  => cb(v)),
  onSetWakeMode:     (cb) => ipcRenderer.on('set-wake-mode',   (_, v)  => cb(v)),
  onSetWakePhrase:   (cb) => ipcRenderer.on('set-wake-phrase', (_, v)  => cb(v)),
  transcriptionReady: (text) => ipcRenderer.send('transcription-ready', text),
  transcriptionLive:  (payload) => ipcRenderer.send('transcription-live', payload),
  transcriptionError: ()     => ipcRenderer.send('transcription-error'),
  recordingStopped:   ()     => ipcRenderer.send('recording-stopped'),
  wakeActivated:      ()     => ipcRenderer.send('wake-activated'),
  dragIndicator:     (dx, dy) => ipcRenderer.send('drag-indicator', { dx, dy }),
});
