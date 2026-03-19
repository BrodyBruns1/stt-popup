# STT Popup

Floating speech-to-text desktop widget for Windows/Linux. Records from your microphone, transcribes via Whisper on a local server, and injects the text directly at your cursor — no browser tab, no focus disruption.

## Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+Space** | Start/stop recording. Text injected at cursor when done. |
| **Ctrl+Shift+Space** | Show/hide full window (AI enhancement via Ollama) |

## Usage

### Windows (pre-built)

Download `STT-Popup-Windows.zip` from Releases, extract anywhere, run `STT Popup.exe`.

### From source

Requires Node.js v20 LTS (v23+ is not compatible with electron-builder dependencies).

```bash
npm install
npm start
```

### Backend

Requires the [stt-widget](https://github.com/BrodyBruns1/stt-widget) backend running and accessible. Update the `API` constant in `renderer/index.html` and `renderer/indicator.html` to match your server address.

## How it works

- A small non-focusable pill indicator sits in the top-right corner of your screen
- **Ctrl+Space** triggers recording without stealing focus from your current window
- Silence detection (configurable 1.8s–30s or manual) auto-stops recording
- Audio is sent to the Whisper backend for transcription
- Result is injected via clipboard paste using `wscript.exe` (~40ms overhead)
- **Ctrl+Shift+Space** opens the full window with Ollama AI enhancement

## Silence timeout slider

The full window (Ctrl+Shift+Space) has a silence slider:
- **Left** (1.8s) — stops after brief pause, best for short commands
- **Right** (30s) — long pause tolerance for dictation
- **Far right (∞)** — manual mode, press Ctrl+Space again to stop

## Files

```
main.js                  Main process — global shortcuts, windows, text injection
preload.js               IPC bridge for full window
preload-indicator.js     IPC bridge for indicator window
renderer/index.html      Full popup (420×560px) with AI enhancement
renderer/indicator.html  Floating pill indicator (164×44px)
```
