const {
  app, BrowserWindow, globalShortcut, Tray, Menu,
  ipcMain, screen, nativeImage, clipboard, session,
} = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── wscript VBS helper for fast paste (~40ms vs ~400ms for PowerShell) ────────
const VBS_PATH = path.join(os.tmpdir(), 'stt-popup-paste.vbs');
function ensurePasteHelper() {
  try {
    fs.writeFileSync(VBS_PATH,
      'Set s=CreateObject("WScript.Shell"):WScript.Sleep 100:s.SendKeys "^v"\n',
      'utf8'
    );
  } catch (_) {}
}

let indicatorWin = null;
let fullWin      = null;
let tray         = null;
let isRecording  = false;

// ── Tray icon ────────────────────────────────────────────────────────────────
function makeTrayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
    <rect width="22" height="22" rx="4" fill="#7c3aed"/>
    <path d="M11 3a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" fill="white"/>
    <path d="M6 10v1a5 5 0 0 0 10 0v-1" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <line x1="11" y1="16" x2="11" y2="19" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="8" y1="19" x2="14" y2="19" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

// ── Indicator window (small pill, never steals focus) ────────────────────────
function createIndicatorWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  indicatorWin = new BrowserWindow({
    width:  164,
    height: 44,
    x: workArea.x + workArea.width - 176,
    y: workArea.y + 16,
    frame:       false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable:   false,   // ← NEVER takes focus from the user's app
    resizable:   false,
    movable:     false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload-indicator.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  indicatorWin.loadFile(path.join(__dirname, 'renderer', 'indicator.html'));
  // Highest always-on-top level so it shows over most windows
  indicatorWin.setAlwaysOnTop(true, 'pop-up-menu');
}

// ── Full window (shown only via Ctrl+Shift+Space) ────────────────────────────
function createFullWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  fullWin = new BrowserWindow({
    width:  420,
    height: 560,
    x: workArea.x + workArea.width  - 432,
    y: workArea.y + workArea.height - 572,
    frame:       false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable:   false,
    movable:     true,
    show:        false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  fullWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ── Text injection (wscript VBS — ~40ms vs ~400ms for PowerShell) ────────────
function injectTextAtCursor(text) {
  const prev = clipboard.readText();
  clipboard.writeText(text);
  ensurePasteHelper();
  // wscript sends Ctrl+V to whatever window currently has focus (we never stole it)
  exec(`wscript //nologo "${VBS_PATH}"`, () => {
    setTimeout(() => clipboard.writeText(prev), 800);
  });
}

// ── App bootstrap ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensurePasteHelper(); // write VBS helper to temp dir on startup

  // Auto-grant microphone permission so the non-focusable indicator can record
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => {
    cb(perm === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((wc, perm) => {
    return perm === 'media';
  });

  createIndicatorWindow();
  createFullWindow();

  // ── Ctrl+Space: toggle recording, zero focus disruption ──────────────────
  const ok1 = globalShortcut.register('Control+Space', () => {
    if (!isRecording) {
      isRecording = true;
      indicatorWin.webContents.send('cmd-start');
    } else {
      isRecording = false;
      indicatorWin.webContents.send('cmd-stop');
    }
  });
  if (!ok1) console.warn('Could not register Ctrl+Space');

  // ── Ctrl+Shift+Space: show/hide full window with AI enhancement ───────────
  const ok2 = globalShortcut.register('Control+Shift+Space', () => {
    if (fullWin.isVisible()) {
      fullWin.hide();
      indicatorWin.webContents.send('set-draggable', false);
    } else {
      fullWin.show();
      fullWin.focus();
      indicatorWin.webContents.send('set-draggable', true);
    }
  });
  if (!ok2) console.warn('Could not register Ctrl+Shift+Space');

  // ── System tray ───────────────────────────────────────────────────────────
  const icon = makeTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('STT  |  Ctrl+Space = record & inject  |  Ctrl+Shift+Space = full window');
  tray.on('click', () => {
    if (fullWin.isVisible()) fullWin.hide();
    else { fullWin.show(); fullWin.focus(); }
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ctrl+Space          — Record & inject',   enabled: false },
    { label: 'Ctrl+Shift+Space  — Full window + AI',    enabled: false },
    { type: 'separator' },
    { label: 'Show full window',  click: () => { fullWin.show(); fullWin.focus(); } },
    { label: 'Quit',              click: () => app.quit() },
  ]));
});

// ── IPC from indicator: transcription finished ────────────────────────────────
ipcMain.on('transcription-ready', (_, text) => {
  isRecording = false;
  injectTextAtCursor(text);
  // Also send to full window so user can see it if they open it later
  if (fullWin) fullWin.webContents.send('inject-text', text);
});

ipcMain.on('transcription-error', () => {
  isRecording = false;
});

ipcMain.on('recording-stopped', () => {
  isRecording = false;
});

// ── IPC: silence setting from full window → forwarded to indicator ────────────
ipcMain.on('set-silence', (_, ms) => {
  if (indicatorWin) indicatorWin.webContents.send('set-silence', ms);
});

// ── IPC: drag the indicator window (sent from indicator renderer) ─────────────
ipcMain.on('drag-indicator', (_, { dx, dy }) => {
  if (!indicatorWin) return;
  const [x, y] = indicatorWin.getPosition();
  indicatorWin.setPosition(x + dx, y + dy);
});

// ── IPC: full window tells indicator whether it's draggable ──────────────────
ipcMain.on('set-indicator-draggable', (_, v) => {
  if (indicatorWin) indicatorWin.webContents.send('set-draggable', v);
});

// ── IPC from full window ──────────────────────────────────────────────────────
ipcMain.on('hide-window', () => { if (fullWin) fullWin.hide(); });

ipcMain.on('drag-move', (_, { dx, dy }) => {
  if (!fullWin) return;
  const [x, y] = fullWin.getPosition();
  fullWin.setPosition(x + dx, y + dy);
});

app.on('window-all-closed', e => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());
