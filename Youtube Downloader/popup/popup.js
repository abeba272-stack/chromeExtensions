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
  noticeTone: "info"
};

document.addEventListener("DOMContentLoaded", () => {
  initializePopup();
  root.addEventListener("click", handleClick);
  root.addEventListener("input", handleInput);
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
  return state.preferences.localBridgeEndpoint ? "Bridge ready" : "Bridge off";
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
            ${dlIcon}
            <span class="wd-popup-button-title">MP4</span>
            <span class="wd-popup-button-copy">Video + audio</span>
          </button>
          <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp3" data-action="download-mp3" disabled>
            ${dlIcon}
            <span class="wd-popup-button-title">MP3</span>
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
        <span class="wd-popup-badge">${escapeHtml(getStatusLabel(state.taskState))}</span>
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
        <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp4" data-action="download-mp4" ${busy ? "disabled" : ""}>
          ${dlIcon}
          <span class="wd-popup-button-title">MP4</span>
          <span class="wd-popup-button-copy">Video + audio</span>
        </button>
        <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp3" data-action="download-mp3" ${busy ? "disabled" : ""}>
          ${dlIcon}
          <span class="wd-popup-button-title">MP3</span>
          <span class="wd-popup-button-copy">Audio only</span>
        </button>
      </div>
      <div class="wd-popup-utility-row">
        <button class="wd-popup-button wd-popup-button-secondary" data-action="open-panel">Panel on page</button>
        <button class="wd-popup-button wd-popup-button-secondary" data-action="external" ${busy ? "disabled" : ""}>${extIcon} External tool</button>
      </div>
    </section>
  `;
}

function renderStatusSection() {
  const progress = Math.max(0, Math.min(100, Number(state.taskState.progress) || 0));
  const copy = state.taskState.error || state.taskState.message || "Ready";
  const activeFormat = (state.taskState.format || state.preferences.preferredFormat || DOWNLOAD_FORMATS.MP4).toUpperCase();
  const Icons = window.WaveDropIcons || {};
  const gearIcon = Icons.gear ? Icons.gear(12) : "";

  return `
    <section class="wd-popup-section">
      <div class="wd-popup-section-head">
        <span class="wd-popup-section-title">Status</span>
        <span class="wd-popup-progress-value">${escapeHtml(getStatusLabel(state.taskState))} &nbsp;${progress}%</span>
      </div>
      ${renderNotice()}
      <div class="wd-popup-progress-track" aria-label="Download progress ${progress}%">
        <span class="wd-popup-progress-fill" data-state="${escapeHtml(state.taskState.status)}" style="width:${progress}%"></span>
      </div>
      <div class="wd-popup-progress-head">
        <p class="wd-popup-status-copy">${escapeHtml(copy)}</p>
        <span class="wd-popup-badge">${escapeHtml(activeFormat)} &nbsp;·&nbsp; ${escapeHtml(getBridgeState())}</span>
      </div>
      <div class="wd-popup-section-head" style="margin-top:4px">
        <span class="wd-popup-section-title">${gearIcon} &nbsp;Bridge settings</span>
      </div>
      <div class="wd-popup-settings-grid">
        <label class="wd-popup-field">
          <span class="wd-popup-field-label">Bridge endpoint</span>
          <input class="wd-popup-input" data-field="localBridgeEndpoint" type="text" spellcheck="false" value="${escapeHtml(state.draftPreferences.localBridgeEndpoint)}" placeholder="http://127.0.0.1:4123/api/download" />
        </label>
        <label class="wd-popup-field">
          <span class="wd-popup-field-label">External tool URL template</span>
          <input class="wd-popup-input" data-field="externalToolUrlTemplate" type="text" spellcheck="false" value="${escapeHtml(state.draftPreferences.externalToolUrlTemplate)}" placeholder="https://example.com/?url={url}" />
        </label>
      </div>
      <div class="wd-popup-utility-row">
        <button class="wd-popup-button wd-popup-button-secondary" data-action="save-settings">Save</button>
        <button class="wd-popup-button wd-popup-button-secondary" data-action="reset-task">Clear status</button>
      </div>
      <p class="wd-popup-settings-note">Tokens: <code>{url}</code> <code>{title}</code> <code>{channel}</code> <code>{duration}</code> <code>{videoId}</code> <code>{format}</code>.</p>
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
    renderLoading();
    return;
  }

  root.innerHTML = `
    <div class="wd-popup-layout">
      ${renderDownloadSection()}
      ${renderStatusSection()}
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
    state.taskState = await persistTaskUpdate({
      status: TASK_STATUS.FAILED,
      progress: 0,
      message: Storage.normalizeText(err?.message, Constants.DEFAULT_STRINGS.failed),
      error: Storage.normalizeText(err?.message, "bridge_error")
    });
    render();
    throw err; // Surfaces to handleClick → handlePopupError
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
      await _finalizeDownload(video, format, downloadUrl, message);
      return;
    }

    state.taskState = await persistTaskUpdate({
      status: nextStatus,
      progress,
      message,
      error: ""
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
async function _finalizeDownload(video, format, downloadUrl, bridgeMessage) {
  let browserDownloadId = null;
  let downloadError = "";

  try {
    browserDownloadId = await chrome.downloads.download({
      url: downloadUrl,
      filename: createPopupDownloadFilename(video, format),
      saveAs: false
    });
  } catch (dlErr) {
    downloadError = Storage.normalizeText(dlErr?.message, "browser_download_failed");
    setNotice("File ready but browser download failed — try again.", "error");
  }

  state.taskState = await persistTaskUpdate({
    status: downloadError ? TASK_STATUS.FAILED : TASK_STATUS.COMPLETE,
    progress: downloadError ? 0 : 100,
    message: downloadError || bridgeMessage || Constants.DEFAULT_STRINGS.complete,
    error: downloadError,
    browserDownloadId
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

function getReadableError(error) {
  const code = Storage.normalizeText(error?.message, "");
  if (code === "bridge_not_configured") {
    return Constants.DEFAULT_STRINGS.bridgeError;
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
  return code || "Action unavailable right now.";
}

async function handleClick(event) {
  const action = event.target.closest("[data-action]");
  if (!action) {
    return;
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
