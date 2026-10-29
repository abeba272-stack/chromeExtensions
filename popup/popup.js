const Constants = window.WaveDropConstants;
const Messages = window.WaveDropMessages;
const Storage = window.WaveDropStorage;
const { MESSAGE_TYPES, STORAGE_KEYS, DOWNLOAD_FORMATS, TASK_STATUS } = Constants;

const root = document.getElementById("wd-popup-root");
const contextBadge = document.getElementById("wd-popup-context-badge");

const state = {
  activeTab: null,
  activeVideo: null,
  taskState: Storage.createDefaultTaskState(),
  panelState: Storage.createDefaultPanelState(),
  preferences: Storage.createDefaultPreferences(),
  draftPreferences: Storage.createDefaultPreferences(),
  onYouTube: false,
  loading: true,
  notice: "",
  noticeTone: "info",
  bridgeOnline: null,      // null = unknown, true/false once checked
  musicConfig: null,       // { enabled, playlist, formats } from the bridge health
  playlists: []            // [{ id, name, count }] from GET /api/playlists
};

/*
 * Tracks whether the main content sections have been rendered at least once.
 * Used by render() to add the .wd-layout-entering class only on the first
 * non-loading render — this triggers the section stagger animation exactly
 * once, without re-firing on every progress tick during a download.
 */
let _hasRenderedContent = false;

document.addEventListener("DOMContentLoaded", () => {
  initializePopup();
  root.addEventListener("click", handleClick);
  root.addEventListener("input", handleInput);
  root.addEventListener("change", handleChange);
  initControlMenu();
});

/* ─── Control-centre dropdown ──────────────────────────────────────────── */

function initControlMenu() {
  const menuBtn = document.getElementById("wd-popup-control-menu");
  const menu = document.getElementById("wd-popup-menu");
  if (!menuBtn || !menu) return;

  function openMenu() {
    /* Force the per-item CSS animations to restart on every open.
     * Without this, rapidly closing + reopening plays a stale animation
     * that started mid-frame and looks wrong.
     * Technique: briefly remove is-open (so the browser drops the running
     * animation), then add it back in the next microtask. */
    menu.classList.remove("is-open");
    menu.querySelectorAll(".wd-popup-menu-item").forEach((el) => {
      /* Nudge the element so the browser registers a layout change */
      void el.offsetWidth; // eslint-disable-line no-void
    });
    menu.classList.add("is-open");
    menuBtn.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    menu.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
  }

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.contains("is-open") ? closeMenu() : openMenu();
  });

  /* Close on outside click */
  document.addEventListener("click", closeMenu);

  /* Prevent clicks inside the menu from bubbling to the document listener */
  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    const item = e.target.closest("[data-menu-action]");
    if (!item) return;

    closeMenu();
    switch (item.dataset.menuAction) {
      case "settings":
        /* Scroll to the bottom of the scroll area where settings live */
        root.scrollTo({ top: root.scrollHeight, behavior: "smooth" });
        break;
      case "clear":
        resetTaskState().catch(() => {});
        break;
      default:
        break;
    }
  });

  /* Close on Escape key */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setNotice(message, tone = "info") {
  state.notice = message;
  state.noticeTone = tone;
  render();

  window.clearTimeout(setNotice.timerId);
  setNotice.timerId = window.setTimeout(() => {
    state.notice = "";
    state.noticeTone = "info";
    render();
  }, 2600);
}

function getStatusLabel(taskState) {
  if (taskState.status === TASK_STATUS.FAILED) {
    return "Error";
  }
  if (taskState.status === TASK_STATUS.COMPLETE) {
    return "Complete";
  }
  if (taskState.status === TASK_STATUS.DOWNLOADING) {
    return "Downloading";
  }
  if (taskState.status === TASK_STATUS.PREPARING) {
    return taskState.format === DOWNLOAD_FORMATS.MP3 ? "Preparing audio" : "Preparing video";
  }
  if (taskState.status === TASK_STATUS.PENDING) {
    return "Collecting stream info";
  }
  return "Ready";
}

function getBridgeState() {
  if (state.bridgeOnline === false) return "Bridge offline";
  if (state.bridgeOnline === true) return "Bridge ready";
  return "Bridge …";
}

/**
 * Derive the bridge origin's /api/health URL from the configured download
 * endpoint (…/api/download → …/api/health).
 */
function getBridgeHealthUrl() {
  try {
    return new URL("/api/health", state.preferences.localBridgeEndpoint).toString();
  } catch (_) {
    return "";
  }
}

/**
 * Ping the bridge once so the UI can show an honest online/offline state and
 * learn the Music hand-off config (playlist name, formats).
 */
async function checkBridgeHealth() {
  const url = getBridgeHealthUrl();
  if (!url) {
    state.bridgeOnline = false;
    return;
  }

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1500);
    const res = await fetch(url, { signal: controller.signal });
    window.clearTimeout(timer);
    if (!res.ok) throw new Error("bad_health");
    const data = await res.json();
    state.bridgeOnline = true;
    state.musicConfig = data && data.music ? data.music : null;
  } catch (_) {
    state.bridgeOnline = false;
  }
}

/**
 * Pull the user's Apple Music playlists from the bridge so the target-playlist
 * picker can list them.  Silent on failure — the picker then just shows the
 * configured default.
 */
async function fetchPlaylists() {
  let url;
  try {
    url = new URL("/api/playlists", state.preferences.localBridgeEndpoint).toString();
  } catch (_) {
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.ok && Array.isArray(data.playlists)) {
      state.playlists = data.playlists;
    }
  } catch (_) {
    // Bridge offline — selector falls back to the default option.
  }
}

/**
 * The Apple Music playlist a download should land in: the user's remembered
 * choice if set, otherwise the bridge's configured default.
 */
function getChosenPlaylist() {
  const prefId = state.preferences.musicPlaylistId;
  const prefName = state.preferences.musicPlaylistName;
  if (prefId || prefName) {
    return {
      id: prefId || "",
      name: prefName || (state.musicConfig && state.musicConfig.playlist) || "Juice WRLD Unreleased"
    };
  }
  return {
    id: (state.musicConfig && state.musicConfig.playlistId) || "",
    name: (state.musicConfig && state.musicConfig.playlist) || "Juice WRLD Unreleased"
  };
}

function getPopupVideo() {
  return state.onYouTube ? state.activeVideo : null;
}

function getContextBadgeLabel() {
  if (state.loading) {
    return "Loading";
  }

  if (state.onYouTube && state.activeVideo) {
    return "Video ready";
  }

  if (state.onYouTube) {
    return "YouTube page";
  }

  return "Inactive tab";
}

function syncHeader() {
  if (contextBadge) {
    contextBadge.textContent = getContextBadgeLabel();
  }
}

async function initializePopup() {
  render();

  try {
    const [tabs, appStateResponse] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      Messages.sendRuntime(MESSAGE_TYPES.GET_APP_STATE)
    ]);

    state.activeTab = tabs[0] || null;
    state.taskState = Storage.normalizeTaskState(appStateResponse?.data?.taskState);
    state.panelState = Storage.normalizePanelState(appStateResponse?.data?.panelState);
    state.preferences = Storage.normalizePreferences(appStateResponse?.data?.preferences);
    state.draftPreferences = { ...state.preferences };

    // Bridge health — fire and forget; re-render when the verdict lands.
    // Once the bridge answers, pull the playlist list for the target picker.
    checkBridgeHealth().then(() => {
      render();
      fetchPlaylists().then(() => render());
    });

    const context = await getActiveTabContext(state.activeTab);
    state.onYouTube = context.pageSupported;
    state.activeVideo = context.video || appStateResponse?.data?.activeVideo || null;
  } catch (error) {
    setNotice("Could not load the active tab", "error");
  } finally {
    state.loading = false;
    render();
  }
}

async function getActiveTabContext(tab) {
  if (!tab?.id) {
    return { video: null, pageSupported: false };
  }

  try {
    return await requestVideoContext(tab);
  } catch (error) {
    return { video: null, pageSupported: false };
  }
}

async function requestVideoContext(tab) {
  try {
    const response = await Messages.sendTab(tab.id, MESSAGE_TYPES.GET_VIDEO_CONTEXT);
    return {
      video: response?.data?.video || null,
      pageSupported: response?.data?.pageSupported || false
    };
  } catch (error) {
    await Messages.sendRuntime(MESSAGE_TYPES.ENSURE_INJECTION, {
      tabId: tab.id,
      url: tab.url
    });

    const response = await Messages.sendTab(tab.id, MESSAGE_TYPES.GET_VIDEO_CONTEXT);
    return {
      video: response?.data?.video || null,
      pageSupported: response?.data?.pageSupported || false
    };
  }
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `<div class="wd-popup-banner wd-popup-banner-${escapeHtml(state.noticeTone)}">${escapeHtml(state.notice)}</div>`;
}

function renderDownloadSection() {
  const video = getPopupVideo();
  const busy = Storage.isBusyTask(state.taskState);
  const Icons = window.WaveDropIcons || {};
  const dlIcon = Icons.download ? Icons.download(14) : "";
  const extIcon = Icons.externalLink ? Icons.externalLink(11) : "";

  if (!video) {
    return `
      <section class="wd-popup-section">
        <div class="wd-popup-section-head">
          <span class="wd-popup-section-title">Download controls</span>
          <span class="wd-popup-badge">No source</span>
        </div>
        <div class="wd-popup-video-block">
          <div class="wd-popup-video-frame wd-popup-video-frame-empty">—</div>
          <div class="wd-popup-video-copy">
            <p class="wd-popup-video-title">No active video</p>
            <p class="wd-popup-video-meta">Open a YouTube watch page to unlock downloads.</p>
          </div>
        </div>
        <div class="wd-popup-download-grid">
          <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp4" data-action="download-mp4" disabled>
            <span class="wd-popup-button-head">${dlIcon}<span class="wd-popup-button-title">MP4</span></span>
            <span class="wd-popup-button-copy">Video + audio</span>
          </button>
          <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp3" data-action="download-mp3" disabled>
            <span class="wd-popup-button-head">${dlIcon}<span class="wd-popup-button-title">MP3</span></span>
            <span class="wd-popup-button-copy">Audio only</span>
          </button>
        </div>
        <div class="wd-popup-utility-row">
          <button class="wd-popup-button wd-popup-button-secondary" data-action="open-panel" ${state.onYouTube ? "" : "disabled"}>Panel on page</button>
          <button class="wd-popup-button wd-popup-button-secondary" data-action="external" disabled>${extIcon} External tool</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="wd-popup-section">
      <div class="wd-popup-section-head">
        <span class="wd-popup-section-title">Download controls</span>
        <span class="wd-popup-badge" data-status="${escapeHtml(state.taskState.status)}">${escapeHtml(getStatusLabel(state.taskState))}</span>
      </div>
      <div class="wd-popup-video-block">
        <div class="wd-popup-video-frame">
          <img class="wd-popup-video-thumb" src="${escapeHtml(video.thumbnail)}" alt="${escapeHtml(video.title)} thumbnail" />
        </div>
        <div class="wd-popup-video-copy">
          <p class="wd-popup-video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</p>
          <div class="wd-popup-meta-row">
            <span class="wd-popup-video-meta">${escapeHtml(video.channelName)}</span>
            <span class="wd-popup-meta-dot"></span>
            <span class="wd-popup-video-meta">${escapeHtml(video.duration)}</span>
          </div>
        </div>
      </div>
      <div class="wd-popup-download-grid">
        <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp4${busy ? " is-busy" : ""}" data-action="download-mp4" ${busy ? "disabled" : ""}>
          <span class="wd-popup-button-head">${dlIcon}<span class="wd-popup-button-title">MP4</span></span>
          <span class="wd-popup-button-copy">${busy && state.taskState.format === DOWNLOAD_FORMATS.MP4 ? getStatusLabel(state.taskState) : "Video + audio"}</span>
        </button>
        <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp3${busy ? " is-busy" : ""}" data-action="download-mp3" ${busy ? "disabled" : ""}>
          <span class="wd-popup-button-head">${dlIcon}<span class="wd-popup-button-title">MP3</span></span>
          <span class="wd-popup-button-copy">${busy && state.taskState.format === DOWNLOAD_FORMATS.MP3 ? getStatusLabel(state.taskState) : "Audio only"}</span>
        </button>
      </div>
      ${renderPlaylistSelector()}
      <div class="wd-popup-utility-row">
        <button class="wd-popup-button wd-popup-button-secondary" data-action="open-panel">Panel on page</button>
        <button class="wd-popup-button wd-popup-button-secondary" data-action="external" ${busy ? "disabled" : ""}>${extIcon} External tool</button>
      </div>
    </section>
  `;
}

/**
 * Target-playlist picker (MP3 only).  Lists the user's real Apple Music
 * playlists; the selected value is the playlist's persistent ID.  Disabled
 * (dimmed) when the Music hand-off toggle is off.
 */
function renderPlaylistSelector() {
  const importOn = state.preferences.musicImportEnabled !== false;
  const Icons = window.WaveDropIcons || {};
  const noteIcon = Icons.musicNote ? Icons.musicNote(12) : "";
  const playlists = Array.isArray(state.playlists) ? state.playlists : [];
  const chosen = getChosenPlaylist();

  let options;
  if (!playlists.length) {
    options = `<option value="${escapeHtml(chosen.id)}">${escapeHtml(chosen.name)}</option>`;
  } else {
    options = playlists.map((p) => {
      const selected = (chosen.id && p.id === chosen.id) || (!chosen.id && p.name === chosen.name);
      return `<option value="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}"${selected ? " selected" : ""}>${escapeHtml(p.name)} · ${Number(p.count) || 0}</option>`;
    }).join("");
  }

  return `
    <div class="wd-popup-playlist${importOn ? "" : " is-disabled"}">
      <span class="wd-popup-playlist-label">${noteIcon}<span>Ziel-Playlist · nur MP3</span></span>
      <div class="wd-popup-select-wrap">
        <select class="wd-popup-select" data-select="musicPlaylist" ${importOn ? "" : "disabled"} aria-label="Ziel-Playlist für MP3-Downloads">
          ${options}
        </select>
        <svg class="wd-popup-select-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </div>
  `;
}

function defaultMusicMessage(st, playlist) {
  switch (st) {
    case "importing":        return `Adding to ${playlist}…`;
    case "added":            return `Added to ${playlist}`;
    case "duplicate":        return `Already in ${playlist}`;
    case "skipped":          return "Not added to Music";
    case "failed":           return "Music import failed";
    case "needs_permission": return "Allow Music automation in System Settings";
    default:                 return "";
  }
}

/**
 * The Apple Music hand-off row — appears under the progress bar once a
 * download reaches the Music stage.  Style + icon reflect the import state.
 */
function renderMusicRow(taskState) {
  const st = taskState.musicImport;
  if (!st || st === "idle") {
    return "";
  }

  const Icons = window.WaveDropIcons || {};
  const noteIcon  = Icons.musicNote ? Icons.musicNote(13) : "";
  const checkIcon = Icons.check ? Icons.check(13) : "";
  const alertIcon = Icons.alert ? Icons.alert(13) : "";

  const playlist = getChosenPlaylist().name;
  const msg = taskState.musicMessage || defaultMusicMessage(st, playlist);

  let tone = "info";
  let icon = noteIcon;
  if (st === "added")            { tone = "success"; icon = checkIcon; }
  else if (st === "duplicate")   { tone = "muted";   icon = checkIcon; }
  else if (st === "importing")   { tone = "active";  icon = noteIcon; }
  else if (st === "skipped")     { tone = "muted";   icon = noteIcon; }
  else if (st === "failed")      { tone = "error";   icon = alertIcon; }
  else if (st === "needs_permission") { tone = "warn"; icon = alertIcon; }

  const spinner = st === "importing" ? `<span class="wd-popup-music-spinner" aria-hidden="true"></span>` : "";
  const canReveal = st === "added" || st === "duplicate";
  const reveal = canReveal
    ? `<button class="wd-popup-music-reveal" data-action="reveal-music" title="Show the playlist in Apple Music">In Music anzeigen</button>`
    : "";

  return `
    <div class="wd-popup-music-row wd-popup-music-${escapeHtml(tone)}" data-music="${escapeHtml(st)}">
      <span class="wd-popup-music-icon">${spinner}${icon}</span>
      <span class="wd-popup-music-text">${escapeHtml(msg)}</span>
      ${reveal}
    </div>
  `;
}

function renderStatusSection() {
  const progress = Math.max(0, Math.min(100, Number(state.taskState.progress) || 0));
  const copy = state.taskState.error || state.taskState.message || "Ready";
  const activeFormat = (state.taskState.format || state.preferences.preferredFormat || DOWNLOAD_FORMATS.MP4).toUpperCase();

  return `
    <section class="wd-popup-section">
      <div class="wd-popup-section-head">
        <span class="wd-popup-section-title">Status</span>
        <span class="wd-popup-progress-value">${escapeHtml(getStatusLabel(state.taskState))} &nbsp;${progress}%</span>
      </div>
      ${renderNotice()}
      <div class="wd-popup-progress-track" aria-label="Download progress ${progress}%">
        <span class="wd-popup-progress-fill" data-state="${escapeHtml(state.taskState.status)}" style="width:${progress}%"${progress > 0 ? ' data-active' : ''}></span>
      </div>
      <div class="wd-popup-progress-head">
        <p class="wd-popup-status-copy">${escapeHtml(copy)}</p>
        <span class="wd-popup-badge" data-bridge="${state.bridgeOnline === false ? 'offline' : 'online'}">${escapeHtml(activeFormat)} &nbsp;·&nbsp; ${escapeHtml(getBridgeState())}</span>
      </div>
      ${renderMusicRow(state.taskState)}
      <div class="wd-popup-utility-row">
        <button class="wd-popup-button wd-popup-button-secondary" data-action="reset-task">Clear status</button>
      </div>
    </section>
  `;
}

function renderSettingsSection() {
  const on = state.preferences.musicImportEnabled !== false;
  const playlist = getChosenPlaylist().name;
  const Icons = window.WaveDropIcons || {};
  const noteIcon = Icons.musicNote ? Icons.musicNote(14) : "";

  return `
    <section class="wd-popup-section wd-popup-settings-section">
      <div class="wd-popup-section-head">
        <span class="wd-popup-section-title">Settings</span>
      </div>
      <label class="wd-popup-toggle">
        <input type="checkbox" class="wd-popup-toggle-input" data-toggle="musicImportEnabled" ${on ? "checked" : ""} />
        <span class="wd-popup-toggle-track"><span class="wd-popup-toggle-thumb"></span></span>
        <span class="wd-popup-toggle-copy">
          <span class="wd-popup-toggle-title">${noteIcon}<span>In Apple Music übertragen</span></span>
          <span class="wd-popup-toggle-sub">MP3 → ${escapeHtml(playlist)}</span>
        </span>
      </label>
    </section>
  `;
}

function renderLoading() {
  syncHeader();
  root.innerHTML = `
    <div class="wd-popup-layout wd-popup-skeleton">
      <div class="wd-popup-skeleton-card"></div>
      <div class="wd-popup-skeleton-card"></div>
    </div>
  `;
}

function render() {
  syncHeader();

  if (state.loading) {
    _hasRenderedContent = false;
    renderLoading();
    return;
  }

  /* On the very first non-loading render, stamp .wd-layout-entering so the
   * CSS section-stagger animation fires.  Every subsequent render (progress
   * ticks, status changes) gets a plain wrapper — sections never re-animate. */
  const enterClass = _hasRenderedContent ? "" : " wd-layout-entering";
  _hasRenderedContent = true;

  root.innerHTML = `
    <div class="wd-popup-layout${enterClass}">
      ${renderDownloadSection()}
      ${renderStatusSection()}
      ${renderSettingsSection()}
    </div>
  `;
}

async function savePreferences() {
  const response = await Messages.sendRuntime(MESSAGE_TYPES.SET_PREFERENCES, {
    preferences: state.draftPreferences
  });

  if (!response?.ok || !response.data) {
    throw new Error(response?.error || "preferences_save_failed");
  }

  state.preferences = Storage.normalizePreferences(response.data);
  state.draftPreferences = { ...state.preferences };
  setNotice("Provider settings saved", "success");
}

/**
 * Build a sanitised filename for chrome.downloads.download().
 * Mirrors Providers.createDownloadFilename without importing providers.js
 * a second time (it is already loaded via popup.html's script tag, but we
 * keep this as a safe fallback in case the module hasn't registered yet).
 */
function createPopupDownloadFilename(video, format) {
  const Providers = window.WaveDropProviders;
  if (Providers && typeof Providers.createDownloadFilename === "function") {
    return Providers.createDownloadFilename(video, format);
  }

  const ext = format === DOWNLOAD_FORMATS.MP3 ? "mp3" : "mp4";
  const clean = (s, fb) =>
    String(s || fb)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  return `${clean(video.channelName, "YouTube")}/${clean(video.title, "WaveDrop export")}.${ext}`;
}

/**
 * Persist a partial task state update to the service worker (and therefore
 * to chrome.storage).  Returns the normalised next state.
 */
async function persistTaskUpdate(partial) {
  try {
    const response = await Messages.sendRuntime(MESSAGE_TYPES.UPDATE_TASK_STATE, { partial });
    if (response?.ok && response.data) {
      return Storage.normalizeTaskState(response.data);
    }
  } catch (_) {
    // Network hiccup — fall through to local-only merge.
  }
  return Storage.normalizeTaskState({ ...state.taskState, ...partial });
}

/**
 * Download pipeline — runs entirely inside the popup page so it is not
 * subject to the MV3 service-worker 30-second inactivity limit.
 *
 * Flow:
 *  1. INIT_DOWNLOAD  → worker allocates a task ID and persists initial state.
 *  2. initiateBridgeTask → POST to the local bridge, get back a statusUrl.
 *  3. Poll statusUrl every 1.2 s until complete or failed.
 *  4. On complete → chrome.downloads.download() directly from the popup.
 *  5. Every state change is synced back to the worker via UPDATE_TASK_STATE
 *     so the panel (content script) sees live progress too.
 */
async function handleDownload(format) {
  const video = getPopupVideo();

  if (!video) {
    setNotice("Open a YouTube video first", "error");
    return;
  }

  // Check bridge configuration before even touching the worker.
  if (!state.preferences.localBridgeEndpoint) {
    handlePopupError(new Error("bridge_not_configured"));
    return;
  }

  const Providers = window.WaveDropProviders;
  if (!Providers) {
    setNotice("Provider module not loaded — reload the extension.", "error");
    return;
  }

  /* ── 1. Allocate task in storage ──────────────────────────────────────── */
  const initResponse = await Messages.sendRuntime(MESSAGE_TYPES.INIT_DOWNLOAD, {
    video,
    format
  });

  if (!initResponse?.ok || !initResponse.data) {
    throw new Error(initResponse?.error || "download_init_failed");
  }

  state.taskState = Storage.normalizeTaskState(initResponse.data);
  render();

  /* ── 2. POST to the bridge ────────────────────────────────────────────── */
  let bridgeResult;
  try {
    bridgeResult = await Providers.initiateBridgeTask({
      video,
      format,
      preferences: state.preferences
    });
  } catch (err) {
    const offline = isBridgeOfflineError(err);
    if (offline) state.bridgeOnline = false;
    state.taskState = await persistTaskUpdate({
      status: TASK_STATUS.FAILED,
      progress: 0,
      message: offline
        ? "Bridge offline — is the WaveDrop bridge running?"
        : Storage.normalizeText(err?.message, Constants.DEFAULT_STRINGS.failed),
      error: offline ? "bridge_offline" : Storage.normalizeText(err?.message, "bridge_error")
    });
    render();
    throw offline ? new Error("bridge_offline") : err; // Surfaces to handleClick → handlePopupError
  }

  /* ── 3a. Bridge responded synchronously with a download URL ──────────── */
  if (bridgeResult.complete) {
    await _finalizeDownload(video, format, bridgeResult.downloadUrl, bridgeResult.message);
    return;
  }

  /* ── 3b. Async job — poll statusUrl ──────────────────────────────────── */
  state.taskState = await persistTaskUpdate({
    status: TASK_STATUS.PREPARING,
    progress: 10,
    message: bridgeResult.message
  });
  render();

  const statusUrl = bridgeResult.statusUrl;
  const MAX_POLLS = 120; // 120 × 1.2 s = 2.4 minutes

  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1200));

    let pollData;
    try {
      const res = await fetch(statusUrl, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("bridge_status_failed");
      pollData = await res.json();
    } catch (fetchErr) {
      // Transient network error — keep trying.
      continue;
    }

    const rawStatus = String(pollData.status || "").toLowerCase();
    let nextStatus = TASK_STATUS.PREPARING;
    if (rawStatus === "pending") nextStatus = TASK_STATUS.PENDING;
    else if (rawStatus === "downloading") nextStatus = TASK_STATUS.DOWNLOADING;
    else if (["complete", "completed", "done"].includes(rawStatus)) nextStatus = TASK_STATUS.COMPLETE;
    else if (["failed", "error"].includes(rawStatus)) nextStatus = TASK_STATUS.FAILED;

    const progress = Math.min(100, Math.max(0, Number(pollData.progress) || 0));
    const message = String(pollData.message || Constants.DEFAULT_STRINGS.downloading);
    const downloadUrl = String(pollData.downloadUrl || "");
    const pollError = String(pollData.error || "");
    const musicImport = String(pollData.musicImport || "");
    const musicMessage = String(pollData.musicMessage || "");

    if (nextStatus === TASK_STATUS.FAILED) {
      state.taskState = await persistTaskUpdate({
        status: TASK_STATUS.FAILED,
        progress: 0,
        message: pollError || message || Constants.DEFAULT_STRINGS.failed,
        error: pollError || "bridge_task_failed"
      });
      render();
      return;
    }

    if (nextStatus === TASK_STATUS.COMPLETE && downloadUrl) {
      await _finalizeDownload(video, format, downloadUrl, message, musicImport, musicMessage);
      return;
    }

    state.taskState = await persistTaskUpdate({
      status: nextStatus,
      progress,
      message,
      error: "",
      musicImport,
      musicMessage
    });
    render();
  }

  /* Timed out */
  state.taskState = await persistTaskUpdate({
    status: TASK_STATUS.FAILED,
    progress: 0,
    message: "Bridge timed out",
    error: "bridge_timeout"
  });
  render();
}

/**
 * Triggers the browser download once the bridge has a ready file URL.
 * Updates task state to COMPLETE regardless of whether chrome.downloads
 * succeeds (partial failures are surfaced via a notice, not a broken state).
 */
async function _finalizeDownload(video, format, downloadUrl, bridgeMessage, musicImport, musicMessage) {
  // The bridge already saved the file to the Youtube Songs folder (and, for
  // MP3, handed it to Apple Music).  We deliberately do NOT trigger a second
  // browser download into the Downloads folder — one copy is enough.
  state.taskState = await persistTaskUpdate({
    status: TASK_STATUS.COMPLETE,
    progress: 100,
    message: bridgeMessage || Constants.DEFAULT_STRINGS.complete,
    error: "",
    browserDownloadId: null,
    musicImport: musicImport || "",
    musicMessage: musicMessage || ""
  });
  render();
}

async function openPanelOnPage() {
  if (!state.activeTab?.id || !state.activeTab?.url) {
    throw new Error("unsupported_tab");
  }

  const response = await Messages.sendRuntime(MESSAGE_TYPES.OPEN_PANEL_IN_TAB, {
    tabId: state.activeTab.id,
    url: state.activeTab.url
  });

  if (!response?.ok) {
    throw new Error(response?.error || "open_panel_failed");
  }

  setNotice("Panel restored on the active page", "success");
}

async function openExternalTool() {
  const video = getPopupVideo();

  if (!video) {
    throw new Error("missing_video_url");
  }

  const response = await Messages.sendRuntime(MESSAGE_TYPES.OPEN_EXTERNAL_TOOL, {
    video,
    format: state.preferences.preferredFormat
  });

  if (!response?.ok) {
    throw new Error(response?.error || "external_tool_failed");
  }

  setNotice("External tool opened", "success");
}

async function resetTaskState() {
  const response = await Messages.sendRuntime(MESSAGE_TYPES.RESET_TASK_STATE);
  if (!response?.ok || !response.data) {
    throw new Error(response?.error || "task_reset_failed");
  }

  state.taskState = Storage.normalizeTaskState(response.data);
  render();
}

function handleInput(event) {
  const field = event.target.closest("[data-field]");
  if (!field) {
    return;
  }

  state.draftPreferences = {
    ...state.draftPreferences,
    [field.dataset.field]: field.value
  };
}

async function handleChange(event) {
  const select = event.target.closest("[data-select='musicPlaylist']");
  if (select) {
    const opt = select.options[select.selectedIndex];
    const id = select.value || "";
    const name = opt ? (opt.getAttribute("data-name") || opt.textContent || "").trim() : "";
    await savePlaylistPreference(id, name);
    return;
  }

  const toggle = event.target.closest("[data-toggle]");
  if (!toggle) {
    return;
  }
  await saveMusicPreference(toggle.dataset.toggle, !!toggle.checked);
}

async function savePlaylistPreference(id, name) {
  const next = { ...state.preferences, musicPlaylistId: id, musicPlaylistName: name };
  try {
    const response = await Messages.sendRuntime(MESSAGE_TYPES.SET_PREFERENCES, { preferences: next });
    state.preferences = Storage.normalizePreferences(response?.data || next);
  } catch (_) {
    state.preferences = Storage.normalizePreferences(next);
  }
  state.draftPreferences = { ...state.preferences };
  setNotice(name ? `Ziel-Playlist: ${name}` : "Ziel-Playlist gesetzt", "success");
}

async function saveMusicPreference(key, value) {
  const next = { ...state.preferences, [key]: value };
  try {
    const response = await Messages.sendRuntime(MESSAGE_TYPES.SET_PREFERENCES, { preferences: next });
    state.preferences = Storage.normalizePreferences(response?.data || next);
  } catch (_) {
    state.preferences = Storage.normalizePreferences(next);
  }
  state.draftPreferences = { ...state.preferences };
  if (key === "musicImportEnabled") {
    setNotice(value ? "Auto-Import in Apple Music: an" : "Auto-Import in Apple Music: aus", "success");
  } else {
    render();
  }
}

async function revealInMusic() {
  const chosen = getChosenPlaylist();
  let url;
  try {
    url = new URL("/api/reveal", state.preferences.localBridgeEndpoint);
    url.searchParams.set("playlist", chosen.name);
    if (chosen.id) url.searchParams.set("playlistId", chosen.id);
  } catch (_) {
    setNotice("Invalid bridge endpoint", "error");
    return;
  }

  try {
    const res = await fetch(url.toString());
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      setNotice("Opened in Apple Music", "success");
    } else if (data.error === "needs_permission") {
      setNotice("Allow Music automation (System Settings → Automation)", "error");
    } else {
      setNotice("Could not open Music", "error");
    }
  } catch (_) {
    state.bridgeOnline = false;
    setNotice("Bridge offline?", "error");
  }
}

function isBridgeOfflineError(error) {
  const m = String(error?.message || "").toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("fetch")
  );
}

function getReadableError(error) {
  const code = Storage.normalizeText(error?.message, "");
  if (code === "bridge_not_configured") {
    return Constants.DEFAULT_STRINGS.bridgeError;
  }
  if (code === "bridge_offline") {
    return "Bridge offline — start the WaveDrop bridge and try again.";
  }
  if (code === "task_already_running") {
    return "A task is already running.";
  }
  if (code === "unsupported_tab") {
    return "Open a YouTube watch page first.";
  }
  if (code === "missing_video_url") {
    return "Open a YouTube video first.";
  }
  if (code === "invalid_external_tool_url_template") {
    return "Use a valid external tool URL template.";
  }
  if (code === "external_tool_not_configured") {
    return "Enter an external tool URL template in Settings.";
  }
  if (code === "download_init_failed") {
    return "Could not start download — try again.";
  }
  return code || "Action unavailable right now.";
}

async function handleClick(event) {
  const action = event.target.closest("[data-action]");
  if (!action) {
    return;
  }

  /* Kickoff flash — synchronous, fires before any async work so the user gets
   * immediate tactile feedback the moment they click a download button.
   * The class is self-cleaning: render() regenerates the button HTML when the
   * task state changes, so there is no manual removal needed in the happy path.
   * The setTimeout is a safety net for cases where render() never fires
   * (e.g. an early validation bail-out). */
  if (action.dataset.action === "download-mp4" || action.dataset.action === "download-mp3") {
    action.classList.add("is-starting");
    window.setTimeout(() => action.classList.remove("is-starting"), 440);
  }

  try {
    switch (action.dataset.action) {
      case "download-mp4":
        await handleDownload(DOWNLOAD_FORMATS.MP4);
        break;
      case "download-mp3":
        await handleDownload(DOWNLOAD_FORMATS.MP3);
        break;
      case "open-panel":
        await openPanelOnPage();
        break;
      case "external":
        await openExternalTool();
        break;
      case "reveal-music":
        await revealInMusic();
        break;
      case "save-settings":
        await savePreferences();
        break;
      case "reset-task":
        await resetTaskState();
        break;
      default:
        break;
    }
  } catch (error) {
    handlePopupError(error);
  }
}

/**
 * Central error handler.
 * For bridge_not_configured it shows an actionable message, scrolls to the
 * settings section, and briefly highlights the endpoint input field.
 */
function handlePopupError(error) {
  const code = String(error?.message ?? "");

  if (code === "bridge_not_configured") {
    setNotice("Bridge not configured — enter your endpoint in Settings below.", "error");

    /* Scroll the settings section into view */
    window.setTimeout(() => {
      root.scrollTo({ top: root.scrollHeight, behavior: "smooth" });

      /* Shake + highlight the bridge endpoint input after scroll settles */
      window.setTimeout(() => {
        const input = root.querySelector("[data-field='localBridgeEndpoint']");
        if (!input) return;
        input.focus();
        input.classList.add("is-highlighted");
        input.addEventListener(
          "animationend",
          () => input.classList.remove("is-highlighted"),
          { once: true }
        );
      }, 340);
    }, 80);

    return;
  }

  setNotice(getReadableError(error), "error");
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.TASK_STATE]?.newValue) {
    state.taskState = Storage.normalizeTaskState(changes[STORAGE_KEYS.TASK_STATE].newValue);
    render();
  }

  if (changes[STORAGE_KEYS.PANEL_STATE]?.newValue) {
    state.panelState = Storage.normalizePanelState(changes[STORAGE_KEYS.PANEL_STATE].newValue);
  }

  if (changes[STORAGE_KEYS.PREFERENCES]?.newValue) {
    state.preferences = Storage.normalizePreferences(changes[STORAGE_KEYS.PREFERENCES].newValue);
    state.draftPreferences = { ...state.preferences };
    render();
  }

  if (changes[STORAGE_KEYS.ACTIVE_VIDEO]?.newValue) {
    state.activeVideo = changes[STORAGE_KEYS.ACTIVE_VIDEO].newValue;
    render();
  }
});
