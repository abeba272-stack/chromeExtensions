(function (global) {
  const Constants = global.WaveDropConstants;
  const { PANEL_MODES, TASK_STATUS, DOWNLOAD_FORMATS, DEFAULT_STRINGS } = Constants;

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

  function normalizeVideo(video = {}) {
    const url = normalizeText(video.url);
    const videoId = normalizeText(video.videoId) || extractVideoIdFromUrl(url);

    return {
      videoId,
      title: normalizeText(video.title, "Untitled video"),
      channelName: normalizeText(video.channelName, "Unknown channel"),
      thumbnail: normalizeText(video.thumbnail),
      duration: normalizeText(video.duration, "Unknown duration"),
      url
    };
  }

  function createDefaultPanelState() {
    return {
      mode: PANEL_MODES.OPEN,
      anchored: true,
      top: 26,
      left: 26
    };
  }

  function normalizePanelState(value = {}) {
    return {
      mode: Object.values(PANEL_MODES).includes(value.mode) ? value.mode : PANEL_MODES.OPEN,
      anchored: value.anchored !== false,
      top: sanitizeNumber(value.top, 26),
      left: sanitizeNumber(value.left, 26)
    };
  }

  function createDefaultPreferences() {
    return {
      localBridgeEndpoint: "",
      externalToolUrlTemplate: "https://www.google.com/search?q={title}%20{channel}%20{url}",
      preferredFormat: DOWNLOAD_FORMATS.MP4
    };
  }

  function normalizePreferences(value = {}) {
    return {
      localBridgeEndpoint: normalizeText(value.localBridgeEndpoint),
      externalToolUrlTemplate: normalizeText(
        value.externalToolUrlTemplate,
        createDefaultPreferences().externalToolUrlTemplate
      ),
      preferredFormat: Object.values(DOWNLOAD_FORMATS).includes(value.preferredFormat)
        ? value.preferredFormat
        : DOWNLOAD_FORMATS.MP4
    };
  }

  function createDefaultTaskState() {
    return {
      id: "",
      status: TASK_STATUS.READY,
      progress: 0,
      format: "",
      message: DEFAULT_STRINGS.ready,
      error: "",
      provider: "localBridge",
      videoTitle: "",
      updatedAt: "",
      browserDownloadId: null
    };
  }

  function normalizeTaskState(value = {}) {
    const defaultState = createDefaultTaskState();
    const status = Object.values(TASK_STATUS).includes(value.status)
      ? value.status
      : defaultState.status;

    return {
      id: normalizeText(value.id),
      status,
      progress: Math.min(100, sanitizeNumber(value.progress, defaultState.progress)),
      format: Object.values(DOWNLOAD_FORMATS).includes(value.format) ? value.format : defaultState.format,
      message: normalizeText(value.message, defaultState.message),
      error: normalizeText(value.error),
      provider: normalizeText(value.provider, defaultState.provider),
      videoTitle: normalizeText(value.videoTitle),
      updatedAt: normalizeText(value.updatedAt),
      browserDownloadId: Number.isFinite(Number(value.browserDownloadId))
        ? Number(value.browserDownloadId)
        : null
    };
  }

  function isBusyTask(taskState) {
    return [TASK_STATUS.PENDING, TASK_STATUS.PREPARING, TASK_STATUS.DOWNLOADING].includes(
      normalizeTaskState(taskState).status
    );
  }

  function createTemplateContext(video, format) {
    const normalizedVideo = normalizeVideo(video);
    return {
      url: normalizedVideo.url,
      title: normalizedVideo.title,
      channel: normalizedVideo.channelName,
      duration: normalizedVideo.duration,
      videoId: normalizedVideo.videoId,
      thumbnail: normalizedVideo.thumbnail,
      format: normalizeText(format)
    };
  }

  function hydrateTemplate(template, video, format) {
    const context = createTemplateContext(video, format);

    return String(template || "").replace(
      /\{(url|title|channel|duration|videoId|thumbnail|format)\}/g,
      (match, key) => encodeURIComponent(context[key] || "")
    );
  }

  function createTaskId() {
    return `wd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  global.WaveDropStorage = Object.freeze({
    normalizeText,
    sanitizeNumber,
    extractVideoIdFromUrl,
    normalizeVideo,
    createDefaultPanelState,
    normalizePanelState,
    createDefaultPreferences,
    normalizePreferences,
    createDefaultTaskState,
    normalizeTaskState,
    isBusyTask,
    hydrateTemplate,
    createTemplateContext,
    createTaskId
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
