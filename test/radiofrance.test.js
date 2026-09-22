const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const { build } = require('./stitched.js');
const {
  RADIOFRANCE_URL,
  RADIOFRANCE_SOURCE_URL,
  RADIOFRANCE_REDIRECT,
  STITCHED_URL,
} = require('./fixtures.js');

const { hosts } = load('lib/stitching.js', 'lib/hosts.js', 'hosts/radiofrance.js');

// Answers the way the CDN does when the page is on another origin: a partial
// response carries no Content-Range that script can read, so the size is only
// ever available from a HEAD.
function serve(files) {
  return (url, options = {}) => {
    const file = files[url];
    if (!file) return Promise.resolve(new Response('', { status: 404 }));
    if (options.method === 'HEAD') {
      return Promise.resolve(new Response('', { status: 200, headers: { 'Content-Length': String(file.length) } }));
    }
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range);
    const slice = file.subarray(Number(from), Math.min(file.length, Number(to) + 1));
    return Promise.resolve(new Response(slice, { status: 206 }));
  };
}

// Each test gets its own address: lib/hosts.js works an address out once and
// keeps the answer, on purpose.
function variant(name) {
  return RADIOFRANCE_URL.replace('/ts/podcast09/', `/ts/podcast09/${name}-`);
}

function resolved(address) {
  return new Promise((done) => {
    hosts.onResolved((resolvedAddress, source) => {
      if (resolvedAddress === address) done(source);
    });
  });
}

test('only claims the stitched file, not the address that redirects to it', () => {
  assert.equal(hosts.parse(RADIOFRANCE_REDIRECT), null);
  assert.equal(hosts.parse(RADIOFRANCE_SOURCE_URL), null);
  assert.equal(hosts.parse(STITCHED_URL), null, 'another host is left to its own adapter');
  assert.equal(hosts.parse('not a url'), null);
});

test('recognises a stitched file and says it has to be looked at', () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response('', { status: 404 }));
  try {
    const source = hosts.parse(variant('shape'));
    assert.equal(source.host, 'radiofrance');
    assert.equal(source.unit, 'bytes');
    assert.equal(source.category, 'inserted');
    assert.equal(source.pending, true);
    assert.ok(source.paramNames.includes('podcast'));
    assert.ok(source.paramNames.includes('providerTargetspot'));
  } finally {
    globalThis.fetch = original;
  }
});

test('works the ads out of the pair of files, then keeps the answer', async () => {
  const files = build({ sourceTag: 12_341, servedTag: 57_154, ads: [{ at: 0, length: 472_513 }] });
  const original = globalThis.fetch;
  const url = variant('pair');
  globalThis.fetch = serve({ [RADIOFRANCE_SOURCE_URL]: files.source, [url]: files.served });

  try {
    const waiting = resolved(url);
    assert.equal(hosts.parse(url).pending, true);
    const source = await waiting;

    assert.equal(source.host, 'radiofrance');
    assert.equal(source.pending, undefined);
    assert.equal(source.error, undefined);
    assert.deepEqual(source.ranges, [[57_154, 57_154 + 472_513]]);
    assert.equal(source.audioOffset, 57_154);
    assert.equal(source.bytesPerSecond, 16_000);
    assert.equal(source.totalBytes, files.served.length);

    // Asking again answers from what was already worked out.
    globalThis.fetch = () => assert.fail('the pair of files was read a second time');
    assert.deepEqual(hosts.parse(url).ranges, source.ranges);
  } finally {
    globalThis.fetch = original;
  }
});

test('says why rather than guess when the original file is gone', async () => {
  const files = build({ ads: [{ at: 0, length: 472_513 }] });
  const url = variant('gone');
  const original = globalThis.fetch;
  globalThis.fetch = serve({ [url]: files.served });

  try {
    const waiting = resolved(url);
    hosts.parse(url);
    const source = await waiting;
    assert.equal(source.error, 'http-404');
    assert.deepEqual(source.ranges, []);
  } finally {
    globalThis.fetch = original;
  }
});
