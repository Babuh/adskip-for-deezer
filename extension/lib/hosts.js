(function (root) {
  'use strict';

  // Each podcast host has an adapter that knows how to read its audio URLs.
  // docs/adding-a-host.md describes what an adapter returns.
  const adapters = [];

  function register(adapter) {
    adapters.push(adapter);
  }

  function parse(address) {
    let url;
    try {
      url = new URL(address);
    } catch {
      return null;
    }
    for (const adapter of adapters) {
      if (!adapter.matches(url)) continue;
      const source = adapter.parse(url);
      if (source) return { host: adapter.id, ...source };
    }
    return null;
  }

  root.AdSkip = root.AdSkip || {};
  root.AdSkip.hosts = { register, parse };
})(globalThis);
