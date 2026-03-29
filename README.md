# WaveDrop

WaveDrop is a Manifest V3 Chrome Extension for YouTube pages. It acts as a companion layer for collecting video context, copying links, handing videos off to an external workflow, sharing, and saving references into a local library.

This project does not download or bypass YouTube protections. All actions stay within standard browser and extension capabilities.

## Features

- automatic detection of YouTube watch pages
- floating glassmorphism overlay with current video details
- copy link, open external handoff tab, save to library, and share actions
- local library stored in `chrome.storage.local`
- popup view for the current video plus saved items

## Files

- `manifest.json` - Manifest V3 setup
- `content.js` - YouTube page detection and injected overlay
- `background.js` - storage orchestration and external handoff action
- `popup.html` - popup shell
- `popup.js` - popup rendering and library interactions
- `styles.css` - shared visual system for popup and overlay

## Load Unpacked

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.

## Notes

- The overlay is only visible on standard YouTube video URLs such as `https://www.youtube.com/watch?v=...`.
- Saved items stay local to the browser profile through `chrome.storage.local`.
- The external tool action opens a neutral browser handoff tab seeded with the current video metadata.
