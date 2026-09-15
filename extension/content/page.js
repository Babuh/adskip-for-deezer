// Runs in the page itself, next to Deezer's player.
//
// Deezer plays podcasts with an <audio> element that is never attached to the
// document, so no selector can find it. Instead, the src setter and play() are
// wrapped: any media element that gets a source or starts playing is picked
// up and watched.
(function () {
  'use strict';

  const lib = globalThis.AdSkip;
  if (!lib) return;
  delete globalThis.AdSkip;

  const { hosts, timing, skipper } = lib;

  const FROM_PAGE = 'adskip:page';
  const FROM_EXTENSION = 'adskip:extension';
  const MAX_STREAMS = 10;

  const tracked = new WeakSet();
  const sessions = new Set();
  const streams = [];
  let settings = null;
  let active = null;
  let skippedInTab = 0;

  function log(...args) {
    console.debug('[AdSkip]', ...args);
  }

  function send(message) {
    window.postMessage({ channel: FROM_PAGE, ...message }, window.location.origin);
  }

  // Where a media element gets its audio from, without the query string, for
  // logs and debug info.
  function describe(url) {
    if (!url) return 'none';
    try {
      const { protocol, hostname } = new URL(url);
      return protocol === 'blob:' ? 'blob' : hostname;
    } catch {
      return 'unknown';
    }
  }

  function isEnabled(ad) {
    return Boolean(settings && settings.categories[ad.category] !== false);
  }

  class Session {
    constructor(media) {
      this.media = media;
      this.reset();
      const on = (types, handler) => {
        for (const type of types) media.addEventListener(type, handler);
      };
      on(['loadstart', 'emptied'], () => this.reset());
      on(['loadedmetadata', 'durationchange'], () => this.prepare());
      on(['timeupdate', 'seeked', 'playing'], () => this.check());
      on(['play'], () => setActive(this));
    }

    get duration() {
      const { duration } = this.media;
      return duration > 0 && Number.isFinite(duration) ? duration : null;
    }

    // A new file is loading: forget everything about the previous one.
    reset() {
      const url = this.media.src || this.media.currentSrc;
      this.source = url ? hosts.parse(url) : null;
      this.breaks = null;
      this.resolvedFor = null;
      this.calibration = null;
      this.problem = null;
      this.skipper = null;
      this.skipped = new Set();
      this.prepare();
    }

    // The byte model has to be checked against the real duration before the
    // ads can be placed on the timeline, so this waits for the metadata.
    prepare() {
      const duration = this.duration;
      if (duration && !this.source) this.source = findStream(duration);
      if (!duration || !this.source) return publish();
      if (this.breaks && Math.abs(this.resolvedFor - duration) < 0.5) return;

      if (this.source.error) {
        this.problem = this.source.error;
      } else {
        const result = timing.resolveBreaks(this.source, duration);
        this.calibration = result.calibration;
        this.problem = result.ok ? null : result.reason;
        this.breaks = result.ok ? result.breaks : null;
        this.resolvedFor = duration;
      }

      if (this.problem) log('leaving this episode alone:', this.problem);
      else log(`${this.breaks.length} ad(s) in this episode`, this.breaks);

      const current = currentActive();
      if (!current || !current.source) active = new WeakRef(this);
      this.rebuild();
      publish();
      this.check();
    }

    rebuild() {
      const breaks = this.breaks ? this.breaks.filter(isEnabled) : [];
      this.skipper = breaks.length ? skipper.createSkipper(breaks, { duration: this.duration }) : null;
    }

    check() {
      const { media } = this;
      if (!this.skipper || !settings || !settings.enabled || media.seeking) return;
      const hit = this.skipper.check(media.currentTime, Date.now());
      if (!hit) return;

      media.currentTime = hit.to;
      if (hit.retry) return;
      this.skipped.add(hit.ad);
      skippedInTab += 1;
      log(`skipped the ad from ${hit.ad.start.toFixed(2)}s to ${hit.ad.end.toFixed(2)}s`);
      send({ type: 'skipped', seconds: hit.to - hit.from });
      publish();
    }

    snapshot() {
      let status = 'idle';
      if (this.problem) status = 'error';
      else if (this.breaks) status = this.breaks.length ? 'active' : 'no-ads';
      else if (this.source) status = 'waiting';
      return {
        status,
        host: this.source ? this.source.host : null,
        problem: this.problem,
        duration: this.duration,
        breaks: (this.breaks || []).map((ad) => ({ ...ad, skipped: this.skipped.has(ad) })),
        calibration: this.calibration,
        params: (this.source && this.source.paramNames) || [],
        player: describe(this.media.src || this.media.currentSrc),
        reportedDuration: String(this.media.duration),
        filesSeen: streams.length,
      };
    }
  }

  function currentActive() {
    return active ? active.deref() || null : null;
  }

  function setActive(session) {
    active = new WeakRef(session);
    publish();
  }

  function publish() {
    const session = currentActive();
    const state = session ? session.snapshot() : { status: 'idle' };
    send({ type: 'state', state: JSON.stringify(state), skipped: skippedInTab });
  }

  // When the element only knows an address that redirects to the stitched
  // file, the final URL comes from the background script. The duration it
  // announces tells which element it belongs to.
  function findStream(duration) {
    for (let i = streams.length - 1; i >= 0; i--) {
      const source = hosts.parse(streams[i]);
      if (source && !source.error && timing.matchesDuration(source, duration)) return source;
    }
    return null;
  }

  // Records the address of a stitched file the element itself doesn't know
  // about, and offers it to the players still looking for theirs.
  function addStream(url, via) {
    if (streams.includes(url)) return;
    const source = hosts.parse(url);
    if (!source) return;
    log(`file seen on ${source.host} (${via}):`, source.error || `${source.ranges.length} ad(s)`);
    streams.push(url);
    if (streams.length > MAX_STREAMS) streams.shift();
    for (const session of liveSessions()) {
      if (!session.source) session.prepare();
    }
  }

  function liveSessions() {
    const list = [];
    for (const ref of sessions) {
      const session = ref.deref();
      if (session) list.push(session);
      else sessions.delete(ref);
    }
    return list;
  }

  function watch(media) {
    try {
      if (!(media instanceof HTMLMediaElement) || tracked.has(media)) return;
      tracked.add(media);
      log('watching a media element, source:', describe(media.src || media.currentSrc));
      // Weak, so players Deezer throws away can still be collected.
      sessions.add(new WeakRef(new Session(media)));
    } catch (error) {
      log('could not watch a media element', error);
    }
  }

  const proto = HTMLMediaElement.prototype;

  const play = proto.play;
  proto.play = function () {
    watch(this);
    return play.apply(this, arguments);
  };

  const src = Object.getOwnPropertyDescriptor(proto, 'src');
  Object.defineProperty(proto, 'src', {
    ...src,
    set(value) {
      src.set.call(this, value);
      watch(this);
    },
  });

  // Elements that are part of the page are caught through their events.
  document.addEventListener('play', (event) => watch(event.target), true);

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== window || !message || message.channel !== FROM_EXTENSION) return;

    if (message.type === 'settings') {
      settings = message.settings;
      for (const session of liveSessions()) {
        session.rebuild();
        session.check();
      }
    } else if (message.type === 'stream' && typeof message.url === 'string') {
      addStream(message.url, 'background');
    }
  });

  send({ type: 'hello' });
})();
