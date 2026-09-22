const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const {
  ACAST_HASH,
  ACAST_URL,
  ACAST_MANIFEST_URL,
  ACAST_MANIFEST,
  ACAST_REDIRECT,
  ACAST_DURATION,
  STITCHED_URL,
} = require('./fixtures.js');

const { hosts, timing } = load('lib/timing.js', 'lib/hosts.js', 'hosts/acast.js');

// Each test gets its own address: lib/hosts.js works one out only once.
function variant(name) {
  return {
    media: ACAST_URL.replace(ACAST_HASH, name + ACAST_HASH.slice(name.length)),
    manifest: ACAST_MANIFEST_URL.replace(ACAST_HASH, name + ACAST_HASH.slice(name.length)),
    hash: name + ACAST_HASH.slice(name.length),
  };
}

function serve(body, status = 200) {
  return (url, options) => {
    assert.equal(options.credentials, 'omit', 'the manifest is read without cookies');
    return Promise.resolve(
      new Response(status === 200 ? JSON.stringify(body) : '', {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
}

function resolved(address) {
  return new Promise((done) => {
    hosts.onResolved((at, source) => {
      if (at === address) done(source);
    });
  });
}

async function work(name, body, status) {
  const where = variant(name);
  // The manifest carries the hash of the file it describes, so a fixture
  // reused under another address has to carry that address's hash too.
  const served =
    body && body.sourceList && body.hash === ACAST_HASH ? { ...body, hash: where.hash } : body;
  const original = globalThis.fetch;
  let asked = null;
  globalThis.fetch = (url, options) => {
    asked = url;
    return serve(served, status)(url, options);
  };
  try {
    const waiting = resolved(where.media);
    const first = hosts.parse(where.media);
    return { first, source: await waiting, asked, where };
  } finally {
    globalThis.fetch = original;
  }
}

test('only claims the assembled file', () => {
  assert.equal(hosts.parse(ACAST_REDIRECT), null, 'the address that redirects is left alone');
  assert.equal(hosts.parse('https://stitcher2.acast.com/livestitches/' + ACAST_HASH + '.json'), null);
  assert.equal(hosts.parse(STITCHED_URL), null, 'another host is left to its own adapter');
  assert.equal(hosts.parse('not a url'), null);
});

test('reads the manifest that sits next to the file, with no signature', async () => {
  const { first, source, asked, where } = await work('b', ACAST_MANIFEST);
  assert.equal(first.host, 'acast');
  assert.equal(first.pending, true);
  assert.equal(asked, where.manifest, 'same path as the file, with a .json extension');
  assert.equal(source.error, undefined);
  assert.equal(source.unit, 'seconds');
  assert.equal(source.category, 'inserted');
});

test('joins the ads and the stings around them into one break each', async () => {
  const { source } = await work('c', ACAST_MANIFEST);
  const rounded = source.ranges.map(([start, end]) => [+start.toFixed(2), +end.toFixed(2)]);
  assert.deepEqual(rounded, [
    [0, 15.1],
    [2796.88, 2862.22],
    [3814.47, 3849.13],
    [4522.71, 4545.39],
  ]);
});

test('the breaks it finds survive the checks and land on the timeline', async () => {
  const { source } = await work('d', ACAST_MANIFEST);
  const result = timing.resolveBreaks(source, ACAST_DURATION);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.breaks.length, 4);
  assert.equal(result.breaks[0].start, 0);
  assert.equal(result.calibration, null, 'seconds need no calibration');
  const skipped = result.breaks.reduce((total, ad) => total + (ad.end - ad.start), 0);
  assert.ok(Math.abs(skipped - 137.78) < 0.01, `${skipped} seconds of ads`);
});

test('refuses a manifest that describes another episode', async () => {
  const { source } = await work('e', ACAST_MANIFEST);
  const result = timing.resolveBreaks(source, ACAST_DURATION + 120);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'duration-mismatch');
});

test('reports an episode with nothing inserted', async () => {
  const clean = {
    hash: variant('f').hash,
    sourceList: [{ type: 'source', start: 0, end: 3600, duration: 3600 }],
  };
  const { source } = await work('f', clean);
  assert.deepEqual(source.ranges, []);
  assert.equal(source.duration, 3600);
});

test('says why rather than guess when the manifest is wrong or missing', async () => {
  const missing = await work('g', null, 404);
  assert.equal(missing.source.error, 'http-404');

  const other = await work('h', { ...ACAST_MANIFEST, hash: 'e'.repeat(32) });
  assert.equal(other.source.error, 'wrong-manifest');

  const empty = await work('i', { sourceList: [] });
  assert.equal(empty.source.error, 'no-source-list');

  const broken = await work('j', {
    sourceList: [{ type: 'ad', start: 10, end: 'soon', duration: 5 }],
  });
  assert.equal(broken.source.error, 'malformed-segment');
});
