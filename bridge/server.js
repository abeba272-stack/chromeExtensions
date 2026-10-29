'use strict';

/**
 * WaveDrop Bridge Server
 * ---------------------
 * A thin Express wrapper around yt-dlp that the Chrome extension talks to,
 * with automatic hand-off into Apple Music.
 *
 * Pipeline:
 *   extension → POST /api/download → yt-dlp (+ffmpeg) → ~/Desktop/Youtube Songs
 *             → (for audio) osascript → Apple Music playlist "Juice WRLD Unreleased"
 *
 * Prerequisites:
 *   npm install            (inside this bridge/ directory)
 *   yt-dlp + ffmpeg installed (Homebrew: /opt/homebrew/bin)
 *
 * Start:
 *   node bridge/server.js       (or via the launchd agent com.abeba.wavedrop-bridge)
 *
 * Configurable via env vars:
 *   PORT, HOST, DOWNLOAD_DIR
 *   MUSIC_IMPORT          "0" to disable the Apple Music hand-off (default on)
 *   MUSIC_PLAYLIST        target playlist name (default "Juice WRLD Unreleased")
 *   MUSIC_IMPORT_FORMATS  comma list of formats to import (default "mp3")
 *   YTDLP_PATH            override yt-dlp binary location
 */

const express = require('express');
const { spawn } = require('child_process');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const os      = require('os');

/* ── Config ──────────────────────────────────────────────────────────────── */

const PORT         = Number(process.env.PORT)  || 4123;
const HOST         = process.env.HOST          || '127.0.0.1';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR  || path.join(os.homedir(), 'Desktop', 'Youtube Songs');
const MAX_TASKS    = 60; // evict oldest task RECORDS when over this limit (files are kept)

// Apple Music hand-off
const MUSIC_IMPORT         = process.env.MUSIC_IMPORT !== '0';
const MUSIC_PLAYLIST       = process.env.MUSIC_PLAYLIST || 'Juice WRLD Unreleased';
// Exact playlist by persistent ID — wins over the name when several playlists
// share a name (unambiguous target, nothing gets added to the wrong list).
const MUSIC_PLAYLIST_ID    = process.env.MUSIC_PLAYLIST_ID || '';
const MUSIC_IMPORT_FORMATS = (process.env.MUSIC_IMPORT_FORMATS || 'mp3')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const MUSIC_SCRIPT  = path.join(__dirname, 'add-to-music.applescript');
const REVEAL_SCRIPT = path.join(__dirname, 'reveal-in-music.applescript');
const LIST_SCRIPT   = path.join(__dirname, 'list-playlists.applescript');

// Videos (MP4) are kept out of the music library: they go into their own
// subfolder of DOWNLOAD_DIR and are never handed to Apple Music.  This lets the
// user stash clips from any artist without them flooding a music playlist.
const VIDEO_SUBDIR = process.env.VIDEO_SUBDIR || 'Videos';
const VIDEO_DIR    = path.join(DOWNLOAD_DIR, VIDEO_SUBDIR);

// Binary discovery — absolute paths so it works under the launchd agent too.
function firstExisting(paths, fallback) {
  for (const p of paths) { if (p && fs.existsSync(p)) return p; }
  return fallback;
}
const YTDLP_BIN  = process.env.YTDLP_PATH || firstExisting(
  ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp'], 'yt-dlp');
const FFMPEG_BIN = firstExisting(['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'], '');
const FFMPEG_DIR = FFMPEG_BIN ? path.dirname(FFMPEG_BIN) : '';
const OSASCRIPT  = '/usr/bin/osascript';

/* ── Setup ───────────────────────────────────────────────────────────────── */

for (const dir of [DOWNLOAD_DIR, VIDEO_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** @type {Map<string, TaskRecord>} */
const tasks = new Map();

/**
 * @typedef {Object} TaskRecord
 * @property {string}  id
 * @property {string}  status       — pending | preparing | downloading | complete | failed
 * @property {number}  progress     — 0-100
 * @property {string}  message
 * @property {string}  error
 * @property {string}  outputFile   — basename inside outputDir
 * @property {string}  outputDir    — absolute folder the file was saved to (DOWNLOAD_DIR, or VIDEO_DIR for mp4)
 * @property {string}  format       — mp3 | mp4
 * @property {boolean} musicWanted  — per-request Apple Music toggle
 * @property {string}  musicPlaylist   — target playlist name for this task
 * @property {string}  musicPlaylistId — target playlist persistent ID for this task
 * @property {string}  musicImport  — idle | importing | added | duplicate | skipped | failed | needs_permission
 * @property {string}  musicMessage
 * @property {number}  createdAt
 */

/* ── Express app ─────────────────────────────────────────────────────────── */

const app = express();

// CORS — allow requests from any Chrome extension origin
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

/* ── Routes ──────────────────────────────────────────────────────────────── */

/**
 * POST /api/download
 * Body: { url, format, title?, channel?, duration?, videoId?, thumbnail? }
 * Returns: { taskId, status: "pending", statusUrl: "/api/status/:taskId" }
 */
app.post('/api/download', (req, res) => {
  const { url, format, music, playlist, playlistId } = req.body || {};

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'missing_or_invalid_url' });
  }

  evictOldTasks();

  const taskId = crypto.randomBytes(8).toString('hex');
  const fmt = format === 'mp3' ? 'mp3' : 'mp4';

  /** @type {TaskRecord} */
  const task = {
    id:           taskId,
    status:       'pending',
    progress:     0,
    message:      'Queued',
    error:        '',
    outputFile:   '',
    format:       fmt,
    // MP4 → its own Videos subfolder; MP3 → the music library root.
    outputDir:    fmt === 'mp4' ? VIDEO_DIR : DOWNLOAD_DIR,
    // Per-request Music toggle from the extension; falls back to the env default.
    musicWanted:  typeof music === 'boolean' ? music : MUSIC_IMPORT,
    // Per-request target playlist (name + exact persistent ID); env default otherwise.
    musicPlaylist:   (typeof playlist === 'string' && playlist.trim()) ? playlist.trim() : MUSIC_PLAYLIST,
    musicPlaylistId: (typeof playlistId === 'string' && playlistId.trim()) ? playlistId.trim() : MUSIC_PLAYLIST_ID,
    musicImport:  'idle',
    musicMessage: '',
    createdAt:    Date.now()
  };

  tasks.set(taskId, task);

  // Fire and forget — response is immediate
  setImmediate(() => runYtDlp(task, url));

  return res.json({
    taskId,
    status:    'pending',
    statusUrl: `/api/status/${taskId}`
  });
});

/**
 * GET /api/status/:taskId
 * Returns the current task record.  When complete, includes a downloadUrl
 * pointing to GET /api/file/:taskId, plus the Apple Music import state.
 */
app.get('/api/status/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: 'task_not_found' });
  }

  const payload = {
    taskId:       task.id,
    status:       task.status,
    progress:     task.progress,
    message:      task.message,
    error:        task.error,
    musicImport:  task.musicImport,
    musicMessage: task.musicMessage
  };

  if (task.status === 'complete' && task.outputFile) {
    payload.downloadUrl = `http://${HOST}:${PORT}/api/file/${task.id}`;
    payload.filename    = task.outputFile;
  }

  return res.json(payload);
});

/**
 * GET /api/file/:taskId
 * Streams the completed download file back to the caller (chrome.downloads).
 */
app.get('/api/file/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task || !task.outputFile) {
    return res.status(404).json({ error: 'file_not_found' });
  }

  const filePath = path.join(task.outputDir || DOWNLOAD_DIR, task.outputFile);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'file_not_found_on_disk' });
  }

  res.download(filePath, task.outputFile);
});

/**
 * GET /api/health
 * Quick sanity check endpoint — also reports the Music hand-off config so the
 * extension can tell the user what will happen after a download.
 */
app.get('/api/health', (_req, res) => {
  res.json({
    ok:          true,
    tasks:       tasks.size,
    downloadDir: DOWNLOAD_DIR,
    music: {
      enabled:    MUSIC_IMPORT,
      playlist:   MUSIC_PLAYLIST,
      playlistId: MUSIC_PLAYLIST_ID,
      formats:    MUSIC_IMPORT_FORMATS
    }
  });
});

/**
 * GET /api/reveal?playlist=Name
 * Reveals the playlist in Apple Music and brings the app to the front.
 * The extension's "Reveal in Music" button calls this.
 */
app.get('/api/reveal', (req, res) => {
  const playlist   = req.query.playlist   ? String(req.query.playlist)   : MUSIC_PLAYLIST;
  const playlistId = req.query.playlistId ? String(req.query.playlistId) : MUSIC_PLAYLIST_ID;

  const proc = spawn(OSASCRIPT, [REVEAL_SCRIPT, playlist, playlistId]);
  let out = '';
  let err = '';

  proc.stdout.on('data', (d) => { out += d.toString(); });
  proc.stderr.on('data', (d) => { err += d.toString(); });

  proc.on('error', (e) => res.status(500).json({ ok: false, error: e.message }));

  proc.on('close', () => {
    const line = out.trim().split('\n').pop() || '';
    if (line.startsWith('ok')) {
      res.json({ ok: true });
    } else if (/-1743|not authoriz|Not authorized/i.test(err)) {
      res.status(403).json({ ok: false, error: 'needs_permission' });
    } else {
      res.json({ ok: false, error: (err.trim().split('\n').pop() || line || 'reveal_failed').slice(0, 160) });
    }
  });
});

/**
 * GET /api/playlists
 * Lists the user's Apple Music playlists (persistent ID, name, track count) so
 * the extension can offer a target-playlist picker.  Folders are skipped.
 */
app.get('/api/playlists', (_req, res) => {
  const proc = spawn(OSASCRIPT, [LIST_SCRIPT]);
  let out = '';
  let err = '';

  proc.stdout.on('data', (d) => { out += d.toString(); });
  proc.stderr.on('data', (d) => { err += d.toString(); });

  proc.on('error', (e) => res.status(500).json({ ok: false, error: e.message }));

  proc.on('close', () => {
    if (/-1743|not authoriz|not allowed to send Apple events|Not authorized/i.test(err)) {
      return res.status(403).json({ ok: false, error: 'needs_permission' });
    }
    const playlists = out.split('\n')
      .map((line) => line.split('\t'))
      .filter((parts) => parts.length >= 2 && parts[1].trim())
      .map((parts) => ({
        id:    (parts[0] || '').trim(),
        name:  (parts[1] || '').trim(),
        count: Number((parts[2] || '').trim()) || 0
      }));
    res.json({ ok: true, playlists, defaultId: MUSIC_PLAYLIST_ID, defaultName: MUSIC_PLAYLIST });
  });
});

/* ── yt-dlp runner ───────────────────────────────────────────────────────── */

/**
 * @param {TaskRecord} task
 * @param {string}     videoUrl
 */
function runYtDlp(task, videoUrl) {
  task.status  = 'preparing';
  task.message = task.format === 'mp3' ? 'Preparing audio' : 'Preparing video';

  // Human-friendly filename in the task's folder (yt-dlp sanitises unsafe chars).
  const outputTemplate = path.join(task.outputDir, '%(title)s.%(ext)s');

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--newline',        // one progress line per \n (easier to parse)
    '--embed-metadata'  // write title/artist/etc. so Apple Music shows real tags
  ];

  if (FFMPEG_DIR) {
    args.push('--ffmpeg-location', FFMPEG_DIR);
  }

  if (task.format === 'mp3') {
    args.push(
      '-x',
      '--audio-format',      'mp3',
      '--audio-quality',     '0',    // 0 = best VBR
      '--embed-thumbnail',           // cover art in the MP3 → shows up in Music
      '--convert-thumbnails', 'jpg'  // webp thumbnails can't embed directly
    );
  } else {
    // Prefer an MP4 container with best available quality.
    args.push(
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4'
    );
  }

  args.push('-o', outputTemplate, videoUrl);

  const proc = spawn(YTDLP_BIN, args);
  let detectedOutputFile = '';

  proc.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      parseLine(task, line.trim());
      const f = detectOutputFile(line);
      if (f) detectedOutputFile = f;
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) process.stderr.write(`[yt-dlp stderr] ${text}\n`);
  });

  proc.on('error', (err) => {
    if (err.code === 'ENOENT') {
      task.status  = 'failed';
      task.error   = 'yt_dlp_not_found';
      task.message =
        'yt-dlp not found. Install it: https://github.com/yt-dlp/yt-dlp#installation';
    } else {
      task.status  = 'failed';
      task.error   = 'spawn_failed';
      task.message = `Failed to start yt-dlp: ${err.message}`;
    }
    console.error(`[bridge] Task ${task.id} spawn error:`, err.message);
  });

  proc.on('close', (code) => {
    if (task.status === 'failed') return; // error handler already ran

    const outputFile = detectedOutputFile || findNewestFile(task.format, task.outputDir);

    if (code === 0 && outputFile && fs.existsSync(path.join(task.outputDir, outputFile))) {
      task.outputFile = outputFile;
      console.log(`[bridge] Task ${task.id} downloaded → ${outputFile}`);
      // Import into Apple Music (if applicable) BEFORE flipping to complete,
      // so both the popup and the panel observe the final music state in the
      // same status poll that first reports the download URL.
      finishTask(task);
    } else if (code === 0) {
      task.status  = 'failed';
      task.error   = 'output_file_missing';
      task.message = 'Download finished but output file was not found.';
      console.error(`[bridge] Task ${task.id} — file missing after exit 0`);
    } else {
      task.status  = 'failed';
      task.error   = 'yt_dlp_nonzero_exit';
      task.message = `yt-dlp exited with code ${code}`;
      console.error(`[bridge] Task ${task.id} — yt-dlp exit code ${code}`);
    }
  });
}

/**
 * Runs the Apple Music hand-off (if applicable) and only then marks the task
 * complete.  A Music hiccup never fails the download — it just annotates
 * task.musicImport, and the file is still served either way.
 * @param {TaskRecord} task
 */
async function finishTask(task) {
  try {
    await maybeImportToMusic(task);
  } catch (_) {
    // maybeImportToMusic already recorded the failure onto the task.
  }
  task.status   = 'complete';
  task.progress = 100;
  task.message  = 'Download complete';
}

/* ── Apple Music hand-off ────────────────────────────────────────────────── */

/**
 * If enabled and the format qualifies, import the finished file into the
 * configured Apple Music playlist via osascript.  Resolves once osascript
 * exits (or immediately when skipped).  Only mutates task.musicImport /
 * task.musicMessage — a Music hiccup never rejects, so the download always
 * finishes and the file is served regardless.
 * @param {TaskRecord} task
 * @returns {Promise<void>}
 */
function maybeImportToMusic(task) {
  if (!task.musicWanted || !MUSIC_IMPORT_FORMATS.includes(task.format)) {
    task.musicImport  = 'skipped';
    task.musicMessage = !task.musicWanted ? 'Music import off' : `${task.format.toUpperCase()} not imported`;
    return Promise.resolve();
  }

  const absPath = path.join(task.outputDir || DOWNLOAD_DIR, task.outputFile);
  // Expected library track name (file is "%(title)s.mp3" with title embedded) —
  // lets the helper reuse an existing library track instead of re-importing.
  const expectedName = path.basename(task.outputFile, path.extname(task.outputFile));
  const playlistName = task.musicPlaylist || MUSIC_PLAYLIST;
  task.status       = 'preparing';
  task.progress     = 98;
  task.message      = `Adding to ${playlistName}`;
  task.musicImport  = 'importing';
  task.musicMessage = `Adding to ${playlistName}`;

  return new Promise((resolve) => {
    const proc = spawn(OSASCRIPT, [MUSIC_SCRIPT, playlistName, absPath, task.musicPlaylistId || MUSIC_PLAYLIST_ID, expectedName]);
    let out = '';
    let err = '';

    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });

    proc.on('error', (e) => {
      task.musicImport  = 'failed';
      task.musicMessage = `osascript error: ${e.message}`;
      console.error(`[bridge] Task ${task.id} music import spawn error:`, e.message);
      resolve();
    });

    proc.on('close', () => {
      const line = out.trim().split('\n').pop() || '';

      if (line.startsWith('ok:added')) {
        task.musicImport  = 'added';
        task.musicMessage = `Added to ${playlistName}`;
      } else if (line.startsWith('ok:duplicate')) {
        task.musicImport  = 'duplicate';
        task.musicMessage = `Already in ${playlistName}`;
      } else if (/-1743|not authoriz|not allowed to send Apple events|Not authorized/i.test(err)) {
        task.musicImport  = 'needs_permission';
        task.musicMessage = 'Allow Music automation in System Settings → Privacy → Automation';
      } else {
        task.musicImport  = 'failed';
        task.musicMessage = (err.trim().split('\n').pop() || 'Music import failed').slice(0, 160);
      }

      console.log(`[bridge] Task ${task.id} music import → ${task.musicImport}`);
      if (task.musicImport === 'failed' && err.trim()) {
        console.log(`[bridge] Task ${task.id} music stderr: ${err.trim().replace(/\n/g, ' ').slice(0, 300)}`);
      }
      resolve();
    });
  });
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Parse a single stdout line from yt-dlp and mutate the task record.
 * @param {TaskRecord} task
 * @param {string}     line
 */
function parseLine(task, line) {
  // Progress:  [download]  42.1% of ~50.00MiB at 3.21MiB/s ETA 00:08
  const progMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
  if (progMatch) {
    task.status   = 'downloading';
    task.progress = Math.round(parseFloat(progMatch[1]));
    task.message  = `Downloading ${task.progress}%`;
    return;
  }

  if (line.includes('[ExtractAudio]') || line.includes('[Merger]')) {
    task.status   = 'preparing';
    task.message  = task.format === 'mp3' ? 'Converting to MP3' : 'Merging audio and video';
    task.progress = Math.max(task.progress, 92);
  }

  if (line.includes('[EmbedThumbnail]') || line.includes('[Metadata]')) {
    task.status   = 'preparing';
    task.message  = 'Writing tags & cover';
    task.progress = Math.max(task.progress, 96);
  }
}

/**
 * Detect the output filename from a yt-dlp log line.  Returns just the
 * basename so we can look it up in DOWNLOAD_DIR.
 * @param {string} line
 * @returns {string}
 */
function detectOutputFile(line) {
  // Ordered loosely oldest→newest; the LAST match in a run wins, so the
  // final post-processed filename (Metadata/ExtractAudio) overrides the
  // pre-conversion [download] Destination name.
  const patterns = [
    /\[download\] Destination: (.+)/,
    /\[download\] (.+) has already been downloaded/,
    /\[Merger\] Merging formats into "(.+)"/,
    /\[ExtractAudio\] Destination: (.+)/,
    /\[ExtractAudio\] Not converting audio (.+); file is already/,
    /\[VideoConvertor\] Converting video from .+ to .+; Destination: (.+)/,
    /\[FixupM4a\] .*Destination: (.+)/,
    /\[Metadata\] Adding metadata to "(.+)"/
  ];

  for (const re of patterns) {
    const m = line.match(re);
    if (m) return path.basename(m[1].trim().replace(/"/g, ''));
  }

  return '';
}

/**
 * Fallback: newest file in the given folder matching the task's expected
 * extension.  Used when log parsing missed the destination line.
 * @param {string} format
 * @param {string} [dir] folder to scan (defaults to DOWNLOAD_DIR)
 * @returns {string}
 */
function findNewestFile(format, dir) {
  const ext = format === 'mp3' ? '.mp3' : '.mp4';
  const scanDir = dir || DOWNLOAD_DIR;
  try {
    const files = fs.readdirSync(scanDir)
      .filter((f) => f.toLowerCase().endsWith(ext))
      .map((f) => ({ f, m: fs.statSync(path.join(scanDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files[0] ? files[0].f : '';
  } catch (_) {
    return '';
  }
}

/**
 * Remove the oldest task RECORDS once we exceed MAX_TASKS.
 * Files on disk are intentionally KEPT — the Youtube Songs folder is the
 * user's library, not a scratch cache.
 */
function evictOldTasks() {
  if (tasks.size < MAX_TASKS) return;

  const sorted  = [...tasks.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const toEvict = sorted.slice(0, Math.ceil(MAX_TASKS / 4));

  for (const [id] of toEvict) {
    tasks.delete(id); // keep the downloaded file on disk
  }
}

/* ── Start ───────────────────────────────────────────────────────────────── */

app.listen(PORT, HOST, () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║          WaveDrop Bridge  —  ready                  ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Listening on  http://${HOST}:${PORT}`);
  console.log(`║  Download dir  ${DOWNLOAD_DIR}`);
  console.log(`║  Video dir     ${VIDEO_DIR}`);
  console.log(`║  yt-dlp        ${YTDLP_BIN}`);
  console.log(`║  ffmpeg dir    ${FFMPEG_DIR || '(PATH)'}`);
  console.log(`║  Music import  ${MUSIC_IMPORT ? 'ON' : 'OFF'} → "${MUSIC_PLAYLIST}" [${MUSIC_IMPORT_FORMATS.join(', ')}]`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Bridge endpoint → http://${HOST}:${PORT}/api/download`);
  console.log('╚══════════════════════════════════════════════════════╝\n');
});
