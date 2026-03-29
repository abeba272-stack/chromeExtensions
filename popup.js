const app = document.getElementById("app");

const state = {
  activeTab: null,
  currentVideo: null,
  isSaved: false,
  library: [],
  notice: "",
  noticeTone: "info",
  loading: true,
  onLiveWatchPage: false
};

document.addEventListener("DOMContentLoaded", () => {
  initializePopup();
  app.addEventListener("click", handleAppClick);
});

function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSavedDate(value) {
  if (!value) {
    return "Just now";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Recently saved";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function extractVideoIdFromUrl(urlValue) {
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

function isYouTubeWatchUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    return /(^|\.)youtube\.com$/i.test(parsed.hostname) && !!extractVideoIdFromUrl(urlValue);
  } catch (error) {
    return false;
  }
}

function findLibraryMatch(video) {
  if (!video) {
    return null;
  }

  return (
    state.library.find(
      (entry) =>
        (video.videoId && entry.videoId === video.videoId) || entry.url === video.url
    ) || null
  );
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
  }, 2200);
}

async function initializePopup() {
  render();

  try {
    const [tabs, backgroundState] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.runtime.sendMessage({ type: "WAVEDROP_GET_STATE" })
    ]);

    state.activeTab = tabs[0] || null;
    state.library = backgroundState?.data?.library || [];

    const tabContext = await getTabContext(state.activeTab);
    const fallbackVideo = backgroundState?.data?.activeVideo || null;

    state.currentVideo = tabContext.video || fallbackVideo;
    state.isSaved = tabContext.video
      ? tabContext.isSaved
      : !!findLibraryMatch(state.currentVideo);
    state.onLiveWatchPage = tabContext.pageSupported || false;
  } catch (error) {
    setNotice("Could not read the active tab", "error");
  } finally {
    state.loading = false;
    render();
  }
}

async function getTabContext(tab) {
  if (!tab?.id || !isYouTubeWatchUrl(tab.url)) {
    return {
      video: null,
      isSaved: false,
      pageSupported: false
    };
  }

  try {
    const response = await requestVideoContext(tab);

    return {
      video: response?.data?.video || null,
      isSaved: response?.data?.isSaved || false,
      pageSupported: response?.data?.pageSupported || false
    };
  } catch (error) {
    return {
      video: null,
      isSaved: false,
      pageSupported: true
    };
  }
}

async function requestVideoContext(tab) {
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: "WAVEDROP_GET_VIDEO_CONTEXT"
    });
  } catch (error) {
    await chrome.runtime.sendMessage({
      type: "WAVEDROP_ENSURE_INJECTION",
      tabId: tab.id,
      url: tab.url
    });

    return chrome.tabs.sendMessage(tab.id, {
      type: "WAVEDROP_GET_VIDEO_CONTEXT"
    });
  }
}

function renderLoading() {
  app.innerHTML = `
    <div class="wd-popup-stack">
      <section class="wd-glass-card wd-skeleton-card">
        <div class="wd-skeleton wd-skeleton-heading"></div>
        <div class="wd-skeleton wd-skeleton-line"></div>
        <div class="wd-skeleton wd-skeleton-line wd-skeleton-line-short"></div>
      </section>
      <section class="wd-glass-card wd-skeleton-card">
        <div class="wd-skeleton wd-skeleton-thumb"></div>
        <div class="wd-skeleton wd-skeleton-line"></div>
      </section>
    </div>
  `;
}

function renderCurrentVideoSection() {
  if (!state.currentVideo) {
    return `
      <section class="wd-glass-card wd-empty-card">
        <p class="wd-section-label">Current video</p>
        <h2 class="wd-empty-title">Open a YouTube watch page</h2>
        <p class="wd-empty-copy">
          WaveDrop activates on normal YouTube video URLs and keeps the latest capture ready in the popup.
        </p>
      </section>
    `;
  }

  const liveChip = state.onLiveWatchPage
    ? '<span class="wd-chip wd-chip-success">Live on page</span>'
    : '<span class="wd-chip wd-chip-muted">Last capture</span>';

  return `
    <section class="wd-glass-card">
      <div class="wd-card-head">
        <div>
          <p class="wd-section-label">Current video</p>
          <h2 class="wd-section-title">${escapeHtml(state.currentVideo.title)}</h2>
        </div>
        ${liveChip}
      </div>

      <article class="wd-current-video wd-current-video-popup">
        <img
          class="wd-thumb wd-thumb-large"
          src="${escapeHtml(state.currentVideo.thumbnail)}"
          alt="${escapeHtml(state.currentVideo.title)} thumbnail"
        />
        <div class="wd-video-meta">
          <p class="wd-video-subline">${escapeHtml(state.currentVideo.channelName)}</p>
          <div class="wd-meta-row">
            <span class="wd-chip">${escapeHtml(state.currentVideo.duration)}</span>
            ${
              state.isSaved
                ? '<span class="wd-chip wd-chip-success">In library</span>'
                : '<span class="wd-chip wd-chip-muted">Not saved</span>'
            }
          </div>
          <p class="wd-small-copy">${escapeHtml(normalizeText(state.currentVideo.url))}</p>
        </div>
      </article>

      <div class="wd-action-grid wd-action-grid-popup">
        <button class="wd-action-button" data-action="copy-current">Copy Video Link</button>
        <button class="wd-action-button wd-action-button-accent" data-action="external-current">
          Open in External Tool
        </button>
        <button class="wd-action-button" data-action="save-current">Save to Library</button>
        <button class="wd-action-button" data-action="share-current">Share</button>
      </div>
    </section>
  `;
}

function renderLibrarySection() {
  if (state.library.length === 0) {
    return `
      <section class="wd-glass-card wd-empty-card">
        <div class="wd-card-head">
          <div>
            <p class="wd-section-label">Library</p>
            <h2 class="wd-section-title">Nothing saved yet</h2>
          </div>
          <span class="wd-chip wd-chip-muted">0 items</span>
        </div>
        <p class="wd-empty-copy">
          Save videos from the overlay or popup to build a lightweight local collection in <code>chrome.storage</code>.
        </p>
      </section>
    `;
  }

  const itemsMarkup = state.library
    .map((video, index) => {
      return `
        <article class="wd-library-item">
          <img
            class="wd-thumb wd-thumb-library"
            src="${escapeHtml(video.thumbnail)}"
            alt="${escapeHtml(video.title)} thumbnail"
          />
          <div class="wd-library-copy">
            <p class="wd-library-title">${escapeHtml(video.title)}</p>
            <p class="wd-video-subline">${escapeHtml(video.channelName)}</p>
            <div class="wd-meta-row">
              <span class="wd-chip">${escapeHtml(video.duration)}</span>
              <span class="wd-chip wd-chip-muted">${escapeHtml(
                formatSavedDate(video.savedAt)
              )}</span>
            </div>
          </div>
          <div class="wd-library-actions">
            <button class="wd-mini-button" data-action="open-library" data-index="${index}">
              Open
            </button>
            <button class="wd-mini-button" data-action="copy-library" data-index="${index}">
              Copy
            </button>
            <button class="wd-mini-button wd-mini-button-danger" data-action="remove-library" data-index="${index}">
              Remove
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  return `
    <section class="wd-glass-card">
      <div class="wd-card-head">
        <div>
          <p class="wd-section-label">Library</p>
          <h2 class="wd-section-title">Saved references</h2>
        </div>
        <span class="wd-chip wd-chip-live">${state.library.length} items</span>
      </div>

      <div class="wd-library-list">${itemsMarkup}</div>
    </section>
  `;
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <div class="wd-notice wd-notice-${escapeHtml(state.noticeTone)}">
      ${escapeHtml(state.notice)}
    </div>
  `;
}

function render() {
  if (state.loading) {
    renderLoading();
    return;
  }

  app.innerHTML = `
    <div class="wd-popup-stack">
      ${renderNotice()}
      ${renderCurrentVideoSection()}
      ${renderLibrarySection()}
    </div>
  `;
}

async function copyToClipboard(text, message) {
  await navigator.clipboard.writeText(text);
  setNotice(message, "success");
}

async function shareVideo(video) {
  if (!video) {
    return;
  }

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: video.title,
        text: `${video.channelName} • ${video.duration}`,
        url: video.url
      });
      setNotice("Share sheet opened", "success");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }
  }

  await copyToClipboard(
    `${video.title}\n${video.channelName} • ${video.duration}\n${video.url}`,
    "Share-ready text copied"
  );
}

async function handleAppClick(event) {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const index = Number.parseInt(button.dataset.index || "-1", 10);
  const libraryVideo = Number.isInteger(index) && index >= 0 ? state.library[index] : null;

  try {
    switch (action) {
      case "copy-current":
        await copyToClipboard(state.currentVideo?.url || "", "Video link copied");
        break;

      case "external-current": {
        const response = await chrome.runtime.sendMessage({
          type: "WAVEDROP_OPEN_EXTERNAL_TOOL",
          video: state.currentVideo
        });

        if (!response?.ok) {
          throw new Error(response?.error || "external_tool_failed");
        }

        setNotice("Handoff tab opened", "success");
        break;
      }

      case "save-current": {
        const response = await chrome.runtime.sendMessage({
          type: "WAVEDROP_SAVE_VIDEO",
          video: state.currentVideo
        });

        if (!response?.ok || !response.data) {
          throw new Error(response?.error || "save_failed");
        }

        state.library = response.data.library;
        state.currentVideo = response.data.video;
        state.isSaved = true;
        render();
        setNotice(
          response.data.alreadySaved ? "Already in library" : "Saved to library",
          "success"
        );
        break;
      }

      case "share-current":
        await shareVideo(state.currentVideo);
        break;

      case "open-library":
        if (libraryVideo?.url) {
          await chrome.tabs.create({ url: libraryVideo.url });
        }
        break;

      case "copy-library":
        if (libraryVideo?.url) {
          await copyToClipboard(libraryVideo.url, "Saved link copied");
        }
        break;

      case "remove-library": {
        const response = await chrome.runtime.sendMessage({
          type: "WAVEDROP_REMOVE_VIDEO",
          videoId: libraryVideo?.videoId,
          url: libraryVideo?.url
        });

        if (!response?.ok || !response.data) {
          throw new Error(response?.error || "remove_failed");
        }

        state.library = response.data.library;
        state.isSaved = !!findLibraryMatch(state.currentVideo);
        render();
        setNotice("Removed from library", "success");
        break;
      }

      default:
        break;
    }
  } catch (error) {
    setNotice("Action unavailable right now", "error");
  }
}
