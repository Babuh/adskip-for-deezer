const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source } = require('./load.js');
const { build } = require('./stitched.js');
const { STITCHED_URL, DURATION, RADIOFRANCE_URL, RADIOFRANCE_SOURCE_URL } = require('./fixtures.js');

const FILES = ['lib/timing.js', 'lib/skipper.js', 'lib/hosts.js', 'hosts/audiomeans.js', 'content/page.js'];
const WITH_STITCHING = [
  'lib/timing.js',
  'lib/skipper.js',
  'lib/stitching.js',
  'lib/hosts.js',
  'hosts/audiomeans.js',
  'hosts/radiofrance.js',
  'content/page.js',
];
const SETTINGS = { enabled: true, categories: { inserted: true } };

// Loads the page script in a small stand-in for deezer.com: a window that
// delivers postMessage right away, and a bare media element class for the
// script to wrap.
function openPage(options = {}) {
  class Media extends EventTarget {
    constructor() {
      super();
      this.rawSrc = '';
      this.currentSrc = '';
      this.duration = NaN;
      this.rawTime = 0;
      this.seeking = false;
      // Still by default, so a test that never starts it sees currentTime
      // exactly as it set it. start() makes it run like a real player, which
      // is the only way to watch something that waits on a clock.
      this.running = false;
      this.since = 0;
    }

    get currentTime() {
      return this.running ? this.rawTime + (Date.now() - this.since) / 1000 : this.rawTime;
    }

    set currentTime(value) {
      this.rawTime = value;
      this.since = Date.now();
    }

    start() {
      this.rawTime = this.currentTime;
      this.since = Date.now();
      this.running = true;
      this.dispatchEvent(new Event('playing'));
    }

    stop() {
      this.rawTime = this.currentTime;
      this.running = false;
    }

    get src() {
      return this.rawSrc;
    }

    set src(value) {
      this.rawSrc = value;
    }

    play() {
      return Promise.resolve();
    }
  }

  const window = new EventTarget();
  const messages = [];
  window.location = { origin: 'https://www.deezer.com' };
  window.postMessage = (data) => {
    messages.push(data);
    const event = new Event('message');
    event.data = data;
    event.source = window;
    window.dispatchEvent(event);
  };

  // page.js hands lib/hosts.js whatever an adapter may need beyond fetch;
  // this keeps hold of it so a test can drive it directly.
  let captured = null;

  const context = vm.createContext({
    window,
    document: new EventTarget(),
    HTMLMediaElement: Media,
    URL,
    setTimeout,
    clearTimeout,
    console: { debug() {} },
    ...(options.globals || {}),
  });
  for (const file of options.files || FILES) {
    vm.runInContext(source(file), context, { filename: file });
    if (file === 'lib/hosts.js') {
      const hosts = context.AdSkip.hosts;
      const install = hosts.useTools;
      hosts.useTools = (tools) => {
        captured = tools;
        install(tools);
      };
    }
  }

  return {
    Media,
    fromExtension(message) {
      window.postMessage({ channel: 'adskip:extension', ...message });
    },
    readRequests() {
      return messages.filter((m) => m.channel === 'adskip:page' && m.type === 'read');
    },
    get tools() {
      return captured;
    },
    lastState() {
      const states = messages.filter((m) => m.channel === 'adskip:page' && m.type === 'state');
      return JSON.parse(states[states.length - 1].state);
    },
  };
}

function loadMetadata(media, duration = DURATION) {
  media.duration = duration;
  media.dispatchEvent(new Event('loadedmetadata'));
}

function playTo(media, time) {
  media.currentTime = time;
  media.dispatchEvent(new Event('timeupdate'));
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.01, `${actual} is not ${expected}`);
}

test('skips the pre-roll as soon as the duration is known', () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  const media = new page.Media();
  media.src = STITCHED_URL;
  loadMetadata(media);
  near(media.currentTime, 30.14);
});

test('skips a mid-roll during playback', () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  const media = new page.Media();
  media.src = STITCHED_URL;
  loadMetadata(media);
  playTo(media, 667.5);
  near(media.currentTime, 667.5);
  playTo(media, 667.9);
  near(media.currentTime, 698.1);
});

test('waits for the settings before skipping anything', () => {
  const page = openPage();
  const media = new page.Media();
  media.src = STITCHED_URL;
  loadMetadata(media);
  near(media.currentTime, 0);
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  near(media.currentTime, 30.14);
});

test('does nothing when skipping is turned off', () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: { ...SETTINGS, enabled: false } });
  const media = new page.Media();
  media.src = STITCHED_URL;
  loadMetadata(media);
  playTo(media, 670);
  near(media.currentTime, 670);
});

test('does nothing for a category that is turned off', () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: { enabled: true, categories: { inserted: false } } });
  const media = new page.Media();
  media.src = STITCHED_URL;
  loadMetadata(media);
  near(media.currentTime, 0);
});

test('uses the URL reported by the background script after a redirect', () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  const media = new page.Media();
  media.src = 'https://podcasts.audiomeans.fr/show/episode.mp3';
  page.fromExtension({ type: 'stream', url: STITCHED_URL });
  loadMetadata(media);
  near(media.currentTime, 30.14);
});

test('also works when the reported URL arrives after the metadata', () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  const media = new page.Media();
  media.src = 'https://podcasts.audiomeans.fr/show/episode.mp3';
  loadMetadata(media);
  page.fromExtension({ type: 'stream', url: STITCHED_URL });
  near(media.currentTime, 30.14);
});

test('ignores a reported URL whose duration does not match the player', () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  const media = new page.Media();
  media.src = 'https://podcasts.audiomeans.fr/show/episode.mp3';
  page.fromExtension({ type: 'stream', url: STITCHED_URL });
  loadMetadata(media, 3000);
  near(media.currentTime, 0);
});

test('leaves other media alone', () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  const media = new page.Media();
  media.src = 'blob:https://www.deezer.com/8c1c2a4e';
  loadMetadata(media, 200);
  playTo(media, 10);
  near(media.currentTime, 10);
});

test('picks up players that only call play()', () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  const media = new page.Media();
  media.rawSrc = STITCHED_URL;
  media.play();
  loadMetadata(media);
  near(media.currentTime, 30.14);
});

test('reports the state of the episode to the extension', () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  const media = new page.Media();
  media.src = STITCHED_URL;
  loadMetadata(media);
  const state = page.lastState();
  assert.equal(state.status, 'active');
  assert.equal(state.host, 'audiomeans');
  assert.deepEqual(
    state.breaks.map((ad) => ad.skipped),
    [true, false],
  );
});

// Just enough of a Response for lib/stitching.js, answering the way a CDN on
// another origin does: the size comes from a HEAD, and a partial response
// exposes no Content-Range.
function cdn(files) {
  return (url, options = {}) => {
    const file = files[url];
    if (!file) return Promise.resolve({ ok: false, status: 404, headers: { get: () => null } });
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
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)),
    });
  };
}

// The analysis runs on promises; this lets them all settle.
async function settle() {
  for (let i = 0; i < 400; i++) await new Promise((done) => setImmediate(done));
}

test('waits for a host that has to be worked out, then skips its pre-roll', async () => {
  const files = build({ sourceTag: 12_341, servedTag: 57_154, ads: [{ at: 0, length: 472_513 }] });
  const page = openPage({
    files: WITH_STITCHING,
    globals: { fetch: cdn({ [RADIOFRANCE_SOURCE_URL]: files.source, [RADIOFRANCE_URL]: files.served }) },
  });
  page.fromExtension({ type: 'settings', settings: SETTINGS });

  const media = new page.Media();
  media.src = RADIOFRANCE_URL;
  loadMetadata(media, (files.served.length - 57_154) / 16_000);

  // Nothing is touched while the two files are still being compared.
  assert.equal(page.lastState().status, 'analysing');
  assert.equal(media.currentTime, 0);

  await settle();

  const state = page.lastState();
  assert.equal(state.status, 'active');
  assert.equal(state.host, 'radiofrance');
  assert.equal(state.breaks.length, 1);
  near(state.breaks[0].end, 29.53);
  near(media.currentTime, 29.58);
});

test('says in the debug info what became of each file the background saw', async () => {
  const files = build({ sourceTag: 12_341, servedTag: 57_154, ads: [{ at: 0, length: 472_513 }] });
  const page = openPage({
    files: WITH_STITCHING,
    // The original episode is missing, so the comparison cannot be made.
    globals: { fetch: cdn({ [RADIOFRANCE_URL]: files.served }) },
  });
  page.fromExtension({ type: 'settings', settings: SETTINGS });

  const media = new page.Media();
  media.src = 'https://proxycast.radiofrance.fr/episode.mp3';
  loadMetadata(media, (files.served.length - 57_154) / 16_000);
  page.fromExtension({ type: 'stream', url: RADIOFRANCE_URL });

  await settle();

  const [file] = page.lastState().files;
  assert.equal(file.host, 'radiofrance');
  assert.equal(file.pending, false);
  assert.equal(file.error, 'http-404');
});

test('does not wait for a timeupdate to enter a mid-roll', async () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  const media = new page.Media();
  media.src = STITCHED_URL;
  loadMetadata(media);

  // Past the pre-roll and a third of a second before the mid-roll at 11:08,
  // which is outside the margin check() acts on. From here on the player is
  // left running on its own: no timeupdate, no seek, no event of any kind.
  media.currentTime = 667.65;
  media.start();
  near(media.currentTime, 667.65);

  await new Promise((done) => setTimeout(done, 600));
  media.stop();
  assert.ok(media.currentTime >= 698.05, `stopped at ${media.currentTime}, still inside the break`);
  assert.ok(media.currentTime < 699, `jumped too far, to ${media.currentTime}`);
});

test('forgets a scheduled break when the file changes', async () => {
  const page = openPage();
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  const media = new page.Media();
  media.src = STITCHED_URL;
  loadMetadata(media);

  media.currentTime = 667.65;
  media.start();
  near(media.currentTime, 667.65);

  media.rawSrc = 'blob:https://www.deezer.com/another';
  media.dispatchEvent(new Event('loadstart'));
  media.stop();
  media.currentTime = 5;

  await new Promise((done) => setTimeout(done, 600));
  near(media.currentTime, 5);
});

test('asks the extension for reads it cannot make itself, and matches the answers', async () => {
  const page = openPage({ files: WITH_STITCHING, globals: { atob } });
  page.fromExtension({ type: 'settings', settings: SETTINGS });

  assert.equal(page.readRequests().length, 0, 'nothing is asked for on its own');

  const first = page.tools.background.fetchRange('https://host.test/a.mp3', 10, 4);
  const second = page.tools.background.fetchSize('https://host.test/b.mp3');
  const asked = page.readRequests();
  assert.equal(asked.length, 2);
  assert.deepEqual(
    asked.map((m) => [m.url, m.start, m.length]),
    [
      ['https://host.test/a.mp3', 10, 4],
      ['https://host.test/b.mp3', 0, 0],
    ],
  );
  assert.notEqual(asked[0].id, asked[1].id, 'each read is told apart');

  // Answered out of order, on purpose.
  page.fromExtension({ type: 'read-done', id: asked[1].id, ok: true, value: 4096 });
  page.fromExtension({
    type: 'read-done',
    id: asked[0].id,
    ok: true,
    value: Buffer.from([1, 2, 3, 4]).toString('base64'),
  });

  assert.equal(await second, 4096);
  assert.deepEqual([...(await first)], [1, 2, 3, 4]);
});

test('passes on a read the extension could not make', async () => {
  const page = openPage({ files: WITH_STITCHING, globals: { atob } });
  const waiting = page.tools.background.fetchSize('https://host.test/c.mp3');
  const [asked] = page.readRequests();
  page.fromExtension({ type: 'read-done', id: asked.id, ok: false, error: 'not-allowed' });
  await assert.rejects(waiting, /not-allowed/);
});

test('skips the pre-roll on a partial answer, then takes the rest when it lands', async () => {
  const files = build({
    sourceTag: 12_341,
    servedTag: 57_154,
    ads: [
      { at: 0, length: 472_513 },
      { at: 1_500_000, length: 481_071 },
    ],
  });
  const page = openPage({
    files: WITH_STITCHING,
    globals: { fetch: cdn({ [RADIOFRANCE_SOURCE_URL]: files.source, [RADIOFRANCE_URL]: files.served }) },
  });
  page.fromExtension({ type: 'settings', settings: SETTINGS });

  const media = new page.Media();
  media.src = RADIOFRANCE_URL;
  loadMetadata(media, (files.served.length - 57_154) / 16_000);

  await settle();

  const state = page.lastState();
  assert.equal(state.status, 'active');
  assert.equal(state.breaks.length, 2, 'both breaks are known once it is done');
  near(media.currentTime, 29.58);

  // The mid-roll, found after the pre-roll had already been handed over and
  // acted on, is still skipped.
  media.currentTime = files.expected[1][0] / 16_000 - 57_154 / 16_000 + 0.05;
  media.dispatchEvent(new Event('timeupdate'));
  near(media.currentTime, (files.expected[1][1] - 57_154) / 16_000 + 0.05);
});

test('turned off, it reads nothing at all', async () => {
  const files = build({ sourceTag: 12_341, servedTag: 57_154, ads: [{ at: 0, length: 472_513 }] });
  const asked = [];
  const page = openPage({
    files: WITH_STITCHING,
    globals: {
      fetch: (url, options) => {
        asked.push(url);
        return cdn({ [RADIOFRANCE_SOURCE_URL]: files.source, [RADIOFRANCE_URL]: files.served })(url, options);
      },
    },
  });

  page.fromExtension({ type: 'settings', settings: { ...SETTINGS, enabled: false } });
  const media = new page.Media();
  media.src = RADIOFRANCE_URL;
  loadMetadata(media, (files.served.length - 57_154) / 16_000);
  await settle();

  assert.deepEqual(asked, [], 'not a single request went out');
  assert.equal(media.currentTime, 0);

  // Switched back on, it gets to work.
  page.fromExtension({ type: 'settings', settings: SETTINGS });
  await settle();
  assert.ok(asked.length > 0, 'and now it does read');
  near(media.currentTime, 29.58);
});
