# STT Popup

Floating speech-to-text desktop widget for Windows. It records from the microphone, streams PCM audio to the `stt-widget` backend over WebSocket, shows live transcription before paste, and injects the final text at the cursor without stealing focus.

Current tagged release: `v1.4.4`

## Features

- Non-focus-stealing pill indicator for quick dictation
- Attached full transcript panel for live preview and final review
- Compact quick-preview panel that docks itself around the pill
- Live partial transcription while you are still speaking
- Final full-pass cleanup when recording stops
- Configurable wake phrase with always-listening wake mode
- Custom correction dictionary for recurring STT mistakes
- Optional `Press Enter After Paste`
- Configurable silence timeout or fully manual stop mode
- Ollama-powered text enhancement in the full window
- Fast paste via `wscript.exe`
- Guided Tonality Lab for mic-gain and prosody calibration
- Automatic WAV clip capture for Tonality Lab takes
- Full window split into `Transcript`, `Tonality Lab`, and `Config` sections

## Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Space` | Start/stop quick recording |
| `Ctrl+Shift+Space` | Show or hide the full transcript window |

## Quick Start

### Windows

Download `STT-Popup-Windows.zip`, extract it, and run `STT Popup.exe`.

### From source

Requires Node.js 20 LTS.

```bash
npm install
npm start
```

## Backend

Requires the [stt-widget](https://github.com/BrodyBruns1/stt-widget) backend running and reachable.

The popup uses:
- `ws://<host>:8200/ws/transcribe` for live PCM streaming transcription
- `http://<host>:8200/enhance` for Ollama cleanup
- `http://<host>:8200/models` for model listing

If your server address changes, update the API constants in `renderer/index.html` and `renderer/indicator.html`.

## Wake Mode

Wake mode can be enabled from Settings.

- The wake phrase is editable and no longer hardcoded to `Hey Jenkins`
- Matching is intentionally tolerant of pauses, extra words, and small recognition drift
- After wake detection, the popup transitions into the normal quick-record flow
- The preview window appears with live text before paste

## Custom Dictionary

The settings panel includes a custom dictionary textarea for recurring recognition mistakes.

Supported formats:

```text
{clod} claude
{innate in} n8n
anthropic | clawed => Claude
```

Notes:

- One rule per line
- Use `{heard phrase} replacement` for a quick single-phrase rule
- Use `a | b => replacement` for multiple heard variants
- Rules are sent with both wake-mode and dictation streams, so they affect live partials and final transcripts

## Recording Behavior

- Quick-record opens the attached preview panel automatically
- The quick preview uses a minimal transcript panel instead of the full settings window
- The compact panel docks above, below, left, or right of the pill based on available screen space
- Live partials appear while recording
- On stop, the popup keeps a short tail grace before finalization to reduce clipped endings
- Final text appears in the preview before paste
- Paste can optionally be followed by `Enter`

## Tonality Lab

- Enable `Tonality Lab Capture` from `Config`
- Use the `Tonality Lab` section to step through the guided prompt deck
- Each saved take includes the transcript, tone metrics, and a WAV clip written to your local Tonality Lab folder
- Use `Open Clips Folder` to inspect the raw audio clips that go with the captured metrics

## Silence Timeout

The full window includes a silence slider:

- Left: about `1.8s`, best for short commands
- Right: up to `30s`, better for longer dictation
- Far right: `∞`, manual stop only

## Packaging Notes

Canonical source and build orchestration now live on VM 105 at `/opt/stt-popup-repo`.

The canonical build flow on the VM is:

```bash
npm run build:artifacts
```

That script:

- builds the Linux AppImage
- builds the Windows unpacked app
- zips `dist/win-unpacked` into `dist/STT-Popup-Windows.zip`
- stages the finished artifacts into `/opt/stt-popup-dist`
- uses local `npm` when available, or the repo's Docker builder when the VM host itself does not have Node installed

If a macOS artifact is ever present in `dist/`, the same script will normalize it into `/opt/stt-popup-dist/STT-Popup-macOS.*`. The Linux VM does not fabricate macOS binaries on its own; those still require a macOS builder.

## Files

```text
main.js                  Main process: shortcuts, preview state, paste flow, wake settings
preload.js               IPC bridge for the full transcript window
preload-indicator.js     IPC bridge for the floating indicator
renderer/index.html      Full transcript window and settings UI
renderer/indicator.html  Floating pill, live PCM capture, wake mode, streaming logic
```
