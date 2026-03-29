const CLAUDE_URL = "https://claude.ai/";

chrome.action.onClicked.addListener(async () => {
  // Suche nach einem bereits offenen Claude-Tab.
  const tabs = await chrome.tabs.query({});

  const existingTab = tabs.find(
    (tab) => typeof tab.url === "string" && tab.url.includes("claude.ai")
  );

  if (existingTab && existingTab.id !== undefined) {
    // Aktiviere den vorhandenen Tab und hole bei Bedarf dessen Fenster nach vorn.
    await chrome.tabs.update(existingTab.id, { active: true });

    if (existingTab.windowId !== undefined) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }

    return;
  }

  // Falls kein Claude-Tab offen ist, erstelle einen neuen Tab.
  await chrome.tabs.create({ url: CLAUDE_URL });
});
