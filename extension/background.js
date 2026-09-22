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

// Some podcast CDNs answer a range request without an
// Access-Control-Allow-Origin header, which makes the file impossible to read
// from the page whatever it contains. Reading it here works, because a
// request the extension makes to a host it has permission for isn't subject
// to those rules. Nothing else changes: the file is read, never altered, and
// only the podcast hosts can be asked for. An address the page made up is
// refused, so this can't be turned into a way to fetch anything at all.
const MAX_READ = 8 * 1024 * 1024;

function underPattern(url, pattern) {
  const parts = /^(\*|https?):\/\/(\*\.)?([^/*]+)\/\*$/.exec(pattern);
  if (!parts) return false;
  const [, scheme, anySubdomain, host] = parts;
  if (scheme !== '*' && `${scheme}:` !== url.protocol) return false;
  return anySubdomain ? url.hostname === host || url.hostname.endsWith(`.${host}`) : url.hostname === host;
}

function allowed(address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && hostPatterns.some((pattern) => underPattern(url, pattern));
}

function encode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// A redirect is refused rather than followed, for the same reason as in
// lib/stitching.js: a host that assembles an episode per listen answers one
// with a different assembly, and its bytes would look perfectly valid.
async function follow(url, options) {
  try {
    return await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', ...options });
  } catch {
    throw new Error('redirected-or-unreachable');
  }
}

async function readRange(url, start, length) {
  const response = await follow(url, {
    headers: { Range: `bytes=${start}-${start + length - 1}` },
  });
  if (response.status !== 206) throw new Error(response.ok ? 'no-range-support' : `http-${response.status}`);
  return encode(new Uint8Array(await response.arrayBuffer()));
}

async function readSize(url) {
  const response = await follow(url, { method: 'HEAD' });
  if (!response.ok) throw new Error(`http-${response.status}`);
  const length = Number(response.headers.get('Content-Length'));
  if (!Number.isInteger(length) || length <= 0) throw new Error('unknown-size');
  return length;
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'read') return undefined;
  const { url, start, length } = message;
  if (!sender.tab || !allowed(url) || !(length >= 0) || length > MAX_READ) {
    sendResponse({ ok: false, error: 'not-allowed' });
    return undefined;
  }
  const work = length > 0 ? readRange(url, Math.max(0, start), length) : readSize(url);
  work
    .then((value) => sendResponse({ ok: true, value }))
    .catch((error) => sendResponse({ ok: false, error: (error && error.message) || 'read-failed' }));
  return true;
});
