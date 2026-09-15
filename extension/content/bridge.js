// The page script can't use extension APIs, so this content script relays
// between the two: settings go down to the page, state and statistics come
// back up, and the audio URLs seen by the background script are forwarded.
(function () {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  const { withDefaults } = globalThis.AdSkip.settings;

  const FROM_PAGE = 'adskip:page';
  const FROM_EXTENSION = 'adskip:extension';

  let state = { status: 'idle' };
  let skipped = 0;
  let statsQueue = Promise.resolve();

  function toPage(message) {
    window.postMessage({ channel: FROM_EXTENSION, ...message }, window.location.origin);
  }

  async function sendSettings() {
    const stored = await api.storage.local.get('settings');
    toPage({ type: 'settings', settings: withDefaults(stored.settings) });
  }

  async function countSkip(seconds) {
    const { stats } = await api.storage.local.get('stats');
    const total = stats || { skipped: 0, seconds: 0 };
    await api.storage.local.set({ stats: { skipped: total.skipped + 1, seconds: total.seconds + seconds } });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== window || !message || message.channel !== FROM_PAGE) return;

    if (message.type === 'hello') {
      sendSettings();
    } else if (message.type === 'state') {
      try {
        state = JSON.parse(message.state);
      } catch {
        return;
      }
      skipped = Number(message.skipped) || 0;
      api.runtime.sendMessage({ type: 'state', state, skipped }).catch(() => {});
    } else if (message.type === 'skipped') {
      const seconds = Number(message.seconds);
      if (seconds > 0 && seconds < 3600) {
        statsQueue = statsQueue.then(() => countSkip(seconds)).catch(() => {});
      }
    }
  });

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'stream' && typeof message.url === 'string') {
      toPage({ type: 'stream', url: message.url });
    } else if (message.type === 'get-state') {
      sendResponse({ state, skipped });
    }
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) sendSettings();
  });

  sendSettings();
})();
