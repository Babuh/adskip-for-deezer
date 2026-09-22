const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source } = require('./load.js');

const MANIFEST = {
  content_scripts: [{ matches: ['https://www.deezer.com/*'] }],
  host_permissions: [
    'https://www.deezer.com/*',
    '*://*.audiomeans.fr/*',
    '*://media.radiofrance-podcast.net/*',
    '*://*.simplecastaudio.com/*',
  ],
};

// Runs the background script against a stand-in for the extension APIs, and
// hands back the listener it registered for read requests.
function start(fetcher) {
  const listeners = [];
  const api = {
    runtime: {
      getManifest: () => MANIFEST,
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
    webRequest: { onBeforeRequest: { addListener() {} } },
    action: { setBadgeBackgroundColor() {}, setBadgeText() {} },
    tabs: { sendMessage: () => Promise.resolve(), query: () => Promise.resolve([]) },
  };

  const context = vm.createContext({
    browser: api,
    URL,
    btoa,
    fetch: fetcher,
    console: { debug() {} },
  });
  vm.runInContext(source('background.js'), context, { filename: 'background.js' });

  return function read(message, sender = { tab: { id: 1 } }) {
    return new Promise((done) => {
      // The answer is built inside the context, so it is copied out before
      // being compared: objects from another realm are never deeply equal.
      const settle = (value) => done(value && typeof value === 'object' ? { ...value } : value);
      for (const listener of listeners) {
        const kept = listener(message, sender, settle);
        if (kept === true) return;
      }
      settle(undefined);
    });
  };
}

function serving(files) {
  return (url, options = {}) => {
    const file = files[url];
    if (!file) return Promise.resolve({ ok: false, status: 404 });
    if (options.method === 'HEAD') {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: (name) => (name === 'Content-Length' ? String(file.length) : null) },
      });
    }
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
    const slice = file.subarray(Number(from), Math.min(file.length, Number(to) + 1));
    return Promise.resolve({
      ok: true,
      status: 206,
      arrayBuffer: () => Promise.resolve(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)),
    });
  };
}

const ALLOWED = 'https://altice.simplecastaudio.com/x/episodes/y/audio/128/default.mp3/z.mp3';

test('reads a stretch of a file belonging to a known host', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const read = start(serving({ [ALLOWED]: bytes }));

  const answer = await read({ type: 'read', url: ALLOWED, start: 2, length: 4 });
  assert.equal(answer.ok, true);
  assert.deepEqual([...Buffer.from(answer.value, 'base64')], [3, 4, 5, 6]);
});

test('answers how long a file is', async () => {
  const read = start(serving({ [ALLOWED]: new Uint8Array(4096) }));
  const answer = await read({ type: 'read', url: ALLOWED, start: 0, length: 0 });
  assert.deepEqual(answer, { ok: true, value: 4096 });
});

test('refuses any address that is not one of the podcast hosts', async () => {
  const asked = [];
  const read = start((url) => {
    asked.push(url);
    return Promise.resolve({ ok: false, status: 404 });
  });

  for (const url of [
    'https://example.test/secret.mp3',
    'https://www.deezer.com/api/user',
    'http://altice.simplecastaudio.com/x.mp3',
    'https://altice.simplecastaudio.com.example.test/x.mp3',
    'https://acast.com/x.mp3',
    'file:///etc/passwd',
    'not a url',
  ]) {
    const answer = await read({ type: 'read', url, start: 0, length: 16 });
    assert.deepEqual(answer, { ok: false, error: 'not-allowed' }, url);
  }
  assert.deepEqual(asked, [], 'nothing was fetched');
});

test('refuses a read that no content script asked for', async () => {
  const read = start(serving({ [ALLOWED]: new Uint8Array(16) }));
  const answer = await read({ type: 'read', url: ALLOWED, start: 0, length: 8 }, {});
  assert.deepEqual(answer, { ok: false, error: 'not-allowed' });
});

test('refuses a read large enough to be a download', async () => {
  const read = start(serving({ [ALLOWED]: new Uint8Array(16) }));
  const answer = await read({ type: 'read', url: ALLOWED, start: 0, length: 64 * 1024 * 1024 });
  assert.deepEqual(answer, { ok: false, error: 'not-allowed' });
});

test('passes on what went wrong instead of inventing bytes', async () => {
  const read = start(serving({}));
  assert.deepEqual(await read({ type: 'read', url: ALLOWED, start: 0, length: 8 }), {
    ok: false,
    error: 'http-404',
  });

  const ignoresRange = start(() => Promise.resolve({ ok: true, status: 200 }));
  assert.deepEqual(await ignoresRange({ type: 'read', url: ALLOWED, start: 0, length: 8 }), {
    ok: false,
    error: 'no-range-support',
  });
});

test('leaves messages meant for something else alone', async () => {
  const read = start(serving({}));
  assert.equal(await read({ type: 'state', skipped: 2 }), undefined);
});
