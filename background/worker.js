importScripts("../shared/constants.js", "../shared/messages.js", "../shared/storage.js", "./providers.js");

const Constants = self.WaveDropConstants;
const Storage = self.WaveDropStorage;
const Providers = self.WaveDropProviders;
const {
  STORAGE_KEYS,
  MESSAGE_TYPES,
  PANEL_MODES,
  TASK_STATUS,
  DOWNLOAD_FORMATS,
  DEFAULT_STRINGS
} = Constants;

let currentTaskRunId = "";

async function initializeStorage() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const nextValues = {};

  if (!stored[STORAGE_KEYS.ACTIVE_VIDEO] || typeof stored[STORAGE_KEYS.ACTIVE_VIDEO] !== "object") {
    nextValues[STORAGE_KEYS.ACTIVE_VIDEO] = null;
  }

  if (!stored[STORAGE_KEYS.PANEL_STATE] || typeof stored[STORAGE_KEYS.PANEL_STATE] !== "object") {
    nextValues[STORAGE_KEYS.PANEL_STATE] = Storage.createDefaultPanelState();
  }

  if (!stored[STORAGE_KEYS.PREFERENCES] || typeof stored[STORAGE_KEYS.PREFERENCES] !== "object") {
    nextValues[STORAGE_KEYS.PREFERENCES] = Storage.createDefaultPreferences();
  }

  if (!stored[STORAGE_KEYS.TASK_STATE] || typeof stored[STORAGE_KEYS.TASK_STATE] !== "object") {
    nextValues[STORAGE_KEYS.TASK_STATE] = Storage.createDefaultTaskState();
  }

  if (Object.keys(nextValues).length > 0) {
    await chrome.storage.local.set(nextValues);
  }
}

async function getAppState() {
  await initializeStorage();
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));

  return {
    activeVideo: stored[STORAGE_KEYS.ACTIVE_VIDEO]
      ? Storage.normalizeVideo(stored[STORAGE_KEYS.ACTIVE_VIDEO])
      : null,
    panelState: Storage.normalizePanelState(stored[STORAGE_KEYS.PANEL_STATE]),
    preferences: Storage.normalizePreferences(stored[STORAGE_KEYS.PREFERENCES]),
    taskState: Storage.normalizeTaskState(stored[STORAGE_KEYS.TASK_STATE])
  };
}

async function setPanelState(panelState) {
  const normalized = Storage.normalizePanelState(panelState);
  await chrome.storage.local.set({ [STORAGE_KEYS.PANEL_STATE]: normalized });
  return normalized;
}

async function setPreferences(preferences) {
  const normalized = Storage.normalizePreferences(preferences);
  await chrome.storage.local.set({ [STORAGE_KEYS.PREFERENCES]: normalized });
  return normalized;
}

async function setActiveVideo(video) {
  const normalized = Storage.normalizeVideo(video);
  if (!normalized.url) {
    return null;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_VIDEO]: normalized });
  return normalized;
}

async function resetTaskState() {
  const nextState = {
    ...Storage.createDefaultTaskState(),
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.TASK_STATE]: nextState });
  return nextState;
}

async function updateTaskState(partial) {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.TASK_STATE]);
  const currentState = Storage.normalizeTaskState(stored[STORAGE_KEYS.TASK_STATE]);
  const nextState = Storage.normalizeTaskState({
    ...currentState,
    ...partial,
    updatedAt: new Date().toISOString()
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.TASK_STATE]: nextState });
  return nextState;
}

function isSupportedYouTubeUrl(urlValue = "") {
  try {
    const parsed = new URL(urlValue);
    return /(^|\.)youtube\.com$/i.test(parsed.hostname) && !!Storage.extractVideoIdFromUrl(urlValue);
  } catch (error) {
    return false;
  }
}

async function ensureInjectedIntoTab(tabId, urlValue = "") {
  if (!tabId || !isSupportedYouTubeUrl(urlValue)) {
    return false;
  }

  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.PING });
    if (ping?.ok) {
      return true;
    }
  } catch (error) {
    // Try a fresh script injection below.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "shared/constants.js",
        "shared/messages.js",
        "shared/storage.js",
        "content/panel.js",
        "content/injector.js"
      ]
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function openPanelInTab(tabId, urlValue) {
  const injected = await ensureInjectedIntoTab(tabId, urlValue);
  if (!injected) {
    throw new Error("unsupported_tab");
  }

  const panelState = await setPanelState({
    ...Storage.createDefaultPanelState(),
    mode: PANEL_MODES.OPEN
  });

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.RESTORE_PANEL,
      panelState
    });
  } catch (error) {
    // The content script will pull the state from storage on its own refresh path.
  }

  return panelState;
}

async function launchBrowserDownload(downloadUrl, video, format) {
  if (!downloadUrl) {
    return null;
  }

  return chrome.downloads.download({
    url: downloadUrl,
    filename: Providers.createDownloadFilename(video, format),
    saveAs: false
  });
}

async function runDownloadTask(taskId, video, format, preferences) {
  try {
    await Providers.runLocalBridgeTask({
      video,
      format,
      preferences,
      onProgress: async (partial) => {
        if (currentTaskRunId !== taskId) {
          return;
        }
        await updateTaskState(partial);
      },
      onComplete: async (payload) => {
        if (currentTaskRunId !== taskId) {
          return null;
        }

        const browserDownloadId = payload.downloadUrl
          ? await launchBrowserDownload(payload.downloadUrl, video, format)
          : null;

        return updateTaskState({
          status: TASK_STATUS.COMPLETE,
          progress: 100,
          message: payload.message || DEFAULT_STRINGS.complete,
          error: "",
          browserDownloadId
        });
      }
    });
  } catch (error) {
    if (currentTaskRunId !== taskId) {
      return;
    }

    await updateTaskState({
      status: TASK_STATUS.FAILED,
      progress: 0,
      message: Storage.normalizeText(error?.message, DEFAULT_STRINGS.failed),
      error: Storage.normalizeText(error?.message, "download_failed")
    });
  }
}

async function startDownload(video, format) {
  const normalizedVideo = Storage.normalizeVideo(video);
  if (!normalizedVideo.url) {
    throw new Error("missing_video_url");
  }

  const { preferences, taskState } = await getAppState();
  if (Storage.isBusyTask(taskState)) {
    throw new Error("task_already_running");
  }

  const formatLabel = format === DOWNLOAD_FORMATS.MP3 ? DEFAULT_STRINGS.preparingMp3 : DEFAULT_STRINGS.preparingMp4;
  const taskId = Storage.createTaskId();
  currentTaskRunId = taskId;

  const nextPreferences = {
    ...preferences,
    preferredFormat: format
  };
  await setPreferences(nextPreferences);

  const nextTaskState = await updateTaskState({
    id: taskId,
    status: TASK_STATUS.PENDING,
    progress: 4,
    format,
    message: formatLabel,
    error: "",
    provider: "localBridge",
    videoTitle: normalizedVideo.title,
    browserDownloadId: null
  });

  void runDownloadTask(taskId, normalizedVideo, format, nextPreferences);
  return nextTaskState;
}

async function openExternalTool(video, format) {
  const normalizedVideo = Storage.normalizeVideo(video);
  if (!normalizedVideo.url) {
    throw new Error("missing_video_url");
  }

  const { preferences } = await getAppState();
  const url = Providers.buildExternalToolUrl(normalizedVideo, preferences, format || preferences.preferredFormat);
  await chrome.tabs.create({ url, active: true });
  return { url };
}

chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
  const tabs = await chrome.tabs.query({
    url: [
      "https://www.youtube.com/*",
      "https://m.youtube.com/*",
      "https://music.youtube.com/*"
    ]
  });

  await Promise.allSettled(
    tabs.map((tab) => ensureInjectedIntoTab(tab.id, tab.url))
  );
});

chrome.runtime.onStartup.addListener(() => {
  void initializeStorage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case MESSAGE_TYPES.GET_APP_STATE:
        sendResponse({ ok: true, data: await getAppState() });
        return;

      case MESSAGE_TYPES.SET_ACTIVE_VIDEO:
        sendResponse({ ok: true, data: await setActiveVideo(message.video) });
        return;

      case MESSAGE_TYPES.SET_PANEL_STATE:
        sendResponse({ ok: true, data: await setPanelState(message.panelState) });
        return;

      case MESSAGE_TYPES.RESET_PANEL:
      case MESSAGE_TYPES.RESTORE_PANEL:
        sendResponse({
          ok: true,
          data: await setPanelState(Storage.createDefaultPanelState())
        });
        return;

      case MESSAGE_TYPES.SET_PREFERENCES:
        sendResponse({ ok: true, data: await setPreferences(message.preferences) });
        return;

      case MESSAGE_TYPES.START_DOWNLOAD:
        sendResponse({ ok: true, data: await startDownload(message.video, message.format) });
        return;

      case MESSAGE_TYPES.OPEN_EXTERNAL_TOOL:
        sendResponse({ ok: true, data: await openExternalTool(message.video, message.format) });
        return;

      case MESSAGE_TYPES.RESET_TASK_STATE:
        currentTaskRunId = "";
        sendResponse({ ok: true, data: await resetTaskState() });
        return;

      case MESSAGE_TYPES.OPEN_PANEL_IN_TAB:
        sendResponse({
          ok: true,
          data: await openPanelInTab(message.tabId, message.url)
        });
        return;

      case MESSAGE_TYPES.ENSURE_INJECTION:
        sendResponse({
          ok: true,
          data: await ensureInjectedIntoTab(message.tabId, message.url)
        });
        return;

      default:
        sendResponse({ ok: false, error: "unknown_message_type" });
    }
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: Storage.normalizeText(error?.message, "unexpected_error")
    });
  });

  return true;
});
