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
});

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

  if (!video) {
    return `
      <section class="wd-popup-section">
        <div class="wd-popup-section-head">
          <div>
            <span class="wd-popup-label">Download controls</span>
            <h2 class="wd-popup-section-title">Open a YouTube video</h2>
          </div>
          <span class="wd-popup-badge">Unavailable</span>
        </div>
        <div class="wd-popup-video-block">
          <div class="wd-popup-video-frame wd-popup-video-frame-empty">No source</div>
          <div class="wd-popup-video-copy">
            <p class="wd-popup-video-title">WaveDrop activates on YouTube watch pages.</p>
            <p class="wd-popup-video-meta wd-popup-empty-copy">Open a video tab to unlock MP3, MP4, and page actions from this popup.</p>
          </div>
        </div>
        <div class="wd-popup-download-grid">
          <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp4" data-action="download-mp4" disabled>
            <span class="wd-popup-button-title">Download MP4</span>
            <span class="wd-popup-button-copy">Requires an active YouTube video.</span>
          </button>
          <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp3" data-action="download-mp3" disabled>
            <span class="wd-popup-button-title">Download MP3</span>
            <span class="wd-popup-button-copy">Requires an active YouTube video.</span>
          </button>
        </div>
        <div class="wd-popup-utility-row">
          <button class="wd-popup-button wd-popup-button-secondary" data-action="open-panel" ${state.onYouTube ? "" : "disabled"}>Open panel on page</button>
          <button class="wd-popup-button wd-popup-button-secondary" data-action="external" disabled>Open external tool</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="wd-popup-section">
      <div class="wd-popup-section-head">
        <div>
          <span class="wd-popup-label">Download controls</span>
          <h2 class="wd-popup-section-title">Current video</h2>
        </div>
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
          <p class="wd-popup-note">Use the bridge workflow for MP3 or MP4, or hand the active tab off to an external tool.</p>
        </div>
      </div>
      <div class="wd-popup-download-grid">
        <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp4" data-action="download-mp4" ${busy ? "disabled" : ""}>
          <span class="wd-popup-button-title">Download MP4</span>
          <span class="wd-popup-button-copy">Video with audio</span>
        </button>
        <button class="wd-popup-button wd-popup-button-download wd-popup-button-download-mp3" data-action="download-mp3" ${busy ? "disabled" : ""}>
          <span class="wd-popup-button-title">Download MP3</span>
          <span class="wd-popup-button-copy">Audio only</span>
        </button>
      </div>
      <div class="wd-popup-utility-row">
        <button class="wd-popup-button wd-popup-button-secondary" data-action="open-panel">Open panel on page</button>
        <button class="wd-popup-button wd-popup-button-secondary" data-action="external" ${busy ? "disabled" : ""}>Open external tool</button>
      </div>
    </section>
  `;
}

function renderStatusSection() {
  const progress = Math.max(0, Math.min(100, Number(state.taskState.progress) || 0));
  const copy = state.taskState.error || state.taskState.message || "Ready";
  const activeFormat = (state.taskState.format || state.preferences.preferredFormat || DOWNLOAD_FORMATS.MP4).toUpperCase();

  return `
    <section class="wd-popup-section">
      <div class="wd-popup-section-head">
        <div>
          <span class="wd-popup-label">Status and feedback</span>
          <h3 class="wd-popup-section-title">${escapeHtml(getStatusLabel(state.taskState))}</h3>
        </div>
        <span class="wd-popup-progress-value">${progress}%</span>
      </div>
      ${renderNotice()}
      <div class="wd-popup-progress-head">
        <p class="wd-popup-section-copy">${escapeHtml(getBridgeState())}</p>
        <span class="wd-popup-badge">${escapeHtml(activeFormat)}</span>
      </div>
      <div class="wd-popup-progress-track" aria-hidden="true">
        <span class="wd-popup-progress-fill" data-state="${escapeHtml(state.taskState.status)}" style="width:${progress}%"></span>
      </div>
      <p class="wd-popup-status-copy">${escapeHtml(copy)}</p>
      <div class="wd-popup-settings-grid">
        <label class="wd-popup-field">
          <span class="wd-popup-field-label">Local bridge endpoint</span>
          <input class="wd-popup-input" data-field="localBridgeEndpoint" type="text" spellcheck="false" value="${escapeHtml(state.draftPreferences.localBridgeEndpoint)}" placeholder="http://127.0.0.1:4123/api/download" />
        </label>
        <label class="wd-popup-field">
          <span class="wd-popup-field-label">External tool URL</span>
          <input class="wd-popup-input" data-field="externalToolUrlTemplate" type="text" spellcheck="false" value="${escapeHtml(state.draftPreferences.externalToolUrlTemplate)}" placeholder="https://example.com/import?url={url}" />
        </label>
      </div>
      <div class="wd-popup-utility-row">
        <button class="wd-popup-button wd-popup-button-secondary" data-action="save-settings">Save settings</button>
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

async function handleDownload(format) {
  const video = getPopupVideo();

  if (!video) {
    setNotice("Open a YouTube video first", "error");
    return;
  }

  const response = await Messages.sendRuntime(MESSAGE_TYPES.START_DOWNLOAD, {
    video,
    format
  });

  if (!response?.ok || !response.data) {
    throw new Error(response?.error || "download_start_failed");
  }

  state.taskState = Storage.normalizeTaskState(response.data);
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
    setNotice(getReadableError(error), "error");
  }
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
