(function () {
  if (window.__WAVEDROP_LOADED__) {
    return;
  }

  window.__WAVEDROP_LOADED__ = true;

  const ROOT_ID = "wavedrop-overlay-root";
  const LIBRARY_KEY = "wavedropLibrary";
  const UI_STATE_KEY = "wavedropUiState";
  const DEFAULT_UI_STATE = Object.freeze({
    mode: "open",
    position: {
      anchored: true,
      top: 18,
      left: 18
    }
  });

  const state = {
    video: null,
    videoFingerprint: "",
    isSaved: false,
    feedback: "",
    feedbackTone: "info",
    pendingAction: "",
    uiState: createDefaultUiState(),
    hydrated: false
  };

  let host = null;
  let shadow = null;
  let mountNode = null;
  let refreshTimer = null;
  let feedbackTimer = null;
  let hydratePromise = null;
  let dragState = null;

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

  function updateUiState(nextUiState, { persist = true, rerender = true } = {}) {
    state.uiState = normalizeUiState(nextUiState);

    if (rerender) {
      render();
    } else {
      applyHostLayout();
    }

    if (persist) {
      void persistUiState();
    }
  }

  async function persistUiState() {
    try {
      await chrome.runtime.sendMessage({
        type: "WAVEDROP_SET_UI_STATE",
        uiState: state.uiState
      });
    } catch (error) {
      // Ignore storage sync failures so the overlay remains responsive.
    }
  }

  async function hydrateStateOnce() {
    if (state.hydrated) {
      return;
    }

    if (!hydratePromise) {
      hydratePromise = chrome.runtime
        .sendMessage({ type: "WAVEDROP_GET_STATE" })
        .then((response) => {
          const payload = response?.data || {};
          const library = Array.isArray(payload.library) ? payload.library : [];

          state.uiState = normalizeUiState(payload.uiState);
          if (state.video) {
            state.isSaved = library.some(
              (entry) =>
                (state.video.videoId && entry.videoId === state.video.videoId) ||
                entry.url === state.video.url
            );
          }
        })
        .catch(() => {
          state.uiState = createDefaultUiState();
        })
        .finally(() => {
          state.hydrated = true;
          hydratePromise = null;
          render();
        });
    }

    await hydratePromise;
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

  function getTargetPanelWidth() {
    const viewportWidth = Math.max(220, window.innerWidth - 24);

    if (state.uiState.mode === "closed") {
      return Math.min(176, viewportWidth);
    }

    if (state.uiState.mode === "minimized") {
      return Math.min(294, viewportWidth);
    }

    return Math.min(360, viewportWidth);
  }

  function estimatePanelHeight() {
    if (state.uiState.mode === "closed") {
      return 76;
    }

    if (state.uiState.mode === "minimized") {
      return 104;
    }

    return 390;
  }

  function clampFloatingPosition(position, panelSize) {
    const margin = 12;
    const width = Math.max(160, Math.round(panelSize.width || getTargetPanelWidth()));
    const height = Math.max(72, Math.round(panelSize.height || estimatePanelHeight()));
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    return {
      left: Math.min(maxLeft, Math.max(margin, Math.round(position.left))),
      top: Math.min(maxTop, Math.max(margin, Math.round(position.top)))
    };
  }

  function ensureMountNode() {
    if (mountNode) {
      return mountNode;
    }

    host = document.getElementById(ROOT_ID) || document.createElement("div");
    host.id = ROOT_ID;
    host.style.position = "fixed";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "auto";
    host.style.transition = "top 180ms ease, left 180ms ease, right 180ms ease, width 180ms ease";

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
      shadow.addEventListener("pointerdown", handleShadowPointerDown);
    }

    return mountNode;
  }

  function applyHostLayout() {
    if (!host) {
      return;
    }

    const width = getTargetPanelWidth();
    host.style.width = `${width}px`;

    if (state.uiState.position.anchored) {
      host.style.top = `${state.uiState.position.top}px`;
      host.style.right = "18px";
      host.style.left = "auto";
      return;
    }

    const currentRect = host.getBoundingClientRect();
    const clamped = clampFloatingPosition(state.uiState.position, {
      width,
      height: currentRect.height || estimatePanelHeight()
    });

    state.uiState.position = {
      anchored: false,
      top: clamped.top,
      left: clamped.left
    };

    host.style.top = `${clamped.top}px`;
    host.style.left = `${clamped.left}px`;
    host.style.right = "auto";
  }

  function destroyMountNode() {
    clearTimeout(feedbackTimer);
    dragState = null;
    mountNode = null;
    shadow = null;

    if (host) {
      host.removeAttribute("data-dragging");
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
      `${video.title}\n${video.channelName} - ${video.duration}\n${video.url}`,
      "Share-ready text copied"
    );
  }

  async function shareVideo(video) {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: video.title,
          text: `${video.channelName} - ${video.duration}`,
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

  async function syncSavedState(libraryOverride) {
    if (!state.video) {
      state.isSaved = false;
      return;
    }

    try {
      const library = Array.isArray(libraryOverride)
        ? libraryOverride
        : (await chrome.runtime.sendMessage({ type: "WAVEDROP_GET_STATE" }))?.data?.library || [];

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

  function getActionErrorMessage(action, error) {
    const code = error?.message || error?.error || "";

    if (code === "invalid_external_tool_url_template") {
      return "Set a valid https:// external tool URL in the popup";
    }

    if (code === "missing_video_url") {
      return "Video link unavailable on this page";
    }

    if (action === "external") {
      return "External tool unavailable right now";
    }

    return "Action unavailable right now";
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
      setFeedback(getActionErrorMessage(action, error), "error");
    } finally {
      state.pendingAction = "";
      render();
    }
  }

  function setPanelMode(mode) {
    updateUiState(
      {
        ...state.uiState,
        mode: normalizePanelMode(mode)
      },
      { persist: true, rerender: true }
    );
  }

  function restorePanel() {
    updateUiState(
      {
        ...state.uiState,
        mode: "open"
      },
      { persist: true, rerender: true }
    );
  }

  function resetPanel() {
    updateUiState(createDefaultUiState(), { persist: true, rerender: true });
  }

  function handleShadowClick(event) {
    const controlButton = event.target.closest("button[data-control]");

    if (controlButton) {
      const control = controlButton.dataset.control;

      if (control === "close") {
        setPanelMode("closed");
      } else if (control === "minimize") {
        setPanelMode("minimized");
      } else if (control === "restore") {
        restorePanel();
      } else if (control === "reset") {
        resetPanel();
      }

      return;
    }

    const actionButton = event.target.closest("button[data-action]");

    if (!actionButton) {
      return;
    }

    handleAction(actionButton.dataset.action);
  }

  function handleShadowPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    const dragHandle = event.target.closest("[data-drag-handle]");

    if (!dragHandle || event.target.closest("button, a, input, textarea")) {
      return;
    }

    if (!host || !state.video || state.uiState.mode === "closed") {
      return;
    }

    const rect = host.getBoundingClientRect();
    state.uiState = normalizeUiState({
      ...state.uiState,
      position: {
        anchored: false,
        top: rect.top,
        left: rect.left
      }
    });

    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      panelWidth: rect.width,
      panelHeight: rect.height
    };

    host.dataset.dragging = "true";
    applyHostLayout();
    event.preventDefault();
  }

  function handleGlobalPointerMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const clamped = clampFloatingPosition(
      {
        left: event.clientX - dragState.offsetX,
        top: event.clientY - dragState.offsetY
      },
      {
        width: dragState.panelWidth,
        height: dragState.panelHeight
      }
    );

    state.uiState = normalizeUiState({
      ...state.uiState,
      position: {
        anchored: false,
        top: clamped.top,
        left: clamped.left
      }
    });

    applyHostLayout();
    event.preventDefault();
  }

  function stopDragging(shouldPersist) {
    if (!dragState) {
      return;
    }

    dragState = null;

    if (host) {
      host.removeAttribute("data-dragging");
    }

    if (shouldPersist) {
      void persistUiState();
    }
  }

  function handleGlobalPointerUp(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    stopDragging(true);
    event.preventDefault();
  }

  function handleWindowResize() {
    if (!state.video) {
      return;
    }

    render();
  }

  function getWindowControlsMarkup() {
    return `
      <div class="wd-window-controls" aria-label="Overlay controls">
        <button class="wd-window-dot wd-window-dot-red" data-control="close" aria-label="Hide WaveDrop"></button>
        <button class="wd-window-dot wd-window-dot-yellow" data-control="minimize" aria-label="Minimize WaveDrop"></button>
        <button class="wd-window-dot wd-window-dot-green" data-control="reset" aria-label="Reset WaveDrop position"></button>
      </div>
    `;
  }

  function renderClosedState() {
    return `
      <div class="wd-overlay-shell wd-overlay-shell-launcher">
        <button class="wd-launcher-card" data-control="restore" aria-label="Open WaveDrop">
          <span class="wd-launcher-label">WaveDrop</span>
          <span class="wd-launcher-meta">${escapeHtml(state.video.title)}</span>
        </button>
      </div>
    `;
  }

  function renderMinimizedState() {
    return `
      <div class="wd-overlay-shell">
        <div class="wd-glow wd-glow-one"></div>
        <section class="wd-overlay-panel wd-overlay-panel-minimized wd-glass-card wd-animate-in">
          <div class="wd-panel-chrome" data-drag-handle="true">
            ${getWindowControlsMarkup()}
            <span class="wd-chip wd-chip-live">Minimized</span>
          </div>
          <button class="wd-mini-bar" data-control="restore" aria-label="Expand WaveDrop">
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
          <div class="wd-panel-chrome" data-drag-handle="true">
            ${getWindowControlsMarkup()}
            <span class="wd-chip wd-chip-live">Drag me</span>
          </div>

          <div class="wd-panel-top">
            <div class="wd-panel-intro">
              <p class="wd-kicker">WaveDrop</p>
              <h2 class="wd-panel-title">Lucid noir companion</h2>
              <p class="wd-panel-mood">
                Mac chrome up top, neon bruised glass beneath, and a quick handoff lane for the video in front of you.
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
                  : "Drag the top chrome to move the panel, use yellow to tuck it away, and green to snap it back to the top-right corner."
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

    if (state.uiState.mode === "closed") {
      root.innerHTML = renderClosedState();
      applyHostLayout();
      return;
    }

    if (state.uiState.mode === "minimized") {
      root.innerHTML = renderMinimizedState();
      applyHostLayout();
      return;
    }

    root.innerHTML = renderOpenState();
    applyHostLayout();
  }

  async function refreshVideoState() {
    if (!isWatchPage()) {
      state.video = null;
      state.videoFingerprint = "";
      state.isSaved = false;
      state.pendingAction = "";
      dragState = null;
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

    if (!state.hydrated) {
      await hydrateStateOnce();
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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[UI_STATE_KEY]?.newValue) {
      state.uiState = normalizeUiState(changes[UI_STATE_KEY].newValue);
      render();
    }

    if (changes[LIBRARY_KEY]?.newValue && state.video) {
      const library = Array.isArray(changes[LIBRARY_KEY].newValue)
        ? changes[LIBRARY_KEY].newValue
        : [];

      state.isSaved = library.some(
        (entry) =>
          (state.video.videoId && entry.videoId === state.video.videoId) ||
          entry.url === state.video.url
      );
      render();
    }
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
  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("pointermove", handleGlobalPointerMove, true);
  window.addEventListener("pointerup", handleGlobalPointerUp, true);
  window.addEventListener("pointercancel", handleGlobalPointerUp, true);

  scheduleRefresh(50);
})();
