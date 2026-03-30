# WaveDrop

WaveDrop is a Manifest V3 Chrome Extension built around a floating YouTube mini-window and a matching popup control center.

## Product Shape

- `content/` drives the injected floating panel on YouTube watch pages.
- `popup/` contains the compact control center UI.
- `background/` owns task routing, persistence, provider orchestration, and browser download handoff.
- `shared/` contains storage, constants, messages, and the unified visual system.
- `assets/` holds reusable decorative symbols like the carton emblem.

## Download Architecture

WaveDrop uses a provider-based task flow for MP3 and MP4 actions.

- The UI starts a task through the background worker.
- The background worker persists task state in `chrome.storage.local`.
- A local bridge endpoint can be configured in the popup.
- If the bridge returns a final file URL, WaveDrop hands it to `chrome.downloads`.
- External tool handoff remains available as a separate action.

The extension does not embed a direct YouTube-ripping implementation in the UI layer itself.

## Load Unpacked

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repository folder.
5. Reload the extension after code changes.

## Key Files

- `manifest.json`
- `background/worker.js`
- `background/providers.js`
- `content/injector.js`
- `content/panel.js`
- `content/panel.css`
- `popup/popup.html`
- `popup/popup.js`
- `popup/popup.css`
- `shared/constants.js`
- `shared/messages.js`
- `shared/storage.js`
- `shared/theme.css`
