const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const { build } = require('./stitched.js');
const {
  SIMPLECAST_URL,
  SIMPLECAST_REDIRECT,
  SIMPLECAST_API,
  SIMPLECAST_CDN,
  SIMPLECAST_EPISODE_JSON,
  SIMPLECAST_TOTAL,
  STITCHED_URL,
} = require('./fixtures.js');

const { hosts, timing } = load('lib/timing.js', 'lib/stitching.js', 'lib/hosts.js', 'hosts/simplecast.js');

const SOURCE = SIMPLECAST_CDN + '.mp3';

// The URL states the length of the assembly it names, in two places, and the
// adapter believes it rather than asking. A fixture has to be consistent with
// the file it stands for, exactly as the real thing is.
function variant(name, total) {
  const url = SIMPLECAST_URL.replace('default.mp3_placeholder', `default.mp3_${name}`);
  return total ? url.split(String(SIMPLECAST_TOTAL)).join(String(total)) : url;
}

// What the adapter actually reads: the assembly's own address, stripped of
// the listening session and everything else the query carries.
function bare(address) {
  return address.split('?')[0];
}

// Waits for the complete answer: a partial one arrives first now, and it is
// deliberately not the one these tests are about.
function resolved(address) {
  return new Promise((done) => {
    hosts.onResolved((at, source) => {
      if (at === address && !source.partial) done(source);
    });
  });
}

// The assembled file behaves the way the real CDN does when a page asks for
// it: the read simply fails. Only the background gets through. The original,
// on the content CDN, answers normally.
function world(files, episode = SIMPLECAST_EPISODE_JSON) {
  const seen = { page: [], background: [], sized: [] };

  const page = (url, options = {}) => {
    seen.page.push(url);
    if (url.startsWith(SIMPLECAST_API)) {
      return Promise.resolve(new Response(JSON.stringify(episode), { status: 200 }));
    }
    const file = files[url];
    if (!file) return Promise.reject(new TypeError('Failed to fetch'));
    if (options.method === 'HEAD') {
      seen.sized.push(url);
      return Promise.resolve(new Response('', { status: 200, headers: { 'Content-Length': String(file.length) } }));
    }
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
    return Promise.resolve(
      new Response(file.subarray(Number(from), Math.min(file.length, Number(to) + 1)), { status: 206 }),
    );
  };

  const background = {
    fetchSize(url) {
      seen.background.push(url);
      seen.sized.push(url);
      const file = files[url];
      return file ? Promise.resolve(file.length) : Promise.reject(new Error('http-404'));
    },
    fetchRange(url, start, length) {
      seen.background.push(url);
      const file = files[url];
      if (!file) return Promise.reject(new Error('http-404'));
      return Promise.resolve(file.subarray(start, Math.min(file.length, start + length)));
    },
  };

  return { page, background, seen };
}

async function work(name, built, overrides = {}, options = {}) {
  const address = variant(name, built && built.served.length);
  const files = {};
  if (built) files[bare(address)] = built.served;
  if (built && !options.dropSource) files[SOURCE] = built.source;
  const episode = {
    ...SIMPLECAST_EPISODE_JSON,
    audio_file_size: built ? built.source.length : 0,
    ...overrides,
  };
  const { page, background, seen } = world(files, episode);
  const original = globalThis.fetch;
  globalThis.fetch = page;
  hosts.useTools({ background });
  try {
    const waiting = resolved(address);
    const first = hosts.parse(address);
    return { first, source: await waiting, seen, address };
  } finally {
    globalThis.fetch = original;
    hosts.useTools({});
  }
}

test('only claims an assembled file, never the address that redirects to it', () => {
  assert.equal(hosts.parse(SIMPLECAST_REDIRECT), null);
  assert.equal(hosts.parse(SOURCE), null);
  assert.equal(hosts.parse(STITCHED_URL), null, 'another host is left to its own adapter');
  assert.equal(hosts.parse('not a url'), null);
});

test('reads the played file through the background and the original from the page', async () => {
  const files = build({ sourceTag: 2048, servedTag: 4096, ads: [{ at: 1_000_000, length: 480_000 }] });
  const { source, seen, address } = await work('a', files);

  assert.equal(source.error, undefined, source.error);
  assert.deepEqual(source.ranges, files.expected);

  assert.ok(
    seen.background.every((url) => url === bare(address)),
    'only the played file goes through the background',
  );
  assert.ok(seen.page.includes(SIMPLECAST_API), 'the episode is looked up from the page');
  assert.ok(seen.page.some((url) => url === SOURCE), 'the original is read from the page');
  assert.ok(!seen.page.includes(address), 'the played file is never asked for from the page');
  assert.ok(
    seen.background.every((url) => !url.includes('listeningSessionID')),
    'the listening session is never handed back to the server',
  );
});

test('never asks the played file how long it is', async () => {
  const files = build({ sourceTag: 2048, servedTag: 4096, ads: [{ at: 0, length: 480_000 }] });
  const { source, seen, address } = await work('b', files);

  assert.equal(source.error, undefined, source.error);
  // A HEAD on that address lands on another assembly, so the size can only
  // come from the URL itself.
  assert.equal(source.totalBytes, files.served.length);
  assert.ok(!seen.page.includes(address));
  assert.equal(seen.sized.length, 0, 'no size was ever asked for');
});

test('finds the original from the stored path when there is no waveform', async () => {
  const files = build({ sourceTag: 2048, servedTag: 4096, ads: [{ at: 500_000, length: 320_000 }] });
  const { source, seen } = await work('c', files, { waveform_json: null });
  assert.equal(source.error, undefined, source.error);
  assert.deepEqual(source.ranges, files.expected);
  assert.ok(seen.page.some((url) => url === SOURCE));
});

test('the breaks it finds survive the checks', async () => {
  const files = build({ sourceTag: 2048, servedTag: 4096, ads: [{ at: 0, length: 480_000 }] });
  const { source } = await work('d', files);

  const duration = (files.served.length - 4096) / 16_000;
  const result = timing.resolveBreaks(source, duration);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.breaks.length, 1);
  assert.equal(result.breaks[0].start, 0);
  assert.ok(Math.abs(result.breaks[0].end - 30) < 0.01);
});

test('says why rather than guess when something is missing', async () => {
  const files = build({ sourceTag: 2048, servedTag: 4096, ads: [{ at: 0, length: 480_000 }] });

  const noOriginal = await work('e', files, { waveform_json: null, audio_file_path_tc: null });
  assert.equal(noOriginal.source.error, 'no-original-file');

  const unreachable = await work('f', files, {}, { dropSource: true });
  assert.equal(unreachable.source.error, 'redirected-or-unreachable', 'the original could not be read');
});

test('gives up when nothing can read the played file for it', async () => {
  const address = variant('g');
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  hosts.useTools({});
  try {
    const waiting = resolved(address);
    hosts.parse(address);
    const source = await waiting;
    assert.equal(source.error, 'no-background');
    assert.deepEqual(source.ranges, []);
  } finally {
    globalThis.fetch = original;
  }
});
