# WaveDrop

WaveDrop is a Manifest V3 browser extension (Chrome / Atlas / any Chromium browser) that turns a YouTube watch page into a one-click **MP3 / MP4 downloader** — and automatically drops every MP3 into a dedicated **Apple Music playlist**.

```
Extension  →  local bridge (127.0.0.1:4123)  →  yt-dlp + ffmpeg  →  ~/Desktop/Youtube Songs/<Song>.mp3
                                                                   └→ osascript → Apple Music ▸ "Juice WRLD Unreleased"
```

The extension never rips YouTube itself — it hands the URL to a small local Node bridge that drives `yt-dlp`. That bridge also embeds tags + cover art and imports finished audio into Apple Music.

## Product Shape

- `content/` — the injected floating panel on YouTube watch pages.
- `popup/` — the compact control center (MP3 / MP4 buttons, live status, Music hand-off row).
- `background/` — task routing, persistence, provider orchestration, browser download hand-off.
- `shared/` — storage, constants, messages, icons, and the unified visual system (`theme.css`).
- `bridge/` — the local `yt-dlp` + Apple Music server (`server.js`) and the `add-to-music.applescript` helper.

## Download + Music pipeline

1. The UI starts a task through the bridge endpoint `http://127.0.0.1:4123/api/download`.
2. The bridge runs `yt-dlp` (+`ffmpeg`), saving **one** copy to `~/Desktop/Youtube Songs/` with embedded metadata
   and cover art. (No second copy into the browser Downloads folder.)
3. For **MP3** it then runs `osascript`, which ensures the playlist exists and adds the track (skipping duplicates).
4. Only once the Music step resolves does the task report `complete` — so the popup and panel both show the final
   "Added to Juice WRLD Unreleased ✓" state in one update, with a **"In Music anzeigen"** button that reveals the
   playlist in Apple Music.

The download always succeeds even if the Music step hiccups — a failure is surfaced in the status row, never fatal.

A **Settings toggle** in the popup ("In Apple Music übertragen", on by default) controls the hand-off per download:
turn it off and the file is only saved to the folder, not added to Music.

## The bridge (already installed as a launchd agent)

The bridge runs automatically at login via `~/Library/LaunchAgents/wavedrop-bridge.plist`
(label `com.abeba.wavedrop-bridge`). Logs live in `~/Library/Logs/wavedrop-bridge*.log`.

Manual control:

```bash
# restart after editing bridge/server.js
launchctl kickstart -k gui/$(id -u)/com.abeba.wavedrop-bridge
# health check
curl -s http://127.0.0.1:4123/api/health
```

Prerequisites (already present on this machine): `node`, `yt-dlp`, `ffmpeg` (Homebrew, `/opt/homebrew/bin`).

### Configuration (env vars in the plist / shell)

| Var | Default | Purpose |
|---|---|---|
| `DOWNLOAD_DIR` | `~/Desktop/Youtube Songs` | where files are saved |
| `MUSIC_IMPORT` | `1` | set `0` to disable the Apple Music hand-off |
| `MUSIC_PLAYLIST` | `Juice WRLD Unreleased` | target playlist (created if missing, case-insensitive match) |
| `MUSIC_IMPORT_FORMATS` | `mp3` | comma list of formats to import into Music |

### One-time Apple Music permission

The first time the bridge controls Music you may see a macOS prompt
**"…wants to control Music"** — click **Allow**. If an import ever reports
*"Allow Music automation…"*, enable it under
**System Settings → Privacy & Security → Automation → (bridge) → Music**.

## Load the extension (Atlas / Chrome)

1. Open `chrome://extensions/` (in Atlas: the extensions page).
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder (the one containing `manifest.json`).
5. Open a YouTube watch page → use the WaveDrop popup or the floating panel.

Reload the extension from that page after any code change.

## Key Files

- `manifest.json`
- `bridge/server.js`, `bridge/add-to-music.applescript`
- `background/worker.js`, `background/providers.js`
- `content/injector.js`, `content/panel.js`, `content/panel.css`
- `popup/popup.html`, `popup/popup.js`, `popup/popup.css`
- `shared/constants.js`, `shared/messages.js`, `shared/storage.js`, `shared/icons.js`, `shared/theme.css`
