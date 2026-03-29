(function (global) {
  const STORAGE_KEYS = Object.freeze({
    ACTIVE_VIDEO: "wavedropActiveVideo",
    PANEL_STATE: "wavedropPanelState",
    TASK_STATE: "wavedropTaskState",
    PREFERENCES: "wavedropPreferences"
  });

  const MESSAGE_TYPES = Object.freeze({
    PING: "WAVEDROP_PING",
    GET_APP_STATE: "WAVEDROP_GET_APP_STATE",
    SET_ACTIVE_VIDEO: "WAVEDROP_SET_ACTIVE_VIDEO",
    SET_PANEL_STATE: "WAVEDROP_SET_PANEL_STATE",
    RESTORE_PANEL: "WAVEDROP_RESTORE_PANEL",
    RESET_PANEL: "WAVEDROP_RESET_PANEL",
    OPEN_PANEL_IN_TAB: "WAVEDROP_OPEN_PANEL_IN_TAB",
    SET_PREFERENCES: "WAVEDROP_SET_PREFERENCES",
    START_DOWNLOAD: "WAVEDROP_START_DOWNLOAD",
    OPEN_EXTERNAL_TOOL: "WAVEDROP_OPEN_EXTERNAL_TOOL",
    GET_VIDEO_CONTEXT: "WAVEDROP_GET_VIDEO_CONTEXT",
    RESET_TASK_STATE: "WAVEDROP_RESET_TASK_STATE",
    ENSURE_INJECTION: "WAVEDROP_ENSURE_INJECTION"
  });

  const PANEL_MODES = Object.freeze({
    OPEN: "open",
    MINIMIZED: "minimized",
    CLOSED: "closed"
  });

  const TASK_STATUS = Object.freeze({
    READY: "ready",
    PENDING: "pending",
    PREPARING: "preparing",
    DOWNLOADING: "downloading",
    COMPLETE: "complete",
    FAILED: "failed"
  });

  const DOWNLOAD_FORMATS = Object.freeze({
    MP3: "mp3",
    MP4: "mp4"
  });

  const DEFAULT_STRINGS = Object.freeze({
    bridgeError: "Configure a local bridge endpoint to enable MP3 and MP4 actions.",
    ready: "Ready",
    pending: "Collecting stream info",
    preparingMp3: "Preparing audio",
    preparingMp4: "Preparing video",
    downloading: "Downloading",
    complete: "Complete",
    failed: "Error"
  });

  global.WaveDropConstants = Object.freeze({
    APP_NAME: "WaveDrop",
    BRAND_TITLE: "Juice WRLD",
    BRAND_SUBTITLE: "Juice WRLD",
    DECORATIVE_MARK: "999",
    STORAGE_KEYS,
    MESSAGE_TYPES,
    PANEL_MODES,
    TASK_STATUS,
    DOWNLOAD_FORMATS,
    DEFAULT_STRINGS,
    PANEL_SIZES: Object.freeze({
      openWidth: 430,
      minimizedWidth: 252,
      launcherWidth: 198
    })
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
