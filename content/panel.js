(function (global) {
  const Constants = global.WaveDropConstants;
  const Storage = global.WaveDropStorage;
  const Icons = global.WaveDropIcons || {};
  const { BRAND_TITLE, BRAND_SUBTITLE, DECORATIVE_MARK, TASK_STATUS, DOWNLOAD_FORMATS } = Constants;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderStatusLabel(taskState) {
    if (taskState.status === TASK_STATUS.FAILED) {
      return "Error";
    }
    if (taskState.status === TASK_STATUS.COMPLETE) {
      return "Complete";
    }
    if (taskState.status === TASK_STATUS.DOWNLOADING) {
      return "Downloading";
    }
    if (taskState.status === TASK_STATUS.PREPARING) {
      return taskState.format === DOWNLOAD_FORMATS.MP3 ? "Preparing audio" : "Preparing video";
    }
    if (taskState.status === TASK_STATUS.PENDING) {
      return "Collecting stream info";
    }
    return "Ready";
  }

  function renderChrome() {
    return `
      <div class="wd-window-controls" aria-label="Window controls">
        <button class="wd-window-dot wd-window-dot-red" data-control="close" aria-label="Close panel"></button>
        <button class="wd-window-dot wd-window-dot-yellow" data-control="minimize" aria-label="Minimize panel"></button>
        <button class="wd-window-dot wd-window-dot-green" data-control="restore" aria-label="Restore panel"></button>
      </div>
      <div class="wd-header-wordmark" aria-hidden="true">${escapeHtml(BRAND_TITLE)}</div>
      <div class="wd-header-badge">
        <span class="wd-mini-pill">Night Utility</span>
      </div>
    `;
  }

  function renderVideoCard(video, taskState) {
    return `
      <section class="wd-section-card wd-video-card">
        <div class="wd-video-frame">
          <img
            class="wd-video-thumb"
            src="${escapeHtml(video.thumbnail)}"
            alt="${escapeHtml(video.title)} thumbnail"
          />
        </div>
        <div class="wd-video-copy">
          <span class="wd-overline">Active video</span>
          <h2 class="wd-video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</h2>
          <div class="wd-video-meta-row">
            <span class="wd-video-meta">${escapeHtml(video.channelName)}</span>
            <span class="wd-meta-dot"></span>
            <span class="wd-video-meta">${escapeHtml(video.duration)}</span>
          </div>
          <div class="wd-status-inline">
            <span class="wd-status-pill wd-status-pill-${escapeHtml(taskState.status)}">${escapeHtml(renderStatusLabel(taskState))}</span>
          </div>
        </div>
      </section>
    `;
  }

  function renderPrimaryActions(taskState) {
    const isBusy = [TASK_STATUS.PENDING, TASK_STATUS.PREPARING, TASK_STATUS.DOWNLOADING].includes(taskState.status);
    const dlIcon = Icons.download ? Icons.download(14) : "";
    const mp4Sub = isBusy && taskState.format === DOWNLOAD_FORMATS.MP4 ? renderStatusLabel(taskState) : "Video + audio";
    const mp3Sub = isBusy && taskState.format === DOWNLOAD_FORMATS.MP3 ? renderStatusLabel(taskState) : "Audio only";

    return `
      <section class="wd-section-card wd-actions-card">
        <div class="wd-primary-actions">
          <button class="wd-primary-button wd-primary-button-video" data-action="download-mp4" ${isBusy ? "disabled" : ""}>
            <span class="wd-button-head">${dlIcon}<span class="wd-button-label">MP4</span></span>
            <span class="wd-button-sub">${escapeHtml(mp4Sub)}</span>
          </button>
          <button class="wd-primary-button wd-primary-button-audio" data-action="download-mp3" ${isBusy ? "disabled" : ""}>
            <span class="wd-button-head">${dlIcon}<span class="wd-button-label">MP3</span></span>
            <span class="wd-button-sub">${escapeHtml(mp3Sub)}</span>
          </button>
        </div>
        <div class="wd-secondary-actions">
          <button class="wd-secondary-button" data-action="external" ${isBusy ? "disabled" : ""}>External tool</button>
          <button class="wd-secondary-button" data-action="reset-task">${isBusy ? "Reset" : "Clear status"}</button>
        </div>
        <p class="wd-action-note">${escapeHtml(isBusy ? "Download in progress…" : "Bridge endpoint required for MP3 and MP4 downloads.")}</p>
      </section>
    `;
  }

  function renderStatusCard(taskState) {
    const progress = Math.max(0, Math.min(100, Number(taskState.progress) || 0));
    const statusLabel = renderStatusLabel(taskState);
    const statusCopy = taskState.error || taskState.message || "Ready";

    return `
      <section class="wd-section-card wd-status-card">
        <div class="wd-status-head">
          <div>
            <span class="wd-overline">Task flow</span>
            <h3 class="wd-section-title">${escapeHtml(statusLabel)}</h3>
          </div>
          <span class="wd-progress-value">${progress}%</span>
        </div>
        <div class="wd-progress-track" aria-hidden="true">
          <span class="wd-progress-fill wd-status-${escapeHtml(taskState.status)}" style="width:${progress}%"></span>
        </div>
        <p class="wd-status-copy">${escapeHtml(statusCopy)}</p>
      </section>
    `;
  }

  function renderAtmosphere(assetUrl) {
    /* Use inline SVG mark when icons.js is available; fall back to plain text. */
    const nineMark = Icons.nineNineNine
      ? Icons.nineNineNine(96)
      : escapeHtml(DECORATIVE_MARK);

    return `
      <section class="wd-section-card wd-atmosphere-card">
        <div class="wd-atmosphere-copy">
          <span class="wd-ornament-title">${escapeHtml(BRAND_SUBTITLE)}</span>
          <div class="wd-waveform" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
          </div>
        </div>
        <div class="wd-atmosphere-art" aria-hidden="true">
          <div class="wd-nine-nine-nine">${nineMark}</div>
          <img class="wd-carton-symbol" src="${escapeHtml(assetUrl)}" alt="" />
        </div>
      </section>
    `;
  }

  function renderEmptyState(assetUrl) {
    return `
      <section class="wd-shell-surface wd-shell-empty">
        <header class="wd-window-bar">
          ${renderChrome()}
        </header>
        <div class="wd-shell-body wd-shell-body-empty">
          <section class="wd-section-card wd-empty-card">
            <span class="wd-overline">Waiting for YouTube</span>
            <h2 class="wd-empty-title">Open a YouTube watch page</h2>
            <p class="wd-empty-copy">WaveDrop wakes up on standard watch, shorts, and music pages, then anchors itself as a floating mini-window.</p>
          </section>
          ${renderAtmosphere(assetUrl)}
        </div>
      </section>
    `;
  }

  function renderLauncher(video) {
    const launcherMark = Icons.nineNineNine
      ? Icons.nineNineNine(20)
      : escapeHtml(DECORATIVE_MARK);

    return `
      <button class="wd-launcher-orb" data-control="restore" aria-label="Restore WaveDrop">
        <span class="wd-launcher-mark">${launcherMark}</span>
        <span class="wd-launcher-copy">${escapeHtml(video ? video.title : BRAND_TITLE)}</span>
      </button>
    `;
  }

  function renderMinimized(video) {
    return `
      <section class="wd-shell-surface wd-shell-minimized">
        <header class="wd-window-bar wd-window-bar-tight" data-drag-handle="true">
          ${renderChrome()}
        </header>
        <button class="wd-minimized-strip" data-control="restore" aria-label="Restore WaveDrop">
          <span class="wd-minimized-title">${escapeHtml(BRAND_TITLE)}</span>
          <span class="wd-minimized-copy">${escapeHtml(video.title)}</span>
        </button>
      </section>
    `;
  }

  function renderOpenPanel(state) {
    const { video, taskState, assetUrl } = state;

    return `
      <section class="wd-shell-surface">
        <header class="wd-window-bar" data-drag-handle="true">
          ${renderChrome()}
        </header>
        <div class="wd-shell-body">
          ${renderVideoCard(video, taskState)}
          ${renderPrimaryActions(taskState)}
          ${renderStatusCard(taskState)}
          ${renderAtmosphere(assetUrl)}
        </div>
      </section>
    `;
  }

  function render(state) {
    if (!state.video) {
      return renderEmptyState(state.assetUrl);
    }

    if (state.panelState.mode === Constants.PANEL_MODES.CLOSED) {
      return renderLauncher(state.video);
    }

    if (state.panelState.mode === Constants.PANEL_MODES.MINIMIZED) {
      return renderMinimized(state.video);
    }

    return renderOpenPanel(state);
  }

  global.WaveDropPanelView = Object.freeze({
    render,
    renderStatusLabel
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
