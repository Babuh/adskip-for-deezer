(function (root) {
  'use strict';

  // Audiomeans stitches the ads into the MP3 when the file is requested and
  // describes the result in the query string of the file it serves:
  //   ap  byte ranges of the ads, "start-end" separated by commas
  //   o1  bytes per second (constant bitrate)
  //   o2  total size of the file in bytes
  //   o3  offset of the first audio byte, right after the ID3 tag
  // docs/how-it-works.md has the details.
  const RANGE = /^(\d+)-(\d+)$/;

  function matches(url) {
    return url.hostname === 'audiomeans.fr' || url.hostname.endsWith('.audiomeans.fr');
  }

  function readInteger(params, name) {
    const value = params.get(name);
    return value !== null && /^\d+$/.test(value) ? Number(value) : null;
  }

  function parse(url) {
    const params = url.searchParams;
    const ap = params.get('ap');
    const layout = {
      bytesPerSecond: readInteger(params, 'o1'),
      totalBytes: readInteger(params, 'o2'),
      audioOffset: readInteger(params, 'o3'),
    };

    // Nothing about ads or file layout: this isn't a stitched file, maybe the
    // address that redirects to one.
    if (ap === null && Object.values(layout).every((value) => value === null)) return null;

    const source = {
      unit: 'bytes',
      category: 'inserted',
      ...layout,
      ranges: [],
      paramNames: [...new Set(params.keys())].sort(),
    };
    const items = (ap || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (items.length === 0) return source;

    const { bytesPerSecond, totalBytes, audioOffset } = layout;
    if (!bytesPerSecond || totalBytes === null || audioOffset === null) return { ...source, error: 'missing-params' };

    const ranges = [];
    for (const item of items) {
      const match = RANGE.exec(item);
      if (!match) return { ...source, error: 'malformed-range' };
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (start >= end || start < audioOffset || end > totalBytes) return { ...source, error: 'range-outside-file' };
      ranges.push([start, end]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] < ranges[i - 1][1]) return { ...source, error: 'overlapping-ranges' };
    }
    return { ...source, ranges };
  }

  root.AdSkip.hosts.register({ id: 'audiomeans', matches, parse });
})(globalThis);
