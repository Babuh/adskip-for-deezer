(function (root) {
  'use strict';

  // Each podcast host has an adapter that knows how to read its audio URLs.
  // docs/adding-a-host.md describes what an adapter returns.
  const adapters = [];

  // An adapter that can't tell everything from the URL alone returns a
  // pending source and a way to finish the job. Since parse() is called again
  // on every metadata event, the work is started once per address and the
  // answer is kept here; whoever asked is told when it lands. An address that
  // didn't work out isn't tried again either: a file that can't be read is
  // usually not going to become readable, and reloading the page starts over.
  const answers = new Map();
  const started = new Set();
  const listeners = new Set();
  const MAX_ANSWERS = 10;

  // What an adapter may need beyond plain fetch, such as a way to read a file
  // the page itself is not allowed to. Whoever runs the adapters provides it.
  let tools = {};

  function useTools(available) {
    tools = available || {};
  }

  // Turned off, the extension reads nothing at all. The switch in the popup
  // has to mean that and not merely "stop moving the playhead", or there is
  // no way to find out whether the extension is behind something.
  let paused = false;

  function pause(value) {
    paused = Boolean(value);
  }

  function register(adapter) {
    adapters.push(adapter);
  }

  function onResolved(listener) {
    listeners.add(listener);
  }

  function remember(address, source) {
    answers.set(address, source);
    for (const key of answers.keys()) {
      if (answers.size <= MAX_ANSWERS) break;
      answers.delete(key);
      started.delete(key);
    }
    for (const listener of listeners) {
      // One listener throwing must not keep the others from hearing about it.
      try {
        listener(address, source);
      } catch {
        /* ignore */
      }
    }
  }

  function start(address, source) {
    if (started.has(address)) return;
    started.add(address);
    const { resolve, pending, ...rest } = source;
    // How long it took is worth keeping: a pre-roll plays for exactly as long
    // as this, so a slow answer is a thing to see rather than to guess at.
    const began = Date.now();
    Promise.resolve()
      .then(() => resolve(tools))
      .then((result) => ({ ...rest, ...result }))
      .catch((error) => ({
        ...rest,
        ranges: [],
        error: (error && error.message) || 'analysis-failed',
        probes: (error && error.probes) || 0,
        bytes: (error && error.bytes) || 0,
      }))
      .then((answer) => remember(address, { ...answer, ms: Date.now() - began }));
  }

  function parse(address) {
    if (answers.has(address)) return answers.get(address);
    let url;
    try {
      url = new URL(address);
    } catch {
      return null;
    }
    for (const adapter of adapters) {
      if (!adapter.matches(url)) continue;
      const source = adapter.parse(url);
      if (!source) continue;
      const found = { host: adapter.id, ...source };
      if (found.pending && !paused) start(address, found);
      return found;
    }
    return null;
  }

  root.AdSkip = root.AdSkip || {};
  root.AdSkip.hosts = { register, parse, onResolved, useTools, pause };
})(globalThis);
