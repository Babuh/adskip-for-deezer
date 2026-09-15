const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source } = require('./load.js');
const { STITCHED_URL, DURATION } = require('./fixtures.js');

const FILES = ['lib/timing.js', 'lib/skipper.js', 'lib/hosts.js', 'hosts/audiomeans.js', 'content/page.js'];
const SETTINGS = { enabled: true, categories: { inserted: true } };

// Loads the page script in a small stand-in for deezer.com: a window that
// delivers postMessage right away, and a bare media element class for the
// script to wrap.
function openPage() {
  class Media extends EventTarget {
    constructor() {
      super();
      this.rawSrc = '';
      this.currentSrc = '';
      this.duration = NaN;
      this.currentTime = 0;
      this.seeking = false;
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

  const context = vm.createContext({
    window,
    document: new EventTarget(),
    HTMLMediaElement: Media,
    URL,
    console: { debug() {} },
  });
  for (const file of FILES) vm.runInContext(source(file), context, { filename: file });

  return {
    Media,
    fromExtension(message) {
      window.postMessage({ channel: 'adskip:extension', ...message });
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
