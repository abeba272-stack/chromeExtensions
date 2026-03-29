(function () {
  if (window.__WAVEDROP_LOADED__) {
    return;
  }

  window.__WAVEDROP_LOADED__ = true;

  const ROOT_ID = "wavedrop-overlay-root";
  const state = {
    video: null,
    videoFingerprint: "",
    isSaved: false,
    feedback: "",
    feedbackTone: "info",
    pendingAction: "",
    panelMode: "open"
  };

  let host = null;
  let shadow = null;
  let mountNode = null;
  let refreshTimer = null;
  let feedbackTimer = null;

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
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizePanelMode(value) {
    return ["open", "minimized", "closed"].includes(value) ? value : "open";
  }

  function getPanelPreferenceKey(videoId = getVideoId()) {
    return videoId ? `wavedrop:panel:${videoId}` : "wavedrop:panel:default";
  }

  function loadPanelMode(videoId = getVideoId()) {
    try {
      return normalizePanelMode(sessionStorage.getItem(getPanelPreferenceKey(videoId)));
    } catch (error) {
      return "open";
    }
  }

  function persistPanelMode(mode, videoId = getVideoId()) {
    try {
      sessionStorage.setItem(getPanelPreferenceKey(videoId), normalizePanelMode(mode));
    } catch (error) {
      // Ignore storage failures in restricted contexts.
    }
  }

  function setPanelMode(mode) {
    state.panelMode = normalizePanelMode(mode);
    persistPanelMode(state.panelMode, state.video?.videoId || getVideoId());
    render();
  }

  function getVideoId(urlValue = window.location.href) {
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

  function isWatchPage(urlValue = window.location.href) {
    try {
      const parsed = new URL(urlValue);
      const isYoutubeHost = /(^|\.)youtube\.com$/i.test(parsed.hostname);
      return isYoutubeHost && !!getVideoId(urlValue);
    } catch (error) {
      return false;
    }
  }

  function formatDuration(seconds) {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const remainingSeconds = safeSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  function parseIsoDuration(value) {
    const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);

    if (!match) {
      return "";
    }

    const hours = Number.parseInt(match[1] || "0", 10);
    const minutes = Number.parseInt(match[2] || "0", 10);
    const seconds = Number.parseInt(match[3] || "0", 10);

    return formatDuration(hours * 3600 + minutes * 60 + seconds);
  }

  function getTextFromSelectors(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = normalizeText(
        element?.textContent || element?.innerText || element?.getAttribute?.("content")
      );

      if (text) {
        return text;
      }
    }

    return "";
  }

  function getMetaContent(selector) {
    return normalizeText(document.querySelector(selector)?.getAttribute("content"));
  }

  function getVideoDuration() {
    const player = document.querySelector("video");

    if (player && Number.isFinite(player.duration) && player.duration > 0) {
      return formatDuration(player.duration);
    }

    const metaDuration = parseIsoDuration(getMetaContent('meta[itemprop="duration"]'));
    if (metaDuration) {
      return metaDuration;
    }

    return getTextFromSelectors([".ytp-time-duration"]);
  }

  function getThumbnail(videoId) {
    const ogImage = getMetaContent('meta[property="og:image"]');

    if (ogImage) {
      return ogImage;
    }

    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
  }

  function collectVideoData() {
    if (!isWatchPage()) {
      return null;
    }

    const videoId = getVideoId();
    const title =
      getTextFromSelectors([
        "ytd-watch-metadata h1 yt-formatted-string",
        "ytd-reel-video-renderer h2",
        "ytd-reel-video-renderer #title",
        "h1.ytd-watch-metadata",
        "h1.title",
        "h1"
      ]) ||
      getMetaContent('meta[property="og:title"]') ||
      normalizeText(document.title.replace(/\s*-\s*YouTube$/i, ""), "Untitled video");

    const channelName =
      getTextFromSelectors([
        "#owner #channel-name a",
        "ytd-watch-metadata #channel-name a",
        "ytd-video-owner-renderer #channel-name a",
        "ytd-reel-player-overlay-renderer #channel-name a",
        "ytd-channel-name a"
      ]) ||
      getMetaContent('meta[name="author"]') ||
      "Unknown channel";

    const duration = getVideoDuration() || "Unknown duration";
    const url = window.location.href;

    return {
      videoId,
      title,
      channelName,
      thumbnail: getThumbnail(videoId),
      duration,
      url
    };
  }

  function getVideoFingerprint(video) {
    return JSON.stringify([
      video.videoId,
      video.title,
      video.channelName,
      video.thumbnail,
      video.duration,
      video.url
    ]);
  }

  function ensureMountNode() {
    if (mountNode) {
      return mountNode;
    }

    host = document.getElementById(ROOT_ID) || document.createElement("div");
    host.id = ROOT_ID;
    host.style.position = "fixed";
    host.style.top = "18px";
    host.style.right = "18px";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "auto";

    if (!host.parentNode) {
      document.documentElement.appendChild(host);
    }

    shadow = host.shadowRoot || host.attachShadow({ mode: "open" });

    if (!shadow.getElementById("wavedrop-styles")) {
      const styleLink = document.createElement("link");
      styleLink.id = "wavedrop-styles";
      styleLink.rel = "stylesheet";
      styleLink.href = chrome.runtime.getURL("styles.css");
      shadow.appendChild(styleLink);
    }

    mountNode = shadow.getElementById("wavedrop-content");

    if (!mountNode) {
      mountNode = document.createElement("div");
      mountNode.id = "wavedrop-content";
      shadow.appendChild(mountNode);
      shadow.addEventListener("click", handleShadowClick);
    }

    return mountNode;
  }

  function applyHostLayout() {
    if (!host) {
      return;
    }

    if (state.panelMode === "closed") {
      host.style.width = "176px";
      return;
    }

    if (state.panelMode === "minimized") {
      host.style.width = "min(294px, calc(100vw - 24px))";
      return;
    }

    host.style.width = "min(360px, calc(100vw - 24px))";
  }

  function destroyMountNode() {
    clearTimeout(feedbackTimer);
    mountNode = null;
    shadow = null;

    if (host) {
      host.remove();
      host = null;
    }
  }

  function setFeedback(message, tone = "info") {
    state.feedback = message;
    state.feedbackTone = tone;
    render();

    clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      state.feedback = "";
      state.feedbackTone = "info";
      render();
    }, 2200);
  }

  async function writeClipboardText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // Fall through to the DOM copy fallback below.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.style.top = "0";
    textarea.style.left = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const copied = document.execCommand("copy");
    textarea.remove();

    if (!copied) {
      throw new Error("clipboard_write_failed");
    }
  }

  async function copyToClipboard(text, successMessage) {
    await writeClipboardText(text);
    setFeedback(successMessage, "success");
  }

  async function copySharePayload(video) {
    await copyToClipboard(
      `${video.title}\n${video.channelName} • ${video.duration}\n${video.url}`,
      "Share-ready text copied"
    );
  }

  async function shareVideo(video) {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: video.title,
          text: `${video.channelName} • ${video.duration}`,
          url: video.url
        });
        setFeedback("Share sheet opened", "success");
        return;
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }
      }
    }

    await copySharePayload(video);
  }

  async function syncSavedState() {
    if (!state.video) {
      state.isSaved = false;
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "WAVEDROP_GET_STATE"
      });
      const library = response?.data?.library || [];

      state.isSaved = library.some(
        (entry) =>
          (state.video.videoId && entry.videoId === state.video.videoId) ||
          entry.url === state.video.url
      );
      render();
    } catch (error) {
      state.isSaved = false;
      render();
    }
  }

  async function persistActiveVideo() {
    if (!state.video) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: "WAVEDROP_SET_ACTIVE_VIDEO",
        video: state.video
      });
    } catch (error) {
      // Ignore transient storage sync failures so the overlay remains instant.
    }
  }

  async function handleAction(action) {
    if (!state.video || state.pendingAction) {
      return;
    }

    state.pendingAction = action;
    render();

    try {
      switch (action) {
        case "copy":
          await copyToClipboard(state.video.url, "Video link copied");
          break;

        case "external": {
          const response = await chrome.runtime.sendMessage({
            type: "WAVEDROP_OPEN_EXTERNAL_TOOL",
            video: state.video
          });

          if (!response?.ok) {
            throw new Error(response?.error || "external_tool_failed");
          }

          setFeedback("Handoff tab opened", "success");
          break;
        }

        case "save": {
          const response = await chrome.runtime.sendMessage({
            type: "WAVEDROP_SAVE_VIDEO",
            video: state.video
          });

          if (!response?.ok || !response.data) {
            throw new Error(response?.error || "save_failed");
          }

          state.isSaved = true;
          setFeedback(
            response.data.alreadySaved ? "Already in library" : "Saved to library",
            "success"
          );
          break;
        }

        case "share":
          await shareVideo(state.video);
          break;

        default:
          break;
      }
    } catch (error) {
      setFeedback("Action unavailable right now", "error");
    } finally {
      state.pendingAction = "";
      render();
    }
  }

  function handleShadowClick(event) {
    const controlButton = event.target.closest("button[data-control]");

    if (controlButton) {
      const control = controlButton.dataset.control;

      if (control === "close") {
        setPanelMode("closed");
      } else if (control === "minimize") {
        setPanelMode("minimized");
      } else if (control === "open") {
        setPanelMode("open");
      }

      return;
    }

    const actionButton = event.target.closest("button[data-action]");

    if (!actionButton) {
      return;
    }

    handleAction(actionButton.dataset.action);
  }

  function getWindowControlsMarkup() {
    return `
      <div class="wd-window-controls" aria-label="Overlay controls">
        <button class="wd-window-dot wd-window-dot-red" data-control="close" aria-label="Hide WaveDrop"></button>
        <button class="wd-window-dot wd-window-dot-yellow" data-control="minimize" aria-label="Minimize WaveDrop"></button>
        <button class="wd-window-dot wd-window-dot-green" data-control="open" aria-label="Expand WaveDrop"></button>
      </div>
    `;
  }

  function renderClosedState() {
    return `
      <div class="wd-overlay-shell wd-overlay-shell-launcher">
        <button class="wd-launcher-card" data-control="open" aria-label="Open WaveDrop">
          <span class="wd-launcher-label">WaveDrop</span>
          <span class="wd-launcher-meta">${escapeHtml(state.video.duration)}</span>
        </button>
      </div>
    `;
  }

  function renderMinimizedState() {
    return `
      <div class="wd-overlay-shell">
        <div class="wd-glow wd-glow-one"></div>
        <section class="wd-overlay-panel wd-overlay-panel-minimized wd-glass-card wd-animate-in">
          <div class="wd-panel-chrome">
            ${getWindowControlsMarkup()}
            <span class="wd-chip wd-chip-live">Minimized</span>
          </div>
          <button class="wd-mini-bar" data-control="open" aria-label="Expand WaveDrop">
            <span class="wd-mini-title">WaveDrop</span>
            <span class="wd-mini-track">${escapeHtml(state.video.title)}</span>
          </button>
        </section>
      </div>
    `;
  }

  function renderOpenState() {
    const actionIsPending = (action) => state.pendingAction === action;

    return `
      <div class="wd-overlay-shell">
        <div class="wd-glow wd-glow-one"></div>
        <div class="wd-glow wd-glow-two"></div>
        <section class="wd-overlay-panel wd-glass-card wd-animate-in">
          <div class="wd-panel-chrome">
            ${getWindowControlsMarkup()}
            <span class="wd-chip wd-chip-live">Watch page</span>
          </div>

          <div class="wd-panel-top">
            <div class="wd-panel-intro">
              <p class="wd-kicker">WaveDrop</p>
              <h2 class="wd-panel-title">Midnight tape companion</h2>
              <p class="wd-panel-mood">
                Noir glass, neon bleed, and a quick local vault for the track in front of you.
              </p>
            </div>
          </div>

          <article class="wd-current-video">
            <img
              class="wd-thumb"
              src="${escapeHtml(state.video.thumbnail)}"
              alt="${escapeHtml(state.video.title)} thumbnail"
            />
            <div class="wd-video-meta">
              <p class="wd-video-title">${escapeHtml(state.video.title)}</p>
              <p class="wd-video-subline">${escapeHtml(state.video.channelName)}</p>
              <div class="wd-meta-row">
                <span class="wd-chip">${escapeHtml(state.video.duration)}</span>
                ${
                  state.isSaved
                    ? '<span class="wd-chip wd-chip-success">Saved</span>'
                    : '<span class="wd-chip wd-chip-muted">Ready</span>'
                }
              </div>
            </div>
          </article>

          <div class="wd-action-grid">
            <button class="wd-action-button" data-action="copy">
              ${actionIsPending("copy") ? "Copying..." : "Copy Video Link"}
            </button>
            <button class="wd-action-button wd-action-button-accent" data-action="external">
              ${actionIsPending("external") ? "Opening..." : "Open in External Tool"}
            </button>
            <button class="wd-action-button" data-action="save">
              ${actionIsPending("save") ? "Saving..." : "Save to Library"}
            </button>
            <button class="wd-action-button" data-action="share">
              ${actionIsPending("share") ? "Sharing..." : "Share"}
            </button>
          </div>

          <div class="wd-footer-note">
            <p class="wd-note-copy">
              ${
                state.feedback
                  ? `<span class="wd-notice wd-notice-${escapeHtml(state.feedbackTone)}">${escapeHtml(state.feedback)}</span>`
                  : "Collect the link, hand it off, or pin it to your local library."
              }
            </p>
          </div>
        </section>
      </div>
    `;
  }

  function render() {
    if (!state.video || !isWatchPage()) {
      destroyMountNode();
      return;
    }

    const root = ensureMountNode();
    applyHostLayout();

    if (state.panelMode === "closed") {
      root.innerHTML = renderClosedState();
      return;
    }

    if (state.panelMode === "minimized") {
      root.innerHTML = renderMinimizedState();
      return;
    }

    root.innerHTML = renderOpenState();
  }

  async function refreshVideoState() {
    if (!isWatchPage()) {
      state.video = null;
      state.videoFingerprint = "";
      state.isSaved = false;
      state.pendingAction = "";
      state.panelMode = "open";
      destroyMountNode();
      return;
    }

    const nextVideo = collectVideoData();
    if (!nextVideo) {
      return;
    }

    const nextFingerprint = getVideoFingerprint(nextVideo);
    const metadataChanged = nextFingerprint !== state.videoFingerprint;

    state.video = nextVideo;
    state.videoFingerprint = nextFingerprint;

    if (metadataChanged) {
      state.panelMode = loadPanelMode(nextVideo.videoId);
    }

    render();

    if (metadataChanged) {
      await persistActiveVideo();
      await syncSavedState();

      if (
        nextVideo.duration === "Unknown duration" ||
        nextVideo.channelName === "Unknown channel"
      ) {
        scheduleRefresh(900);
      }
    }
  }

  function scheduleRefresh(delay = 180) {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      refreshVideoState();
    }, delay);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "WAVEDROP_PING") {
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "WAVEDROP_GET_VIDEO_CONTEXT") {
      sendResponse({
        ok: true,
        data: {
          video: state.video,
          isSaved: state.isSaved,
          pageSupported: isWatchPage()
        }
      });

      return true;
    }

    return false;
  });

  const observer = new MutationObserver(() => {
    scheduleRefresh(220);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("yt-navigate-finish", () => scheduleRefresh(260));
  window.addEventListener("popstate", () => scheduleRefresh(260));
  window.addEventListener("hashchange", () => scheduleRefresh(260));

  scheduleRefresh(50);
})();
