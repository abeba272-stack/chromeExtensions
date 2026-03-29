const LIBRARY_KEY = "wavedropLibrary";
const ACTIVE_VIDEO_KEY = "wavedropActiveVideo";
const UI_STATE_KEY = "wavedropUiState";
const PREFERENCES_KEY = "wavedropPreferences";

const DEFAULT_UI_STATE = Object.freeze({
  mode: "open",
  position: {
    anchored: true,
    top: 18,
    left: 18
  }
});

const DEFAULT_PREFERENCES = Object.freeze({
  externalToolUrlTemplate: "https://www.google.com/search?q={title}%20{channel}%20{url}"
});

const TEMPLATE_TEST_VIDEO = Object.freeze({
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "WaveDrop Test Video",
  channelName: "WaveDrop",
  duration: "3:33",
  videoId: "dQw4w9WgXcQ",
  thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
});

function createDefaultUiState() {
  return {
    mode: DEFAULT_UI_STATE.mode,
    position: {
      anchored: DEFAULT_UI_STATE.position.anchored,
      top: DEFAULT_UI_STATE.position.top,
      left: DEFAULT_UI_STATE.position.left
    }
  };
}

function createDefaultPreferences() {
  return {
    externalToolUrlTemplate: DEFAULT_PREFERENCES.externalToolUrlTemplate
  };
}

function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

function sanitizeNumber(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.round(parsed));
}

function normalizePanelMode(value) {
  return ["open", "minimized", "closed"].includes(value) ? value : "open";
}

function normalizeUiState(value = {}) {
  const position = value?.position || {};

  return {
    mode: normalizePanelMode(value?.mode),
    position: {
      anchored: position.anchored !== false,
      top: sanitizeNumber(position.top, DEFAULT_UI_STATE.position.top),
      left: sanitizeNumber(position.left, DEFAULT_UI_STATE.position.left)
    }
  };
}

function normalizePreferences(value = {}) {
  return {
    externalToolUrlTemplate: normalizeText(
      value?.externalToolUrlTemplate,
      DEFAULT_PREFERENCES.externalToolUrlTemplate
    )
  };
}

function extractVideoIdFromUrl(urlValue = "") {
  try {
    const parsed = new URL(urlValue);

    if (parsed.pathname === "/watch") {
      return parsed.searchParams.get("v") || "";
    }

    if (parsed.pathname.startsWith("/shorts/")) {
      return parsed.pathname.split("/shorts/")[1]?.split("/")[0] || "";
    }

    return "";
  } catch (error) {
    return "";
  }
}

function isSupportedYouTubeUrl(urlValue = "") {
  try {
    const parsed = new URL(urlValue);
    return /(^|\.)youtube\.com$/i.test(parsed.hostname) && !!extractVideoIdFromUrl(urlValue);
  } catch (error) {
    return false;
  }
}

function createTemplateTokenMap(video) {
  return {
    url: normalizeText(video.url),
    title: normalizeText(video.title),
    channel: normalizeText(video.channelName),
    duration: normalizeText(video.duration),
    videoId: normalizeText(video.videoId),
    thumbnail: normalizeText(video.thumbnail)
  };
}

function hydrateExternalToolTemplate(template, video) {
  const tokenMap = createTemplateTokenMap(video);

  return String(template || "").replace(
    /\{(url|title|channel|duration|videoId|thumbnail)\}/g,
    (match, token) => encodeURIComponent(tokenMap[token] || "")
  );
}

function validateExternalToolUrl(urlValue) {
  const parsed = new URL(urlValue);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("invalid_external_tool_url_template");
  }

  return parsed.toString();
}

function validateExternalToolTemplate(template) {
  return validateExternalToolUrl(hydrateExternalToolTemplate(template, TEMPLATE_TEST_VIDEO));
}

function normalizeVideo(video = {}) {
  const url = normalizeText(video.url);
  const videoId = normalizeText(video.videoId) || extractVideoIdFromUrl(url);

  return {
    videoId,
    title: normalizeText(video.title, "Untitled video"),
    channelName: normalizeText(video.channelName, "Unknown channel"),
    thumbnail: normalizeText(video.thumbnail),
    duration: normalizeText(video.duration, "Unknown duration"),
    url,
    savedAt: normalizeText(video.savedAt)
  };
}

async function initializeStorage() {
  const stored = await chrome.storage.local.get([
    LIBRARY_KEY,
    UI_STATE_KEY,
    PREFERENCES_KEY
  ]);
  const nextValues = {};

  if (!Array.isArray(stored[LIBRARY_KEY])) {
    nextValues[LIBRARY_KEY] = [];
  }

  if (!stored[UI_STATE_KEY] || typeof stored[UI_STATE_KEY] !== "object") {
    nextValues[UI_STATE_KEY] = createDefaultUiState();
  }

  if (!stored[PREFERENCES_KEY] || typeof stored[PREFERENCES_KEY] !== "object") {
    nextValues[PREFERENCES_KEY] = createDefaultPreferences();
  }

  if (Object.keys(nextValues).length > 0) {
    await chrome.storage.local.set(nextValues);
  }
}

async function ensureWaveDropInjected(tabId, urlValue = "") {
  if (!tabId || !isSupportedYouTubeUrl(urlValue)) {
    return false;
  }

  try {
    const pingResponse = await chrome.tabs.sendMessage(tabId, {
      type: "WAVEDROP_PING"
    });

    if (pingResponse?.ok) {
      return true;
    }
  } catch (error) {
    // Ignore lookup failures and try a direct injection.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function getLibrary() {
  await initializeStorage();
  const stored = await chrome.storage.local.get([LIBRARY_KEY]);
  return Array.isArray(stored[LIBRARY_KEY]) ? stored[LIBRARY_KEY] : [];
}

async function getUiState() {
  await initializeStorage();
  const stored = await chrome.storage.local.get([UI_STATE_KEY]);
  return normalizeUiState(stored[UI_STATE_KEY]);
}

async function getPreferences() {
  await initializeStorage();
  const stored = await chrome.storage.local.get([PREFERENCES_KEY]);
  return normalizePreferences(stored[PREFERENCES_KEY]);
}

async function getState() {
  await initializeStorage();
  const stored = await chrome.storage.local.get([
    LIBRARY_KEY,
    ACTIVE_VIDEO_KEY,
    UI_STATE_KEY,
    PREFERENCES_KEY
  ]);

  return {
    library: Array.isArray(stored[LIBRARY_KEY]) ? stored[LIBRARY_KEY] : [],
    activeVideo: stored[ACTIVE_VIDEO_KEY] || null,
    uiState: normalizeUiState(stored[UI_STATE_KEY]),
    preferences: normalizePreferences(stored[PREFERENCES_KEY])
  };
}

async function setActiveVideo(video) {
  const normalized = normalizeVideo(video);

  if (!normalized.url) {
    return null;
  }

  await chrome.storage.local.set({ [ACTIVE_VIDEO_KEY]: normalized });
  return normalized;
}

async function setUiState(uiState) {
  const normalized = normalizeUiState(uiState);
  await chrome.storage.local.set({ [UI_STATE_KEY]: normalized });
  return normalized;
}

async function setPreferences(preferences) {
  const normalized = normalizePreferences(preferences);
  validateExternalToolTemplate(normalized.externalToolUrlTemplate);
  await chrome.storage.local.set({ [PREFERENCES_KEY]: normalized });
  return normalized;
}

async function saveVideo(video) {
  const normalized = normalizeVideo(video);

  if (!normalized.url) {
    throw new Error("missing_video_url");
  }

  const library = await getLibrary();
  const existingIndex = library.findIndex(
    (entry) =>
      (normalized.videoId && entry.videoId === normalized.videoId) ||
      entry.url === normalized.url
  );

  const savedAt =
    existingIndex >= 0 ? library[existingIndex].savedAt : new Date().toISOString();
  const nextVideo = {
    ...normalized,
    savedAt
  };

  const nextLibrary =
    existingIndex >= 0
      ? [nextVideo, ...library.filter((_, index) => index !== existingIndex)]
      : [nextVideo, ...library];

  await chrome.storage.local.set({
    [LIBRARY_KEY]: nextLibrary,
    [ACTIVE_VIDEO_KEY]: nextVideo
  });

  return {
    video: nextVideo,
    library: nextLibrary,
    alreadySaved: existingIndex >= 0
  };
}

async function removeVideo(videoId, url) {
  const library = await getLibrary();
  const nextLibrary = library.filter((entry) => {
    if (videoId && entry.videoId === videoId) {
      return false;
    }

    if (url && entry.url === url) {
      return false;
    }

    return true;
  });

  await chrome.storage.local.set({ [LIBRARY_KEY]: nextLibrary });
  return nextLibrary;
}

function buildExternalToolUrl(video, preferences) {
  if (!video.url) {
    throw new Error("missing_video_url");
  }

  const normalizedPreferences = normalizePreferences(preferences);
  const hydratedUrl = hydrateExternalToolTemplate(
    normalizedPreferences.externalToolUrlTemplate,
    video
  );

  return validateExternalToolUrl(hydratedUrl);
}

chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();

  const tabs = await chrome.tabs.query({
    url: ["https://www.youtube.com/*", "https://m.youtube.com/*", "https://music.youtube.com/*"]
  });

  await Promise.allSettled(
    tabs.map((tab) => ensureWaveDropInjected(tab.id, tab.url))
  );
});

chrome.runtime.onStartup.addListener(() => {
  void initializeStorage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "WAVEDROP_ENSURE_INJECTION": {
        sendResponse({
          ok: true,
          data: await ensureWaveDropInjected(message.tabId, message.url)
        });
        return;
      }

      case "WAVEDROP_GET_STATE": {
        sendResponse({ ok: true, data: await getState() });
        return;
      }

      case "WAVEDROP_SET_ACTIVE_VIDEO": {
        sendResponse({
          ok: true,
          data: await setActiveVideo(message.video)
        });
        return;
      }

      case "WAVEDROP_SET_UI_STATE": {
        sendResponse({
          ok: true,
          data: await setUiState(message.uiState)
        });
        return;
      }

      case "WAVEDROP_SET_PREFERENCES": {
        sendResponse({
          ok: true,
          data: await setPreferences(message.preferences)
        });
        return;
      }

      case "WAVEDROP_SAVE_VIDEO": {
        sendResponse({
          ok: true,
          data: await saveVideo(message.video)
        });
        return;
      }

      case "WAVEDROP_REMOVE_VIDEO": {
        sendResponse({
          ok: true,
          data: {
            library: await removeVideo(message.videoId, message.url)
          }
        });
        return;
      }

      case "WAVEDROP_OPEN_EXTERNAL_TOOL": {
        const video = normalizeVideo(message.video);
        const preferences = await getPreferences();
        const url = buildExternalToolUrl(video, preferences);

        await chrome.tabs.create({
          url,
          active: true
        });

        sendResponse({
          ok: true,
          data: { url }
        });
        return;
      }

      default: {
        sendResponse({
          ok: false,
          error: "unknown_message_type"
        });
      }
    }
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error?.message || "unexpected_error"
    });
  });

  return true;
});
