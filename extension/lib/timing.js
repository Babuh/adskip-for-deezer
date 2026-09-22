(function (root) {
  'use strict';

  // Largest acceptable gap, in seconds, between the duration announced by the
  // host and the one measured by the browser.
  const DRIFT_TOLERANCE = 2;

  // MPEG-1 and MPEG-2 layer III bitrates, in kbit/s.
  const MP3_BITRATES = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 192, 224, 256, 320];
  const BITRATE_TOLERANCE = 0.01;

  const MIN_BREAK = 1;
  const MAX_BREAK = 600;
  const MAX_AD_SHARE = 0.5;

  function toSeconds(byte, { bytesPerSecond, audioOffset }) {
    return (byte - audioOffset) / bytesPerSecond;
  }

  // How long the file the host described should turn out to be. It is what
  // tells which player a URL belongs to, and whether a description fits the
  // file actually being played.
  function expectedDuration(source) {
    if (source.unit === 'seconds') return source.duration > 0 ? source.duration : null;
    if (source.unit !== 'bytes' || !(source.bytesPerSecond > 0)) return null;
    const audioBytes = source.totalBytes - source.audioOffset;
    return audioBytes > 0 ? audioBytes / source.bytesPerSecond : null;
  }

  function matchesDuration(source, duration) {
    const expected = expectedDuration(source);
    return expected !== null && Math.abs(expected - duration) <= DRIFT_TOLERANCE;
  }

  function isMp3Bitrate(bytesPerSecond) {
    const kbps = (bytesPerSecond * 8) / 1000;
    return MP3_BITRATES.some((rate) => Math.abs(kbps - rate) / rate <= BITRATE_TOLERANCE);
  }

  // Checks the byte model against the real duration. When the declared
  // bitrate doesn't fit, it is recomputed from the duration and kept only if
  // it is a standard constant bitrate: with a variable bitrate there is no
  // linear mapping, and guessing would cut into the show.
  function calibrate(source, duration) {
    if (!(duration > 0) || !Number.isFinite(duration)) return { ok: false, reason: 'unknown-duration' };
    const expected = expectedDuration(source);
    if (expected === null) return { ok: false, reason: 'missing-params' };

    const drift = Math.abs(expected - duration);
    const { audioOffset } = source;
    if (drift <= DRIFT_TOLERANCE) {
      return { ok: true, method: 'declared', bytesPerSecond: source.bytesPerSecond, audioOffset, drift };
    }
    const measured = (source.totalBytes - audioOffset) / duration;
    if (isMp3Bitrate(measured)) {
      return { ok: true, method: 'measured', bytesPerSecond: measured, audioOffset, drift };
    }
    return { ok: false, reason: 'duration-mismatch', drift };
  }

  function checkBreaks(breaks, duration) {
    let adTime = 0;
    let previousEnd = -Infinity;
    for (const { start, end } of breaks) {
      const length = end - start;
      if (!(length >= MIN_BREAK && length <= MAX_BREAK)) return 'implausible-length';
      if (start < -DRIFT_TOLERANCE || end > duration + DRIFT_TOLERANCE) return 'outside-episode';
      if (start < previousEnd) return 'overlapping';
      previousEnd = end;
      adTime += length;
    }
    return adTime > duration * MAX_AD_SHARE ? 'too-much-ad-time' : null;
  }

  // Turns the ranges found by a host adapter into breaks in seconds, or says
  // why the episode should be left alone.
  function resolveBreaks(source, duration) {
    if (source.ranges.length === 0) return { ok: true, breaks: [], calibration: null };
    if (!(duration > 0) || !Number.isFinite(duration)) {
      return { ok: false, reason: 'unknown-duration', calibration: null };
    }

    let calibration = null;
    let toTime = (value) => value;
    if (source.unit === 'bytes') {
      calibration = calibrate(source, duration);
      if (!calibration.ok) return { ok: false, reason: calibration.reason, calibration };
      toTime = (byte) => toSeconds(byte, calibration);
    } else if (source.unit === 'seconds') {
      // Positions given in seconds need no conversion, but they describe one
      // particular file. A host that says how long that file is has to agree
      // with what the browser is playing: otherwise this belongs to another
      // episode, and its positions would land in the show.
      const expected = expectedDuration(source);
      if (expected !== null && Math.abs(expected - duration) > DRIFT_TOLERANCE) {
        return { ok: false, reason: 'duration-mismatch', calibration };
      }
    } else {
      return { ok: false, reason: 'unknown-unit', calibration };
    }

    const breaks = source.ranges.map(([start, end]) => ({
      start: toTime(start),
      end: toTime(end),
      category: source.category,
    }));
    const problem = checkBreaks(breaks, duration);
    if (problem) return { ok: false, reason: problem, calibration };
    for (const ad of breaks) ad.start = Math.max(0, ad.start);
    return { ok: true, breaks, calibration };
  }

  root.AdSkip = root.AdSkip || {};
  root.AdSkip.timing = { DRIFT_TOLERANCE, toSeconds, expectedDuration, matchesDuration, calibrate, resolveBreaks };
})(globalThis);
