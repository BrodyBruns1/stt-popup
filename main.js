const {
  app, BrowserWindow, globalShortcut, Tray, Menu,
  ipcMain, screen, nativeImage, clipboard, session, shell,
} = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── wscript VBS helper for fast paste (~40ms vs ~400ms for PowerShell) ────────
const VBS_PATH = path.join(os.tmpdir(), 'stt-popup-paste.vbs');
const VBS_ENTER_PATH = path.join(os.tmpdir(), 'stt-popup-paste-enter.vbs');
function ensurePasteHelpers() {
  try {
    fs.writeFileSync(VBS_PATH,
      'Set s=CreateObject("WScript.Shell"):WScript.Sleep 100:s.SendKeys "^v"\n',
      'utf8'
    );
    fs.writeFileSync(VBS_ENTER_PATH,
      'Set s=CreateObject("WScript.Shell"):WScript.Sleep 100:s.SendKeys "^v~"\n',
      'utf8'
    );
  } catch (_) {}
}

let indicatorWin = null;
let fullWin      = null;
let tray         = null;
let isRecording  = false;
let wakeModeEnabled = false;
let autoPressEnter = false;
let wakePhrase = 'Hey Jenkins';
let customDictionaryText = '';
const QUICK_PASTE_DELAY_MS = 650;
let pendingQuickPasteTimer = null;
let pendingQuickPasteText = '';
const FULL_WINDOW_SIZES = {
  transcript: { width: 560, height: 780 },
  lab: { width: 640, height: 920 },
  config: { width: 520, height: 820 },
};
const COMPACT_WINDOW_SIZE = { width: 360, height: 210 };
let fullWindowView = 'transcript';

function sanitizeWakePhrase(value) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || 'Hey Jenkins';
}

function sanitizeCustomDictionaryText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function sanitizeTonalityLabFilename(value) {
  return String(value || 'clip')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96) || 'clip';
}

function getFullWindowSize(view = fullWindowView) {
  return FULL_WINDOW_SIZES[view] || FULL_WINDOW_SIZES.transcript;
}

function getTonalityLabDir() {
  const documentsDir = app.getPath('documents');
  return path.join(documentsDir, 'STT Popup', 'Tonality Lab');
}

function ensureTonalityLabDir() {
  const labDir = getTonalityLabDir();
  fs.mkdirSync(labDir, { recursive: true });
  return labDir;
}

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
  const initialSize = getFullWindowSize('transcript');
  fullWin = new BrowserWindow({
    width:  initialSize.width,
    height: initialSize.height,
    show:        false,
    frame:       false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable:   false,
    movable:     true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  fullWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function setFullWindowMode(mode) {
  if (!fullWin) return;
  const size = mode === 'compact' ? COMPACT_WINDOW_SIZE : getFullWindowSize(fullWindowView);
  const [currentWidth, currentHeight] = fullWin.getSize();
  if (currentWidth !== size.width || currentHeight !== size.height) {
    fullWin.setSize(size.width, size.height, false);
  }
  fullWin.webContents.send('window-mode-state', { mode, view: fullWindowView });
}

function setFullWindowView(view, { reposition = true } = {}) {
  if (!view || !FULL_WINDOW_SIZES[view]) return;
  fullWindowView = view;
  if (!fullWin) return;
  if (fullWin.isVisible()) {
    setFullWindowMode('full');
    if (reposition) positionFullWindowRelativeToIndicator();
  }
  fullWin.webContents.send('window-view-state', { view: fullWindowView });
}

function pickAttachedPosition({ indicatorX, indicatorY, indicatorWidth, indicatorHeight, fullWidth, fullHeight, areaX, areaY, areaWidth, areaHeight }) {
  const gap = 10;
  const candidates = [
    { mode: 'below', x: indicatorX + indicatorWidth - fullWidth, y: indicatorY + indicatorHeight + gap },
    { mode: 'above', x: indicatorX + indicatorWidth - fullWidth, y: indicatorY - fullHeight - gap },
    { mode: 'left', x: indicatorX - fullWidth - gap, y: indicatorY + Math.round((indicatorHeight - fullHeight) / 2) },
    { mode: 'right', x: indicatorX + indicatorWidth + gap, y: indicatorY + Math.round((indicatorHeight - fullHeight) / 2) },
  ];

  const minX = areaX + 12;
  const minY = areaY + 12;
  const maxX = areaX + areaWidth - fullWidth - 12;
  const maxY = areaY + areaHeight - fullHeight - 12;

  const scored = candidates.map(candidate => {
    const clampedX = Math.max(minX, Math.min(candidate.x, maxX));
    const clampedY = Math.max(minY, Math.min(candidate.y, maxY));
    const overflow = Math.abs(candidate.x - clampedX) + Math.abs(candidate.y - clampedY);
    return {
      ...candidate,
      x: clampedX,
      y: clampedY,
      overflow,
    };
  });

  scored.sort((a, b) => a.overflow - b.overflow);
  return scored[0];
}

function positionFullWindowRelativeToIndicator() {
  if (!indicatorWin || !fullWin) return;

  const [indicatorX, indicatorY] = indicatorWin.getPosition();
  const [indicatorWidth, indicatorHeight] = indicatorWin.getSize();
  const [fullWidth, fullHeight] = fullWin.getSize();
  const display = screen.getDisplayNearestPoint({ x: indicatorX, y: indicatorY });
  const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = display.workArea;

  const placement = pickAttachedPosition({
    indicatorX,
    indicatorY,
    indicatorWidth,
    indicatorHeight,
    fullWidth,
    fullHeight,
    areaX,
    areaY,
    areaWidth,
    areaHeight,
  });

  fullWin.setPosition(Math.round(placement.x), Math.round(placement.y), false);
}

function showFullWindowAttached({ focus = false, mode = 'full' } = {}) {
  if (!fullWin) return;
  setFullWindowMode(mode);
  positionFullWindowRelativeToIndicator();

  if (fullWin.isVisible()) {
    if (focus) fullWin.focus();
  } else if (focus) {
    fullWin.show();
    fullWin.focus();
  } else {
    fullWin.showInactive();
  }

  if (indicatorWin) indicatorWin.webContents.send('set-draggable', fullWin.isVisible());
}

function hideFullWindow() {
  if (!fullWin) return;
  fullWin.hide();
  if (indicatorWin) indicatorWin.webContents.send('set-draggable', false);
}

function sendQuickSessionState(stage) {
  if (!fullWin) return;
  fullWin.webContents.send('quick-session-state', { stage });
}

function clearPendingQuickPaste() {
  if (pendingQuickPasteTimer) {
    clearTimeout(pendingQuickPasteTimer);
    pendingQuickPasteTimer = null;
  }
  pendingQuickPasteText = '';
}

function normalizeTranscriptPayload(payload) {
  if (payload && typeof payload === 'object') {
    const rawText = String(payload.raw_text || payload.rawText || payload.text || '').trim();
    const expressiveText = String(payload.expressive_text || payload.expressiveText || payload.text || '').trim();
    return {
      ...payload,
      text: expressiveText || rawText,
      raw_text: rawText || expressiveText,
      expressive_text: expressiveText || rawText,
    };
  }

  const text = String(payload || '').trim();
  return {
    text,
    raw_text: text,
    expressive_text: text,
  };
}

function finishQuickPreview({ pasteNow = false } = {}) {
  const text = pendingQuickPasteText;
  clearPendingQuickPaste();
  if (pasteNow && text) {
    injectTextAtCursor(text);
  }
  sendQuickSessionState(pasteNow ? 'pasted' : 'idle');
  hideFullWindow();
}

// ── Text injection (wscript VBS — ~40ms vs ~400ms for PowerShell) ────────────
function injectTextAtCursor(text) {
  const prev = clipboard.readText();
  clipboard.writeText(text);
  ensurePasteHelpers();
  const scriptPath = autoPressEnter ? VBS_ENTER_PATH : VBS_PATH;
  // wscript sends Ctrl+V to whatever window currently has focus (we never stole it)
  exec(`wscript //nologo "${scriptPath}"`, () => {
    setTimeout(() => clipboard.writeText(prev), 800);
  });
}

// ── App bootstrap ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensurePasteHelpers(); // write VBS helpers to temp dir on startup

  // Auto-grant microphone permission so the non-focusable indicator can record
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => {
    cb(perm === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((wc, perm) => {
    return perm === 'media';
  });

  createIndicatorWindow();
  createFullWindow();
  positionFullWindowRelativeToIndicator();

  // ── Ctrl+Space: toggle recording, zero focus disruption ──────────────────
  const ok1 = globalShortcut.register('Control+Space', () => {
    if (!isRecording) {
      isRecording = true;
      showFullWindowAttached({ focus: false, mode: 'compact' });
      sendQuickSessionState('recording');
      indicatorWin.webContents.send('cmd-start');
    } else {
      isRecording = false;
      sendQuickSessionState('finalizing');
      indicatorWin.webContents.send('cmd-stop');
    }
  });
  if (!ok1) console.warn('Could not register Ctrl+Space');

  // ── Ctrl+Shift+Space: show/hide full window with AI enhancement ───────────
  const ok2 = globalShortcut.register('Control+Shift+Space', () => {
    if (fullWin.isVisible()) {
      hideFullWindow();
    } else {
      showFullWindowAttached({ focus: true, mode: 'full' });
    }
  });
  if (!ok2) console.warn('Could not register Ctrl+Shift+Space');

  // ── System tray ───────────────────────────────────────────────────────────
  const icon = makeTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('STT  |  Ctrl+Space = record & inject  |  Ctrl+Shift+Space = full window');
  tray.on('click', () => {
    if (fullWin.isVisible()) hideFullWindow();
    else showFullWindowAttached({ focus: true, mode: 'full' });
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ctrl+Space          — Record & inject',   enabled: false },
    { label: 'Ctrl+Shift+Space  — Full window + AI',    enabled: false },
    { type: 'separator' },
    { label: 'Show full window',  click: () => showFullWindowAttached({ focus: true, mode: 'full' }) },
    { label: 'Quit',              click: () => app.quit() },
  ]));
});

// ── IPC from indicator: transcription finished ────────────────────────────────
ipcMain.on('transcription-ready', (_, payload) => {
  isRecording = false;
  clearPendingQuickPaste();
  showFullWindowAttached({ focus: false, mode: 'compact' });
  sendQuickSessionState('preview');
  const transcript = normalizeTranscriptPayload(payload);
  if (fullWin) fullWin.webContents.send('inject-text', transcript);
  pendingQuickPasteText = transcript.text;
  pendingQuickPasteTimer = setTimeout(() => finishQuickPreview({ pasteNow: true }), QUICK_PASTE_DELAY_MS);
});

ipcMain.on('transcription-live', (_, payload) => {
  const transcript = normalizeTranscriptPayload(payload);
  if (payload && payload.partial) {
    showFullWindowAttached({ focus: false, mode: 'compact' });
    sendQuickSessionState('recording');
  }
  if (fullWin) fullWin.webContents.send('live-text', transcript);
});

ipcMain.on('wake-activated', () => {
  showFullWindowAttached({ focus: false, mode: 'compact' });
  sendQuickSessionState('recording');
});

ipcMain.on('transcription-error', () => {
  isRecording = false;
  clearPendingQuickPaste();
  sendQuickSessionState('error');
});

ipcMain.on('recording-stopped', () => {
  isRecording = false;
  clearPendingQuickPaste();
  sendQuickSessionState('idle');
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
  if (fullWin && fullWin.isVisible()) {
    const [fullX, fullY] = fullWin.getPosition();
    fullWin.setPosition(fullX + dx, fullY + dy);
  }
});

// ── IPC: full window tells indicator whether it's draggable ──────────────────
ipcMain.on('set-indicator-draggable', (_, v) => {
  if (indicatorWin) indicatorWin.webContents.send('set-draggable', v);
});

ipcMain.on('set-wake-mode', (_, enabled) => {
  wakeModeEnabled = !!enabled;
  if (indicatorWin) indicatorWin.webContents.send('set-wake-mode', wakeModeEnabled);
  if (fullWin) fullWin.webContents.send('wake-mode-state', { enabled: wakeModeEnabled });
});

ipcMain.on('set-wake-phrase', (_, phrase) => {
  wakePhrase = sanitizeWakePhrase(phrase);
  if (indicatorWin) indicatorWin.webContents.send('set-wake-phrase', wakePhrase);
  if (fullWin) fullWin.webContents.send('wake-phrase-state', { phrase: wakePhrase });
});

ipcMain.on('set-custom-dictionary', (_, text) => {
  customDictionaryText = sanitizeCustomDictionaryText(text);
  if (indicatorWin) indicatorWin.webContents.send('set-custom-dictionary', customDictionaryText);
  if (fullWin) fullWin.webContents.send('custom-dictionary-state', { text: customDictionaryText });
});

ipcMain.on('set-auto-enter', (_, enabled) => {
  autoPressEnter = !!enabled;
  if (fullWin) fullWin.webContents.send('auto-enter-state', { enabled: autoPressEnter });
});

ipcMain.on('set-full-window-view', (_, view) => {
  setFullWindowView(view);
});

ipcMain.handle('save-tonality-clip', async (_, payload) => {
  const bytes = payload && payload.bytes;
  const fileName = sanitizeTonalityLabFilename(payload && payload.file_name) + '.wav';
  if (!bytes) {
    throw new Error('Missing clip bytes');
  }

  const clipBuffer = Buffer.from(bytes);
  const labDir = ensureTonalityLabDir();
  const filePath = path.join(labDir, fileName);
  fs.writeFileSync(filePath, clipBuffer);
  return { path: filePath, file_name: fileName, folder: labDir };
});

ipcMain.handle('open-tonality-lab-folder', async () => {
  const labDir = ensureTonalityLabDir();
  const error = await shell.openPath(labDir);
  if (error) {
    throw new Error(error);
  }
  return { path: labDir };
});

// ── IPC from full window ──────────────────────────────────────────────────────
ipcMain.on('hide-window', () => hideFullWindow());
ipcMain.on('dismiss-preview', () => finishQuickPreview({ pasteNow: !!pendingQuickPasteText }));
ipcMain.on('quit-app', () => app.quit());

ipcMain.on('drag-move', (_, { dx, dy }) => {
  if (!fullWin) return;
  const [x, y] = fullWin.getPosition();
  fullWin.setPosition(x + dx, y + dy);
});

app.on('window-all-closed', e => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());
