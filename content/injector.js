(function () {
  if (window.__WAVEDROP_PANEL_ACTIVE__) {
    return;
  }

  window.__WAVEDROP_PANEL_ACTIVE__ = true;

  const Constants = window.WaveDropConstants;
  const Messages = window.WaveDropMessages;
  const Storage = window.WaveDropStorage;
  const PanelView = window.WaveDropPanelView;
  const { MESSAGE_TYPES, PANEL_MODES, STORAGE_KEYS, TASK_STATUS, DOWNLOAD_FORMATS, PANEL_SIZES } = Constants;

  const ROOT_ID = "wavedrop-youtube-panel-root";
  const state = {
    video: null,
    videoFingerprint: "",
    panelState: Storage.createDefaultPanelState(),
    taskState: Storage.createDefaultTaskState(),
    preferences: Storage.createDefaultPreferences(),
    hydrated: false,
    assetUrl: chrome.runtime.getURL("assets/juice-carton.svg")
  };

  let host = null;
  let shadowRoot = null;
  let mountNode = null;
  let refreshTimer = null;
  let hydratePromise = null;
  let dragState = null;

  function normalizeText(value, fallback = "") {
    return Storage.normalizeText(value, fallback);
  }

  function isYouTubeVideoPage(urlValue = window.location.href) {
    try {
      const parsed = new URL(urlValue);
      return /(^|\.)youtube\.com$/i.test(parsed.hostname) && !!Storage.extractVideoIdFromUrl(urlValue);
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

  function getMetaContent(selector) {
    return normalizeText(document.querySelector(selector)?.getAttribute("content"));
  }

  function getTextFromSelectors(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = normalizeText(element?.textContent || element?.innerText);
      if (text) {
        return text;
      }
    }
    return "";
  }

  function collectVideoData() {
    if (!isYouTubeVideoPage()) {
      return null;
    }

    const videoId = Storage.extractVideoIdFromUrl(window.location.href);
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

    const player = document.querySelector("video");
    const duration =
      (player && Number.isFinite(player.duration) && player.duration > 0
        ? formatDuration(player.duration)
        : "") ||
      parseIsoDuration(getMetaContent('meta[itemprop="duration"]')) ||
      getTextFromSelectors([".ytp-time-duration"]) ||
      "Unknown duration";

    const thumbnail =
      getMetaContent('meta[property="og:image"]') ||
      (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");

    return Storage.normalizeVideo({
      videoId,
      title,
      channelName,
      duration,
      thumbnail,
      url: window.location.href
    });
  }

  function getVideoFingerprint(video) {
    return JSON.stringify([
      video.videoId,
      video.title,
      video.channelName,
      video.duration,
      video.thumbnail,
      video.url
    ]);
  }

  function getTargetWidth() {
    const viewportWidth = Math.max(220, window.innerWidth - 24);

    if (state.panelState.mode === PANEL_MODES.CLOSED) {
      return Math.min(PANEL_SIZES.launcherWidth, viewportWidth);
    }

    if (state.panelState.mode === PANEL_MODES.MINIMIZED) {
      return Math.min(PANEL_SIZES.minimizedWidth, viewportWidth);
    }

    return Math.min(PANEL_SIZES.openWidth, viewportWidth);
  }

  function estimateHeight() {
    if (state.panelState.mode === PANEL_MODES.CLOSED) {
      return 86;
    }
    if (state.panelState.mode === PANEL_MODES.MINIMIZED) {
      return 132;
    }
    return 640;
  }

  function clampPosition(position, box) {
    const width = Math.max(160, Math.round(box.width || getTargetWidth()));
    const height = Math.max(86, Math.round(box.height || estimateHeight()));
    const margin = 12;
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
    host.style.transition = "top 220ms ease, left 220ms ease, right 220ms ease, width 220ms ease";

    if (!host.parentNode) {
      document.documentElement.appendChild(host);
    }

    shadowRoot = host.shadowRoot || host.attachShadow({ mode: "open" });

    if (!shadowRoot.getElementById("wd-theme-style")) {
      const themeLink = document.createElement("link");
      themeLink.id = "wd-theme-style";
      themeLink.rel = "stylesheet";
      themeLink.href = chrome.runtime.getURL("shared/theme.css");
      shadowRoot.appendChild(themeLink);
    }

    if (!shadowRoot.getElementById("wd-panel-style")) {
      const panelLink = document.createElement("link");
      panelLink.id = "wd-panel-style";
      panelLink.rel = "stylesheet";
      panelLink.href = chrome.runtime.getURL("content/panel.css");
      shadowRoot.appendChild(panelLink);
    }

    mountNode = shadowRoot.getElementById("wd-panel-mount");
    if (!mountNode) {
      mountNode = document.createElement("div");
      mountNode.id = "wd-panel-mount";
      shadowRoot.appendChild(mountNode);
      shadowRoot.addEventListener("click", handleShadowClick);
      shadowRoot.addEventListener("pointerdown", handleShadowPointerDown);
    }

    return mountNode;
  }

  function applyHostLayout() {
    if (!host) {
      return;
    }

    const width = getTargetWidth();
    host.style.width = `${width}px`;

    if (state.panelState.anchored) {
      host.style.top = `${state.panelState.top}px`;
      host.style.right = "26px";
      host.style.left = "auto";
      return;
    }

    const rect = host.getBoundingClientRect();
    const clamped = clampPosition(state.panelState, {
      width,
      height: rect.height || estimateHeight()
    });

    state.panelState = Storage.normalizePanelState({
      ...state.panelState,
      anchored: false,
      top: clamped.top,
      left: clamped.left
    });

    host.style.top = `${clamped.top}px`;
    host.style.left = `${clamped.left}px`;
    host.style.right = "auto";
  }

  function destroyPanel() {
    dragState = null;
    mountNode = null;
    shadowRoot = null;
    if (host) {
      host.removeAttribute("data-dragging");
      host.remove();
      host = null;
    }
  }

  async function hydrateState() {
    if (state.hydrated) {
      return;
    }

    if (!hydratePromise) {
      hydratePromise = Messages.sendRuntime(MESSAGE_TYPES.GET_APP_STATE)
        .then((response) => {
          const data = response?.data || {};
          state.panelState = Storage.normalizePanelState(data.panelState);
          state.taskState = Storage.normalizeTaskState(data.taskState);
          state.preferences = Storage.normalizePreferences(data.preferences);
        })
        .catch(() => {
          state.panelState = Storage.createDefaultPanelState();
          state.taskState = Storage.createDefaultTaskState();
        })
        .finally(() => {
          state.hydrated = true;
          hydratePromise = null;
          render();
        });
    }

    await hydratePromise;
  }

  async function persistPanelState() {
    try {
      await Messages.sendRuntime(MESSAGE_TYPES.SET_PANEL_STATE, {
        panelState: state.panelState
      });
    } catch (error) {
      // Keep the panel responsive even if storage sync fails.
    }
  }

  async function persistActiveVideo() {
    if (!state.video) {
      return;
    }

    try {
      await Messages.sendRuntime(MESSAGE_TYPES.SET_ACTIVE_VIDEO, { video: state.video });
    } catch (error) {
      // Ignore transient state sync issues.
    }
  }

  function render() {
    if (!state.video || !isYouTubeVideoPage()) {
      destroyPanel();
      return;
    }

    const root = ensureMountNode();
    root.innerHTML = PanelView.render({
      video: state.video,
      panelState: state.panelState,
      taskState: state.taskState,
      assetUrl: state.assetUrl
    });
    applyHostLayout();
  }

  function restoreDefaultPanelState() {
    state.panelState = Storage.createDefaultPanelState();
    render();
    void persistPanelState();
  }

  function setPanelMode(mode) {
    state.panelState = Storage.normalizePanelState({
      ...state.panelState,
      mode
    });
    render();
    void persistPanelState();
  }

  function handleActionError(error) {
    const code = normalizeText(error?.message, "");

    if (code === "bridge_not_configured") {
      state.taskState = Storage.normalizeTaskState({
        ...Storage.createDefaultTaskState(),
        status: TASK_STATUS.FAILED,
        message: Constants.DEFAULT_STRINGS.bridgeError,
        error: code
      });
      render();
      return;
    }

    state.taskState = Storage.normalizeTaskState({
      ...Storage.createDefaultTaskState(),
      status: TASK_STATUS.FAILED,
      message: normalizeText(error?.message, "Action unavailable right now"),
      error: normalizeText(error?.message, "action_failed")
    });
    render();
  }

  async function handlePrimaryAction(format) {
    try {
      const response = await Messages.sendRuntime(MESSAGE_TYPES.START_DOWNLOAD, {
        video: state.video,
        format
      });

      if (!response?.ok || !response.data) {
        throw new Error(response?.error || "download_start_failed");
      }

      state.taskState = Storage.normalizeTaskState(response.data);
      render();
    } catch (error) {
      handleActionError(error);
    }
  }

  async function handleSecondaryAction(action) {
    try {
      if (action === "external") {
        const response = await Messages.sendRuntime(MESSAGE_TYPES.OPEN_EXTERNAL_TOOL, {
          video: state.video,
          format: state.preferences.preferredFormat
        });

        if (!response?.ok) {
          throw new Error(response?.error || "external_tool_failed");
        }

        state.taskState = Storage.normalizeTaskState({
          ...state.taskState,
          message: "External tool opened",
          error: ""
        });
        render();
        return;
      }

      if (action === "reset-task") {
        const response = await Messages.sendRuntime(MESSAGE_TYPES.RESET_TASK_STATE);
        if (!response?.ok || !response.data) {
          throw new Error(response?.error || "task_reset_failed");
        }
        state.taskState = Storage.normalizeTaskState(response.data);
        render();
      }
    } catch (error) {
      handleActionError(error);
    }
  }

  function handleShadowClick(event) {
    const control = event.target.closest("[data-control]");
    if (control) {
      if (control.dataset.control === "close") {
        setPanelMode(PANEL_MODES.CLOSED);
      } else if (control.dataset.control === "minimize") {
        setPanelMode(PANEL_MODES.MINIMIZED);
      } else if (control.dataset.control === "restore") {
        restoreDefaultPanelState();
      }
      return;
    }

    const action = event.target.closest("[data-action]");
    if (!action) {
      return;
    }

    if (action.dataset.action === "download-mp4") {
      void handlePrimaryAction(DOWNLOAD_FORMATS.MP4);
    } else if (action.dataset.action === "download-mp3") {
      void handlePrimaryAction(DOWNLOAD_FORMATS.MP3);
    } else {
      void handleSecondaryAction(action.dataset.action);
    }
  }

  function handleShadowPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    const handle = event.target.closest("[data-drag-handle]");
    if (!handle || event.target.closest("button, input, textarea, a")) {
      return;
    }

    if (!host || !state.video || state.panelState.mode === PANEL_MODES.CLOSED) {
      return;
    }

    const rect = host.getBoundingClientRect();
    state.panelState = Storage.normalizePanelState({
      ...state.panelState,
      anchored: false,
      top: rect.top,
      left: rect.left
    });

    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height
    };

    host.dataset.dragging = "true";
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
      void persistPanelState();
    }
  }

  function handlePointerMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const clamped = clampPosition(
      {
        left: event.clientX - dragState.offsetX,
        top: event.clientY - dragState.offsetY
      },
      dragState
    );

    state.panelState = Storage.normalizePanelState({
      ...state.panelState,
      anchored: false,
      top: clamped.top,
      left: clamped.left
    });

    applyHostLayout();
    event.preventDefault();
  }

  function handlePointerUp(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    stopDragging(true);
    event.preventDefault();
  }

  async function refreshVideoState() {
    if (!isYouTubeVideoPage()) {
      state.video = null;
      state.videoFingerprint = "";
      destroyPanel();
      return;
    }

    const nextVideo = collectVideoData();
    if (!nextVideo) {
      return;
    }

    const nextFingerprint = getVideoFingerprint(nextVideo);
    const changed = nextFingerprint !== state.videoFingerprint;
    state.video = nextVideo;
    state.videoFingerprint = nextFingerprint;

    if (!state.hydrated) {
      await hydrateState();
    }

    render();

    if (changed) {
      await persistActiveVideo();
      if (
        nextVideo.duration === "Unknown duration" ||
        nextVideo.channelName === "Unknown channel"
      ) {
        scheduleRefresh(900);
      }
    }
  }

  function scheduleRefresh(delay) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void refreshVideoState();
    }, delay);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[STORAGE_KEYS.PANEL_STATE]?.newValue) {
      state.panelState = Storage.normalizePanelState(changes[STORAGE_KEYS.PANEL_STATE].newValue);
      render();
    }

    if (changes[STORAGE_KEYS.TASK_STATE]?.newValue) {
      state.taskState = Storage.normalizeTaskState(changes[STORAGE_KEYS.TASK_STATE].newValue);
      render();
    }

    if (changes[STORAGE_KEYS.PREFERENCES]?.newValue) {
      state.preferences = Storage.normalizePreferences(changes[STORAGE_KEYS.PREFERENCES].newValue);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.PING) {
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === MESSAGE_TYPES.GET_VIDEO_CONTEXT) {
      sendResponse({
        ok: true,
        data: {
          video: state.video,
          pageSupported: isYouTubeVideoPage()
        }
      });
      return true;
    }

    if (message?.type === MESSAGE_TYPES.RESTORE_PANEL) {
      state.panelState = Storage.normalizePanelState(message.panelState || Storage.createDefaultPanelState());
      render();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  const observer = new MutationObserver(() => scheduleRefresh(220));
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("yt-navigate-finish", () => scheduleRefresh(260));
  window.addEventListener("popstate", () => scheduleRefresh(260));
  window.addEventListener("hashchange", () => scheduleRefresh(260));
  window.addEventListener("resize", () => render());
  window.addEventListener("pointermove", handlePointerMove, true);
  window.addEventListener("pointerup", handlePointerUp, true);
  window.addEventListener("pointercancel", handlePointerUp, true);

  scheduleRefresh(60);
})();
