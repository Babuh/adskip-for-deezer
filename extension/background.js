// Watches requests to the podcast hosts and passes their URLs to the tab.
// Deezer gives its player an address that redirects to the stitched file, so
// the page never sees the URL holding the ad positions. Requests are only
// observed, never blocked or changed.
const api = globalThis.browser || globalThis.chrome;
const manifest = api.runtime.getManifest();

// www.deezer.com is in host_permissions only because Chrome reports a request
// to an extension that may access both its URL and the page that made it.
// The rest of the list is the podcast hosts.
const pagePatterns = [...new Set(manifest.content_scripts.flatMap((script) => script.matches))];
const pageOrigins = pagePatterns.map((pattern) => new URL(pattern.replace('*', '')).origin);
const hostPatterns = manifest.host_permissions.filter((pattern) => !pagePatterns.includes(pattern));

function forward(tabId, frameId, url) {
  api.tabs.sendMessage(tabId, { type: 'stream', url }, { frameId }).catch(() => {});
}

api.webRequest.onBeforeRequest.addListener(
  (details) => {
    console.debug('[AdSkip]', details.type, 'request to', new URL(details.url).hostname, 'from tab', details.tabId);
    if (details.tabId >= 0) {
      forward(details.tabId, details.frameId, details.url);
      return;
    }
    // Once Deezer's service worker controls the page, it fetches the audio
    // itself and the request belongs to no tab. The URL goes to every tab:
    // only Deezer tabs run the content script, the others don't answer, and
    // a page only keeps the URL if the duration matches one of its players.
    const origin = details.initiator || details.originUrl;
    if (origin && !pageOrigins.some((page) => origin.startsWith(page))) return;
    api.tabs.query({}).then((tabs) => {
      for (const tab of tabs) forward(tab.id, 0, details.url);
    });
  },
  { urls: hostPatterns },
);

// The badge shows how many ads were skipped in the tab.
api.action.setBadgeBackgroundColor({ color: '#f25c2a' });

api.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== 'state' || !sender.tab) return;
  const text = message.skipped > 0 ? String(message.skipped) : '';
  api.action.setBadgeText({ tabId: sender.tab.id, text });
});
