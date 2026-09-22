(function (root) {
  'use strict';

  // Acast assembles a file for each listener, served at
  // /livestitches/<hash>.mp3, and describes exactly what went into it right
  // next to it: the same path with a .json extension. That manifest needs no
  // signature, lists every segment with its start and end in seconds, and
  // says which ones are the episode and which ones were added. Nothing has to
  // be measured or compared. docs/how-it-works.md has the details.
  const STITCH = /^\/livestitches\/([0-9a-z]+)\.mp3$/;

  // Segments that touch belong to the same break. A hundredth of a second is
  // wider than the rounding in the manifest and far narrower than anything
  // audible.
  const JOIN = 0.01;

  function matches(url) {
    return url.hostname === 'acast.com' || url.hostname.endsWith('.acast.com');
  }

  function parse(url) {
    const found = STITCH.exec(url.pathname);
    // Anything else on the domain, the address the player is given included,
    // is somebody else's business.
    if (!found) return null;

    const hash = found[1];
    const manifest = new URL(`/livestitches/${hash}.json`, url.origin).href;

    return {
      unit: 'seconds',
      category: 'inserted',
      pending: true,
      paramNames: [...new Set(url.searchParams.keys())].sort(),
      resolve: () => read(manifest, hash),
    };
  }

  async function read(manifest, hash) {
    const response = await fetch(manifest, { credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`http-${response.status}`);

    const data = await response.json();
    if (data.hash && data.hash !== hash) throw new Error('wrong-manifest');
    if (!Array.isArray(data.sourceList) || data.sourceList.length === 0) throw new Error('no-source-list');

    const segments = [];
    for (const item of data.sourceList) {
      const start = Number(item.start);
      const end = Number(item.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('malformed-segment');
      segments.push({ type: item.type, start, end });
    }
    segments.sort((a, b) => a.start - b.start);

    // Only what the manifest calls "source" is the episode. Everything else
    // was put there by the stitcher: the ads, and the short Acast sting that
    // brackets them.
    const ranges = [];
    let duration = 0;
    for (const segment of segments) {
      duration = Math.max(duration, segment.end);
      if (segment.type === 'source') continue;
      const last = ranges[ranges.length - 1];
      if (last && segment.start - last[1] <= JOIN) last[1] = Math.max(last[1], segment.end);
      else ranges.push([segment.start, segment.end]);
    }

    return { ranges, duration };
  }

  root.AdSkip.hosts.register({ id: 'acast', matches, parse });
})(globalThis);
