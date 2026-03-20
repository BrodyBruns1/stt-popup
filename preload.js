const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideWindow:    ()        => ipcRenderer.send('hide-window'),
  dismissPreview: ()      => ipcRenderer.send('dismiss-preview'),
  quitApp:       ()        => ipcRenderer.send('quit-app'),
  dragMove:      (dx, dy)  => ipcRenderer.send('drag-move', { dx, dy }),
  onInjectText:  (cb)      => ipcRenderer.on('inject-text', (_, text) => cb(text)),
  onLiveText:    (cb)      => ipcRenderer.on('live-text', (_, payload) => cb(payload)),
  onQuickSessionState: (cb) => ipcRenderer.on('quick-session-state', (_, payload) => cb(payload)),
  onWakeModeState: (cb)    => ipcRenderer.on('wake-mode-state', (_, payload) => cb(payload)),
  onWakePhraseState: (cb)  => ipcRenderer.on('wake-phrase-state', (_, payload) => cb(payload)),
  onCustomDictionaryState: (cb) => ipcRenderer.on('custom-dictionary-state', (_, payload) => cb(payload)),
  onAutoEnterState: (cb)   => ipcRenderer.on('auto-enter-state', (_, payload) => cb(payload)),
  setSilence:    (ms)      => ipcRenderer.send('set-silence', ms),
  setWakeMode:   (enabled) => ipcRenderer.send('set-wake-mode', enabled),
  setWakePhrase: (phrase)  => ipcRenderer.send('set-wake-phrase', phrase),
  setCustomDictionary: (text) => ipcRenderer.send('set-custom-dictionary', text),
  setAutoEnter:  (enabled) => ipcRenderer.send('set-auto-enter', enabled),
  setIndicatorDraggable: (v) => ipcRenderer.send('set-indicator-draggable', v),
});
