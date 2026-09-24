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
  // Beyond this, waiting for a break is left to timeupdate: a timer set
  // minutes ahead would only be wrong by the time it fired.
  const MAX_WAIT = 60000;

  // Reads the page can't do itself go through the background. Each one is
  // numbered so the answer finds its way back.
  const reads = new Map();
  let nextRead = 0;

  function decode(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // A read that never comes back would leave whoever asked waiting for the
  // life of the page. The background can be shut down between the question
  // and the answer, so every read gives up on its own after a while.
  const READ_TIMEOUT = 20000;

  function askBackground(url, start, length) {
    return new Promise((done, fail) => {
      const id = `r${(nextRead += 1)}`;
      const timer = setTimeout(() => {
        reads.delete(id);
        fail(new Error('no-answer'));
      }, READ_TIMEOUT);
      reads.set(id, {
        done: (value) => {
          clearTimeout(timer);
          done(value);
        },
        fail: (error) => {
          clearTimeout(timer);
          fail(error);
        },
      });
      send({ type: 'read', id, url, start, length });
    });
  }

  const background = {
    fetchSize: (url) => askBackground(url, 0, 0),
    fetchRange: (url, start, length) => askBackground(url, start, length).then(decode),
  };

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
      on(['pause', 'ratechange'], () => this.schedule());
      on(['play'], () => setActive(this));
    }

    get duration() {
      const { duration } = this.media;
      return duration > 0 && Number.isFinite(duration) ? duration : null;
    }

    // A new file is loading: forget everything about the previous one.
    reset() {
      const url = this.media.src || this.media.currentSrc;
      this.address = url || null;
      this.source = url ? hosts.parse(url) : null;
      this.breaks = null;
      this.resolvedFor = null;
      this.resolvedFrom = null;
      this.calibration = null;
      this.problem = null;
      this.skipper = null;
      this.skipped = new Set();
      this.wait(null);
      this.prepare();
    }

    // The byte model has to be checked against the real duration before the
    // ads can be placed on the timeline, so this waits for the metadata.
    prepare() {
      const duration = this.duration;
      // A source still being worked out is asked for again rather than
      // waited on: the answer lands in lib/hosts.js, not in this object. A
      // partial one is asked for again too, or the breaks found after it
      // would never arrive.
      if (this.source && (this.source.pending || this.source.partial)) {
        this.source = hosts.parse(this.address) || this.source;
      }
      if (duration && !this.source) {
        const found = findStream(duration);
        if (found) {
          this.address = found.address;
          this.source = found.source;
        }
      }
      if (!duration || !this.source || this.source.pending) {
        if (this.source) this.claim();
        return publish();
      }
      if (this.breaks && this.resolvedFrom === this.source && Math.abs(this.resolvedFor - duration) < 0.5) {
        return;
      }

      if (this.source.error) {
        this.problem = this.source.error;
      } else {
        const result = timing.resolveBreaks(this.source, duration);
        this.calibration = result.calibration;
        this.problem = result.ok ? null : result.reason;
        this.breaks = result.ok ? result.breaks : null;
        this.resolvedFor = duration;
        this.resolvedFrom = this.source;
      }

      if (this.problem) log('leaving this episode alone:', this.problem);
      else log(`${this.breaks.length} ad(s) in this episode`, this.breaks);

      this.claim();
      this.rebuild();
      publish();
      this.check();
    }

    // A player that has found its file speaks for the tab, even while the ads
    // are still being placed, so the popup can say what is going on.
    claim() {
      const current = currentActive();
      if (!current || !current.source) active = new WeakRef(this);
    }

    rebuild() {
      const breaks = this.breaks ? this.breaks.filter(isEnabled) : [];
      this.skipper = breaks.length ? skipper.createSkipper(breaks, { duration: this.duration }) : null;
      this.schedule();
    }

    wait(timer) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = timer;
    }

    // timeupdate only fires about four times a second, so a mid-roll can be a
    // quarter of a second under way before anything looks at it. When the
    // next break is known, a timer is set for the moment the playhead reaches
    // it. It only calls check(), which decides on its own terms: if the timer
    // never fires, nothing changes.
    schedule() {
      this.wait(null);
      const { media } = this;
      if (!this.skipper || !settings || !settings.enabled || media.paused) return;

      const time = media.currentTime;
      const rate = media.playbackRate > 0 ? media.playbackRate : 1;
      let next = null;
      for (const ad of this.breaks || []) {
        if (isEnabled(ad) && ad.start > time && (next === null || ad.start < next)) next = ad.start;
      }
      if (next === null) return;

      const delay = ((next - time) / rate) * 1000;
      if (delay > MAX_WAIT) return;
      this.wait(
        setTimeout(() => {
          this.timer = null;
          this.check();
        }, Math.max(0, delay)),
      );
    }

    check() {
      const { media } = this;
      if (!this.skipper || !settings || !settings.enabled || media.seeking) return;
      const hit = this.skipper.check(media.currentTime, Date.now());
      if (!hit) {
        this.schedule();
        return;
      }

      media.currentTime = hit.to;
      this.schedule();
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
      else if (this.source) status = this.source.pending ? 'analysing' : 'waiting';
      return {
        status,
        host: this.source ? this.source.host : null,
        problem: this.problem,
        duration: this.duration,
        breaks: (this.breaks || []).map((ad) => ({ ...ad, skipped: this.skipped.has(ad) })),
        calibration: this.calibration,
        incomplete: (this.source && this.source.incomplete) || null,
        params: (this.source && this.source.paramNames) || [],
        player: describe(this.media.src || this.media.currentSrc),
        reportedDuration: String(this.media.duration),
      };
    }
  }

  // What became of a file the background reported. Without this, a host that
  // has to be worked out and fails says nothing at all: the session simply
  // stays idle, with no way to tell a slow answer from a broken one.
  function describeStream(url) {
    const source = hosts.parse(url);
    if (!source) return { host: null, at: describe(url) };
    return {
      host: source.host,
      at: describe(url),
      pending: Boolean(source.pending),
      error: source.error || null,
      ads: (source.ranges || []).length,
      probes: source.probes || 0,
      kb: Math.round((source.bytes || 0) / 1024),
      incomplete: source.incomplete || null,
      ms: source.ms || 0,
      partial: Boolean(source.partial),
    };
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
    state.files = streams.map(describeStream);
    send({ type: 'state', state: JSON.stringify(state), skipped: skippedInTab });
  }

  // When the element only knows an address that redirects to the stitched
  // file, the final URL comes from the background script. The duration it
  // announces tells which element it belongs to.
  function findStream(duration) {
    for (let i = streams.length - 1; i >= 0; i--) {
      const source = hosts.parse(streams[i]);
      if (!source || source.error || source.pending) continue;
      if (timing.matchesDuration(source, duration)) return { address: streams[i], source };
    }
    return null;
  }

  // Records the address of a stitched file the element itself doesn't know
  // about, and offers it to the players still looking for theirs.
  function addStream(url, via) {
    if (streams.includes(url)) return;
    const source = hosts.parse(url);
    if (!source) return;
    const summary = source.pending ? 'looking at it' : `${source.ranges.length} ad(s)`;
    log(`file seen on ${source.host} (${via}):`, source.error || summary);
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

  // A host that has to be worked out answers later; the players waiting for
  // one look again when it does.
  hosts.useTools({ background });

  hosts.onResolved((address, source) => {
    const summary = source.error ? `gave up: ${source.error}` : `${source.ranges.length} ad(s)`;
    log(`worked out the file on ${source.host} in ${source.ms} ms, ${source.probes} request(s):`, summary);
    for (const session of liveSessions()) session.prepare();
    publish();
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== window || !message || message.channel !== FROM_EXTENSION) return;

    if (message.type === 'settings') {
      settings = message.settings;
      hosts.pause(!settings.enabled);
      for (const session of liveSessions()) {
        session.prepare();
        session.rebuild();
        session.check();
      }
    } else if (message.type === 'stream' && typeof message.url === 'string') {
      addStream(message.url, 'background');
    } else if (message.type === 'read-done') {
      const waiting = reads.get(message.id);
      if (!waiting) return;
      reads.delete(message.id);
      if (message.ok) waiting.done(message.value);
      else waiting.fail(new Error(message.error || 'read-failed'));
    }
  });

  send({ type: 'hello' });
})();
