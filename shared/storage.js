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
      mode: PANEL_MODES.CLOSED,
      anchored: true,
      top: 26,
      left: 26
    };
  }

  function normalizePanelState(value = {}) {
    return {
      mode: Object.values(PANEL_MODES).includes(value.mode) ? value.mode : PANEL_MODES.CLOSED,
      anchored: value.anchored !== false,
      top: sanitizeNumber(value.top, 26),
      left: sanitizeNumber(value.left, 26)
    };
  }

  // Bridge endpoint is hardcoded — personal tool, not for public release
  const HARDCODED_BRIDGE_ENDPOINT = "http://127.0.0.1:4123/api/download";
  // Apple Music search — opens directly in the macOS Music app via music:// scheme
  const HARDCODED_EXTERNAL_TOOL = "music://music.apple.com/search?term={title}";

  function createDefaultPreferences() {
    return {
      localBridgeEndpoint: HARDCODED_BRIDGE_ENDPOINT,
      externalToolUrlTemplate: HARDCODED_EXTERNAL_TOOL,
      preferredFormat: DOWNLOAD_FORMATS.MP4,
      // Auto-add MP3 downloads to the Apple Music playlist — on by default.
      musicImportEnabled: true,
      // Chosen Apple Music target playlist (empty → the bridge's configured default).
      musicPlaylistId: "",
      musicPlaylistName: ""
    };
  }

  function normalizePreferences(value = {}) {
    return {
      // Always use hardcoded endpoint — ignore any saved value
      localBridgeEndpoint: HARDCODED_BRIDGE_ENDPOINT,
      // Always use Apple Music — ignore any saved value
      externalToolUrlTemplate: HARDCODED_EXTERNAL_TOOL,
      preferredFormat: Object.values(DOWNLOAD_FORMATS).includes(value.preferredFormat)
        ? value.preferredFormat
        : DOWNLOAD_FORMATS.MP4,
      // Default on; only an explicit false disables the Music hand-off.
      musicImportEnabled: value.musicImportEnabled !== false,
      // Remembered target playlist; the persistent ID is the authoritative key.
      musicPlaylistId: normalizeText(value.musicPlaylistId),
      musicPlaylistName: normalizeText(value.musicPlaylistName)
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
      browserDownloadId: null,
      musicImport: "",
      musicMessage: ""
    };
  }

  const MUSIC_IMPORT_STATES = [
    "", "idle", "importing", "added", "duplicate", "skipped", "failed", "needs_permission"
  ];

  function normalizeTaskState(value = {}) {
    const defaultState = createDefaultTaskState();
    const status = Object.values(TASK_STATUS).includes(value.status)
      ? value.status
      : defaultState.status;

    const musicImport = MUSIC_IMPORT_STATES.includes(value.musicImport)
      ? value.musicImport
      : "";

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
        : null,
      musicImport,
      musicMessage: normalizeText(value.musicMessage)
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
