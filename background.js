const LIBRARY_KEY = "wavedropLibrary";
const ACTIVE_VIDEO_KEY = "wavedropActiveVideo";
const EXTERNAL_TOOL_BASE_URL = "https://www.google.com/search?q=";

function isSupportedYouTubeUrl(urlValue = "") {
  try {
    const parsed = new URL(urlValue);

    return (
      /(^|\.)youtube\.com$/i.test(parsed.hostname) &&
      parsed.pathname === "/watch" &&
      !!parsed.searchParams.get("v")
    );
  } catch (error) {
    return false;
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

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get([LIBRARY_KEY]);

  if (!Array.isArray(stored[LIBRARY_KEY])) {
    await chrome.storage.local.set({ [LIBRARY_KEY]: [] });
  }

  const tabs = await chrome.tabs.query({
    url: ["https://www.youtube.com/*", "https://m.youtube.com/*"]
  });

  await Promise.all(tabs.map((tab) => ensureWaveDropInjected(tab.id, tab.url)));
});

function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

function extractVideoId(urlValue) {
  try {
    const parsed = new URL(urlValue);
    return parsed.searchParams.get("v") || "";
  } catch (error) {
    return "";
  }
}

function normalizeVideo(video = {}) {
  const url = normalizeText(video.url);
  const videoId = normalizeText(video.videoId) || extractVideoId(url);

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

function buildExternalToolUrl(video) {
  const query = [video.title, video.channelName, video.url].filter(Boolean).join(" ");
  return `${EXTERNAL_TOOL_BASE_URL}${encodeURIComponent(query)}`;
}

async function getLibrary() {
  const stored = await chrome.storage.local.get([LIBRARY_KEY]);
  return Array.isArray(stored[LIBRARY_KEY]) ? stored[LIBRARY_KEY] : [];
}

async function getState() {
  const stored = await chrome.storage.local.get([LIBRARY_KEY, ACTIVE_VIDEO_KEY]);

  return {
    library: Array.isArray(stored[LIBRARY_KEY]) ? stored[LIBRARY_KEY] : [],
    activeVideo: stored[ACTIVE_VIDEO_KEY] || null
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

        if (!video.url) {
          throw new Error("missing_video_url");
        }

        await chrome.tabs.create({
          url: buildExternalToolUrl(video)
        });

        sendResponse({ ok: true });
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


chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  ensureWaveDropInjected(tabId, tab?.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await ensureWaveDropInjected(tabId, tab?.url);
  } catch (error) {
    // Ignore tab lookup failures.
  }
});
