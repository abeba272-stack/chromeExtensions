const Constants = window.WaveDropConstants;
const Messages = window.WaveDropMessages;
const Storage = window.WaveDropStorage;
const {
  MESSAGE_TYPES,
  STORAGE_KEYS,
  DOWNLOAD_FORMATS,
  TASK_STATUS,
  BRAND_TITLE,
  BRAND_SUBTITLE,
  DECORATIVE_MARK
} = Constants;

const root = document.getElementById("wd-popup-root");
const cartonUrl = chrome.runtime.getURL("assets/juice-carton.svg");

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

  return `<div class="wd-banner wd-banner-${escapeHtml(state.noticeTone)}">${escapeHtml(state.notice)}</div>`;
}

function renderSummaryCard() {
  if (!state.activeVideo) {
    return `
      <section class="wd-section-card wd-empty-card">
        <span class="wd-overline">Inactive tab</span>
        <h2 class="wd-empty-title">Open a YouTube video</h2>
        <p class="wd-empty-copy">The floating panel appears on watch pages and keeps this popup aligned with the live task state.</p>
      </section>
    `;
  }

  return `
    <section class="wd-section-card wd-video-card wd-video-card-popup">
      <div class="wd-video-frame wd-video-frame-popup">
        <img class="wd-video-thumb" src="${escapeHtml(state.activeVideo.thumbnail)}" alt="${escapeHtml(state.activeVideo.title)} thumbnail" />
      </div>
      <div class="wd-video-copy">
        <span class="wd-overline">Current video</span>
        <h2 class="wd-video-title" title="${escapeHtml(state.activeVideo.title)}">${escapeHtml(state.activeVideo.title)}</h2>
        <div class="wd-video-meta-row">
          <span class="wd-video-meta">${escapeHtml(state.activeVideo.channelName)}</span>
          <span class="wd-meta-dot"></span>
          <span class="wd-video-meta">${escapeHtml(state.activeVideo.duration)}</span>
        </div>
        <div class="wd-status-inline">
          <span class="wd-status-pill wd-status-pill-${escapeHtml(state.taskState.status)}">${escapeHtml(getStatusLabel(state.taskState))}</span>
        </div>
      </div>
    </section>
  `;
}

function renderActionCard() {
  const busy = Storage.isBusyTask(state.taskState);

  return `
    <section class="wd-section-card wd-actions-card wd-actions-card-popup">
      <div class="wd-primary-actions wd-primary-actions-popup">
        <button class="wd-primary-button wd-primary-button-video" data-action="download-mp4" ${busy || !state.activeVideo ? "disabled" : ""}>
          <span class="wd-button-label">Download MP4</span>
          <span class="wd-button-sub">Bridge task</span>
        </button>
        <button class="wd-primary-button wd-primary-button-audio" data-action="download-mp3" ${busy || !state.activeVideo ? "disabled" : ""}>
          <span class="wd-button-label">Download MP3</span>
          <span class="wd-button-sub">Bridge task</span>
        </button>
      </div>
      <div class="wd-secondary-actions">
        <button class="wd-secondary-button" data-action="open-panel" ${state.onYouTube ? "" : "disabled"}>Open panel on page</button>
        <button class="wd-secondary-button" data-action="external" ${!state.activeVideo ? "disabled" : ""}>Open External Tool</button>
      </div>
    </section>
  `;
}

function renderStatusCard() {
  const progress = Math.max(0, Math.min(100, Number(state.taskState.progress) || 0));
  const copy = state.taskState.error || state.taskState.message || "Ready";

  return `
    <section class="wd-section-card wd-status-card">
      <div class="wd-status-head">
        <div>
          <span class="wd-overline">Task state</span>
          <h3 class="wd-section-title">${escapeHtml(getStatusLabel(state.taskState))}</h3>
        </div>
        <span class="wd-progress-value">${progress}%</span>
      </div>
      <div class="wd-progress-track" aria-hidden="true">
        <span class="wd-progress-fill wd-status-${escapeHtml(state.taskState.status)}" style="width:${progress}%"></span>
      </div>
      <p class="wd-status-copy">${escapeHtml(copy)}</p>
    </section>
  `;
}

function renderProviderCard() {
  return `
    <section class="wd-section-card wd-settings-card">
      <div class="wd-card-head">
        <div>
          <span class="wd-overline">Provider</span>
          <h3 class="wd-section-title">${escapeHtml(getBridgeState())}</h3>
        </div>
        <span class="wd-mini-pill">${escapeHtml(state.preferences.preferredFormat.toUpperCase() || "MP4")}</span>
      </div>
      <div class="wd-field-grid">
        <label class="wd-field-label">
          <span>Local bridge endpoint</span>
          <input class="wd-input" data-field="localBridgeEndpoint" type="text" spellcheck="false" value="${escapeHtml(state.draftPreferences.localBridgeEndpoint)}" placeholder="http://127.0.0.1:4123/api/download" />
        </label>
        <label class="wd-field-label">
          <span>External tool URL</span>
          <input class="wd-input" data-field="externalToolUrlTemplate" type="text" spellcheck="false" value="${escapeHtml(state.draftPreferences.externalToolUrlTemplate)}" placeholder="https://example.com/import?url={url}" />
        </label>
      </div>
      <div class="wd-secondary-actions">
        <button class="wd-secondary-button" data-action="save-settings">Save settings</button>
        <button class="wd-secondary-button" data-action="reset-task">Clear status</button>
      </div>
      <p class="wd-settings-note">Tokens: <code>{url}</code> <code>{title}</code> <code>{channel}</code> <code>{duration}</code> <code>{videoId}</code> <code>{format}</code>.</p>
    </section>
  `;
}

function renderAtmosphereCard() {
  return `
    <section class="wd-section-card wd-atmosphere-card wd-atmosphere-card-popup">
      <div class="wd-atmosphere-copy">
        <span class="wd-ornament-title">${escapeHtml(BRAND_SUBTITLE)}</span>
        <div class="wd-waveform" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
      </div>
      <div class="wd-atmosphere-art" aria-hidden="true">
        <div class="wd-nine-nine-nine">${escapeHtml(DECORATIVE_MARK)}</div>
        <img class="wd-carton-symbol" src="${escapeHtml(cartonUrl)}" alt="" />
      </div>
    </section>
  `;
}

function renderLoading() {
  root.innerHTML = `
    <div class="wd-shell-body wd-popup-shell-body">
      <section class="wd-section-card wd-skeleton-card">
        <div class="wd-skeleton wd-skeleton-heading"></div>
        <div class="wd-skeleton wd-skeleton-block"></div>
      </section>
      <section class="wd-section-card wd-skeleton-card">
        <div class="wd-skeleton wd-skeleton-line"></div>
        <div class="wd-skeleton wd-skeleton-line"></div>
        <div class="wd-skeleton wd-skeleton-line wd-skeleton-line-short"></div>
      </section>
    </div>
  `;
}

function render() {
  if (state.loading) {
    renderLoading();
    return;
  }

  root.innerHTML = `
    <div class="wd-shell-body wd-popup-shell-body">
      ${renderNotice()}
      ${renderSummaryCard()}
      ${renderActionCard()}
      ${renderStatusCard()}
      ${renderProviderCard()}
      ${renderAtmosphereCard()}
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
  if (!state.activeVideo) {
    setNotice("Open a YouTube video first", "error");
    return;
  }

  const response = await Messages.sendRuntime(MESSAGE_TYPES.START_DOWNLOAD, {
    video: state.activeVideo,
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
  if (!state.activeVideo) {
    throw new Error("missing_video_url");
  }

  const response = await Messages.sendRuntime(MESSAGE_TYPES.OPEN_EXTERNAL_TOOL, {
    video: state.activeVideo,
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

  if (changes[STORAGE_KEYS.ACTIVE_VIDEO]?.newValue && !state.onYouTube) {
    state.activeVideo = changes[STORAGE_KEYS.ACTIVE_VIDEO].newValue;
    render();
  }
});
