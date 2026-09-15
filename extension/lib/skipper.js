(function (root) {
  'use strict';

  // timeupdate fires about four times per second, so the skip triggers a
  // little before a break rather than a quarter of a second into it.
  const GUARD_IN = 0.15;
  // Land just after the break so its last frame isn't heard.
  const GUARD_OUT = 0.05;
  // Too close to the end of a break to be worth a seek.
  const END_MARGIN = 0.3;
  // A seek can land back inside the break it was meant to skip. It is retried
  // a couple of times, a second apart, then left alone rather than looping.
  const RETRY_DELAY = 1000;
  const MAX_ATTEMPTS = 3;

  function findBreak(time, breaks) {
    return breaks.findIndex(({ start, end }) => time >= start - GUARD_IN && time < end - END_MARGIN);
  }

  function createSkipper(breaks, { duration = Infinity } = {}) {
    const attempts = new Map();

    return {
      // Returns where to seek to, or null to let playback go on.
      check(time, now) {
        const index = findBreak(time, breaks);
        for (const key of attempts.keys()) {
          if (key !== index) attempts.delete(key);
        }
        if (index === -1) return null;

        const previous = attempts.get(index);
        if (previous && (previous.count >= MAX_ATTEMPTS || now - previous.at < RETRY_DELAY)) return null;

        const count = previous ? previous.count + 1 : 1;
        attempts.set(index, { count, at: now });
        const ad = breaks[index];
        return { ad, from: time, to: Math.min(ad.end + GUARD_OUT, duration), retry: count > 1 };
      },
    };
  }

  root.AdSkip = root.AdSkip || {};
  root.AdSkip.skipper = { GUARD_IN, GUARD_OUT, END_MARGIN, findBreak, createSkipper };
})(globalThis);
