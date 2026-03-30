(function (global) {
  const Constants = global.WaveDropConstants;
  const Storage = global.WaveDropStorage;
  const { TASK_STATUS, DOWNLOAD_FORMATS, DEFAULT_STRINGS } = Constants;

  function sanitizeFileSegment(value, fallback) {
    return Storage.normalizeText(value, fallback)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function createDownloadFilename(video, format) {
    const extension = format === DOWNLOAD_FORMATS.MP3 ? "mp3" : "mp4";
    const title = sanitizeFileSegment(video.title, "WaveDrop export");
    const channel = sanitizeFileSegment(video.channelName, "YouTube");
    return `${channel}/${title}.${extension}`;
  }

  function ensureHttpUrl(urlValue, errorCode) {
    let parsed;
    try {
      parsed = new URL(urlValue);
    } catch (_) {
      throw new Error(errorCode);
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(errorCode);
    }

    return parsed.toString();
  }

  function normalizeBridgePayload(data, format) {
    const rawStatus = Storage.normalizeText(data?.status).toLowerCase();
    let status = TASK_STATUS.PREPARING;

    if (rawStatus === TASK_STATUS.PENDING) {
      status = TASK_STATUS.PENDING;
    } else if (rawStatus === TASK_STATUS.DOWNLOADING) {
      status = TASK_STATUS.DOWNLOADING;
    } else if (["complete", "completed", "done"].includes(rawStatus)) {
      status = TASK_STATUS.COMPLETE;
    } else if (["failed", "error"].includes(rawStatus)) {
      status = TASK_STATUS.FAILED;
    }

    return {
      status,
      progress: Math.min(100, Math.max(0, Number(data?.progress) || 0)),
      message: Storage.normalizeText(
        data?.message,
        status === TASK_STATUS.DOWNLOADING ? DEFAULT_STRINGS.downloading : DEFAULT_STRINGS.pending
      ),
      error: Storage.normalizeText(data?.error),
      downloadUrl: Storage.normalizeText(data?.downloadUrl),
      filename: Storage.normalizeText(data?.filename),
      taskId: Storage.normalizeText(data?.taskId),
      statusUrl: Storage.normalizeText(data?.statusUrl),
      format: Storage.normalizeText(data?.format, format)
    };
  }

  async function postBridgeRequest(endpoint, payload) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      throw new Error(Storage.normalizeText(data.error, "bridge_request_failed"));
    }

    return data;
  }

  async function fetchBridgeStatus(statusUrl) {
    const response = await fetch(statusUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      throw new Error(Storage.normalizeText(data.error, "bridge_status_failed"));
    }

    return data;
  }

  async function runLocalBridgeTask(options) {
    const { video, format, preferences, onProgress, onComplete } = options;
    const endpoint = Storage.normalizeText(preferences.localBridgeEndpoint);

    if (!endpoint) {
      throw new Error("bridge_not_configured");
    }

    const requestUrl = ensureHttpUrl(endpoint, "invalid_bridge_endpoint");
    const bridgePayload = {
      url: video.url,
      format,
      title: video.title,
      channel: video.channelName,
      duration: video.duration,
      videoId: video.videoId,
      thumbnail: video.thumbnail
    };

    onProgress({
      status: TASK_STATUS.PENDING,
      progress: 10,
      message: DEFAULT_STRINGS.pending,
      error: ""
    });

    const initialResponse = await postBridgeRequest(requestUrl, bridgePayload);
    const initialPayload = normalizeBridgePayload(initialResponse, format);

    if (initialPayload.status === TASK_STATUS.FAILED) {
      throw new Error(initialPayload.error || initialPayload.message || "bridge_request_failed");
    }

    if (initialPayload.status === TASK_STATUS.COMPLETE && initialPayload.downloadUrl) {
      return onComplete(initialPayload);
    }

    const statusUrl = initialPayload.statusUrl
      ? ensureHttpUrl(new URL(initialPayload.statusUrl, requestUrl).toString(), "invalid_bridge_status_url")
      : "";

    onProgress({
      status: initialPayload.status,
      progress: Math.max(18, initialPayload.progress),
      message:
        initialPayload.message ||
        (format === DOWNLOAD_FORMATS.MP3
          ? DEFAULT_STRINGS.preparingMp3
          : DEFAULT_STRINGS.preparingMp4),
      error: ""
    });

    if (!statusUrl) {
      throw new Error("bridge_status_url_missing");
    }

    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const statusResponse = await fetchBridgeStatus(statusUrl);
      const payload = normalizeBridgePayload(statusResponse, format);

      if (payload.status === TASK_STATUS.FAILED) {
        throw new Error(payload.error || payload.message || "bridge_task_failed");
      }

      if (payload.status === TASK_STATUS.COMPLETE) {
        return onComplete(payload);
      }

      onProgress({
        status: payload.status,
        progress: Math.max(20, payload.progress),
        message: payload.message || DEFAULT_STRINGS.downloading,
        error: ""
      });
    }

    throw new Error("bridge_timeout");
  }

  function buildExternalToolUrl(video, preferences, format) {
    const template = Storage.normalizeText(preferences.externalToolUrlTemplate);

    if (!template) {
      throw new Error("external_tool_not_configured");
    }

    return ensureHttpUrl(
      Storage.hydrateTemplate(template, video, format),
      "invalid_external_tool_url_template"
    );
  }

  /**
   * Initiates a bridge task without polling — makes the initial POST only.
   * Returns either { complete: true, downloadUrl, message } if the bridge
   * responds synchronously, or { complete: false, statusUrl, message } for
   * async jobs that need polling.
   */
  async function initiateBridgeTask(options) {
    const { video, format, preferences } = options;
    const endpoint = Storage.normalizeText(preferences.localBridgeEndpoint);

    if (!endpoint) {
      throw new Error("bridge_not_configured");
    }

    const requestUrl = ensureHttpUrl(endpoint, "invalid_bridge_endpoint");
    const bridgePayload = {
      url: video.url,
      format,
      title: video.title,
      channel: video.channelName,
      duration: video.duration,
      videoId: video.videoId,
      thumbnail: video.thumbnail
    };

    const initialResponse = await postBridgeRequest(requestUrl, bridgePayload);
    const initialPayload = normalizeBridgePayload(initialResponse, format);

    if (initialPayload.status === TASK_STATUS.FAILED) {
      throw new Error(initialPayload.error || initialPayload.message || "bridge_request_failed");
    }

    if (initialPayload.status === TASK_STATUS.COMPLETE && initialPayload.downloadUrl) {
      return { complete: true, downloadUrl: initialPayload.downloadUrl, message: initialPayload.message };
    }

    const statusUrl = initialPayload.statusUrl
      ? ensureHttpUrl(
          new URL(initialPayload.statusUrl, requestUrl).toString(),
          "invalid_bridge_status_url"
        )
      : "";

    if (!statusUrl) {
      throw new Error("bridge_status_url_missing");
    }

    const startMsg = initialPayload.message ||
      (format === DOWNLOAD_FORMATS.MP3 ? DEFAULT_STRINGS.preparingMp3 : DEFAULT_STRINGS.preparingMp4);

    return { complete: false, statusUrl, message: startMsg };
  }

  global.WaveDropProviders = Object.freeze({
    createDownloadFilename,
    initiateBridgeTask,
    runLocalBridgeTask,
    buildExternalToolUrl
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
