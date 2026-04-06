'use strict';

/**
 * WaveDrop Bridge Server
 * ---------------------
 * A thin Express wrapper around yt-dlp that the Chrome extension talks to.
 *
 * Prerequisites:
 *   npm install            (inside this bridge/ directory)
 *   yt-dlp installed and on PATH  — https://github.com/yt-dlp/yt-dlp#installation
 *   ffmpeg on PATH  (required for MP4 merging and MP3 conversion)
 *
 * Start:
 *   node bridge/server.js
 *
 * Configure in the extension:
 *   Bridge endpoint → http://127.0.0.1:4123/api/download
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
const MAX_TASKS    = 50; // evict oldest when over this limit

/* ── Setup ───────────────────────────────────────────────────────────────── */

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

/** @type {Map<string, TaskRecord>} */
const tasks = new Map();

/**
 * @typedef {Object} TaskRecord
 * @property {string}  id
 * @property {string}  status   — pending | preparing | downloading | complete | failed
 * @property {number}  progress — 0-100
 * @property {string}  message
 * @property {string}  error
 * @property {string}  outputFile  — basename inside DOWNLOAD_DIR
 * @property {string}  format   — mp3 | mp4
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
 *
 * Returns:  { taskId, status: "pending", statusUrl: "/api/status/:taskId" }
 */
app.post('/api/download', (req, res) => {
  const { url, format } = req.body || {};

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'missing_or_invalid_url' });
  }

  evictOldTasks();

  const taskId = crypto.randomBytes(8).toString('hex');

  /** @type {TaskRecord} */
  const task = {
    id:         taskId,
    status:     'pending',
    progress:   0,
    message:    'Queued',
    error:      '',
    outputFile: '',
    format:     format === 'mp3' ? 'mp3' : 'mp4',
    createdAt:  Date.now()
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
 * pointing to GET /api/file/:taskId.
 */
app.get('/api/status/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: 'task_not_found' });
  }

  const payload = {
    taskId:   task.id,
    status:   task.status,
    progress: task.progress,
    message:  task.message,
    error:    task.error
  };

  if (task.status === 'complete' && task.outputFile) {
    payload.downloadUrl = `http://${HOST}:${PORT}/api/file/${task.id}`;
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

  const filePath = path.join(DOWNLOAD_DIR, task.outputFile);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'file_not_found_on_disk' });
  }

  res.download(filePath, task.outputFile);
});

/**
 * GET /api/health
 * Quick sanity check endpoint — useful for debugging.
 */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, tasks: tasks.size, downloadDir: DOWNLOAD_DIR });
});

/* ── yt-dlp runner ───────────────────────────────────────────────────────── */

/**
 * @param {TaskRecord} task
 * @param {string}     videoUrl
 */
function runYtDlp(task, videoUrl) {
  task.status  = 'preparing';
  task.message = task.format === 'mp3' ? 'Preparing audio' : 'Preparing video';

  // Output template: <DOWNLOAD_DIR>/<taskId>.%(ext)s
  const outputTemplate = path.join(DOWNLOAD_DIR, `${task.id}.%(ext)s`);

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--newline'       // one progress line per \n (easier to parse)
  ];

  if (task.format === 'mp3') {
    args.push(
      '-x',
      '--audio-format',  'mp3',
      '--audio-quality', '0'   // 0 = best VBR
    );
  } else {
    // Prefer an MP4 container with best available quality.
    // Falls back to the single best stream when separate video+audio isn't available.
    args.push(
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4'
    );
  }

  args.push('-o', outputTemplate, videoUrl);

  const proc = spawn('yt-dlp', args);
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
    // yt-dlp writes some non-error diagnostics to stderr.
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

    const outputFile =
      detectedOutputFile || findOutputFile(task.id);

    if (code === 0 && outputFile && fs.existsSync(path.join(DOWNLOAD_DIR, outputFile))) {
      task.status     = 'complete';
      task.progress   = 100;
      task.message    = 'Download complete';
      task.outputFile = outputFile;
      console.log(`[bridge] Task ${task.id} complete → ${outputFile}`);
    } else if (code === 0) {
      // yt-dlp exited cleanly but we couldn't find the file.
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

  // Preparing audio / merging indicator
  if (line.includes('[ExtractAudio]') || line.includes('[Merger]')) {
    task.status   = 'preparing';
    task.message  = task.format === 'mp3' ? 'Converting to MP3' : 'Merging audio and video';
    task.progress = Math.max(task.progress, 92);
  }
}

/**
 * Detect the output filename from a yt-dlp log line.
 * Returns just the basename so we can look it up in DOWNLOAD_DIR.
 * @param {string} line
 * @returns {string}
 */
function detectOutputFile(line) {
  const patterns = [
    /\[download\] Destination: (.+)/,
    /\[Merger\] Merging formats into "(.+)"/,
    /\[ExtractAudio\] Destination: (.+)/,
    /\[VideoConvertor\] Converting video from .+ to .+; Destination: (.+)/
  ];

  for (const re of patterns) {
    const m = line.match(re);
    if (m) return path.basename(m[1].trim().replace(/"/g, ''));
  }

  return '';
}

/**
 * Scan DOWNLOAD_DIR for any file whose name starts with the taskId.
 * Fall-back for when yt-dlp log parsing missed the destination line.
 * @param {string} taskId
 * @returns {string}
 */
function findOutputFile(taskId) {
  try {
    const files = fs.readdirSync(DOWNLOAD_DIR).filter((f) => f.startsWith(taskId));
    return files[0] || '';
  } catch (_) {
    return '';
  }
}

/**
 * Remove the oldest tasks once we exceed MAX_TASKS, and delete their files.
 */
function evictOldTasks() {
  if (tasks.size < MAX_TASKS) return;

  const sorted = [...tasks.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const toEvict = sorted.slice(0, Math.ceil(MAX_TASKS / 4));

  for (const [id, task] of toEvict) {
    if (task.outputFile) {
      const fp = path.join(DOWNLOAD_DIR, task.outputFile);
      try { fs.unlinkSync(fp); } catch (_) {}
    }
    tasks.delete(id);
  }
}

/* ── Start ───────────────────────────────────────────────────────────────── */

app.listen(PORT, HOST, () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║          WaveDrop Bridge  —  ready                  ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Listening on  http://${HOST}:${PORT}               ║`);
  console.log(`║  Download dir  ${DOWNLOAD_DIR}`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  Configure the extension:                            ║');
  console.log(`║  Bridge endpoint → http://${HOST}:${PORT}/api/download  ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');
});
