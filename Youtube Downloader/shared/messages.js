(function (global) {
  const TYPES = global.WaveDropConstants.MESSAGE_TYPES;

  async function sendRuntime(type, payload) {
    return chrome.runtime.sendMessage({
      type,
      ...(payload || {})
    });
  }

  async function sendTab(tabId, type, payload) {
    return chrome.tabs.sendMessage(tabId, {
      type,
      ...(payload || {})
    });
  }

  global.WaveDropMessages = Object.freeze({
    TYPES,
    sendRuntime,
    sendTab
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
