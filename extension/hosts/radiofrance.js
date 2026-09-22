(function (root) {
  'use strict';

  // Radio France serves Deezer a file with the ads already stitched in, under
  // a /ts/<hash>/ prefix, and says nothing about them in the URL: its query
  // string only carries targeting and metadata. What it does carry is the
  // name of the original episode, in `podcast`, and that file stays reachable
  // on the same domain without the prefix. Comparing the two is what tells
  // where the ads are. docs/how-it-works.md has the details.
  const { stitching } = root.AdSkip;

  function matches(url) {
    return url.hostname === 'media.radiofrance-podcast.net';
  }

  function parse(url) {
    const podcast = url.searchParams.get('podcast');
    // The address the player is given redirects here; only the stitched file
    // carries the prefix and the name of the original.
    if (!podcast || !url.pathname.startsWith('/ts/')) return null;

    let original;
    try {
      original = new URL('/' + podcast.replace(/^\/+/, ''), url.origin);
    } catch {
      return null;
    }
    if (original.origin !== url.origin || original.href === url.href) return null;

    return {
      unit: 'bytes',
      category: 'inserted',
      // Nothing can be said before the two files have been compared, which
      // takes a handful of range requests. lib/hosts.js runs this once and
      // keeps the answer.
      pending: true,
      paramNames: [...new Set(url.searchParams.keys())].sort(),
      resolve: (tools) =>
        stitching.locate({ stitched: url.href, source: original.href, onPartial: tools.onPartial }),
    };
  }

  root.AdSkip.hosts.register({ id: 'radiofrance', matches, parse });
})(globalThis);
