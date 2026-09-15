const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const { STITCHED_URL, withParams } = require('./fixtures.js');

const { hosts } = load('lib/hosts.js', 'hosts/audiomeans.js');

test('reads the ad ranges and file layout of a stitched file', () => {
  const source = hosts.parse(STITCHED_URL);
  assert.equal(source.host, 'audiomeans');
  assert.equal(source.unit, 'bytes');
  assert.equal(source.category, 'inserted');
  assert.deepEqual(source.ranges, [
    [103591, 585080],
    [10792063, 11273134],
  ]);
  assert.equal(source.bytesPerSecond, 16001);
  assert.equal(source.totalBytes, 102593457);
  assert.equal(source.audioOffset, 103590);
  assert.equal(source.error, undefined);
});

test('accepts a single ad', () => {
  const source = hosts.parse(withParams({ ap: '103591-585080' }));
  assert.deepEqual(source.ranges, [[103591, 585080]]);
});

test('accepts any number of ads, in any order', () => {
  const source = hosts.parse(withParams({ ap: '50000000-50480030,103591-585080,10792063-11273134' }));
  assert.deepEqual(source.ranges, [
    [103591, 585080],
    [10792063, 11273134],
    [50000000, 50480030],
  ]);
});

test('returns no ads when ap is empty or missing', () => {
  assert.deepEqual(hosts.parse(withParams({ ap: '' })).ranges, []);
  assert.deepEqual(hosts.parse(withParams({ ap: null })).ranges, []);
});

test('ignores empty items and spaces in ap', () => {
  const source = hosts.parse(withParams({ ap: ' 103591-585080 ,' }));
  assert.deepEqual(source.ranges, [[103591, 585080]]);
  assert.equal(source.error, undefined);
});

test('ignores URLs from other hosts', () => {
  assert.equal(hosts.parse(STITCHED_URL.replace('files.audiomeans.fr', 'cdn.example.com')), null);
  assert.equal(hosts.parse(STITCHED_URL.replace('audiomeans.fr', 'notaudiomeans.fr')), null);
});

test('ignores audiomeans URLs that are not stitched files', () => {
  assert.equal(hosts.parse('https://podcasts.audiomeans.fr/show/episode.mp3'), null);
});

test('ignores anything that is not a URL', () => {
  assert.equal(hosts.parse(''), null);
  assert.equal(hosts.parse('not a url'), null);
  assert.equal(hosts.parse('blob:https://www.deezer.com/8c1c2a4e'), null);
});

test('reports ads it cannot place because the layout is missing', () => {
  for (const name of ['o1', 'o2', 'o3']) {
    assert.equal(hosts.parse(withParams({ [name]: null })).error, 'missing-params', name);
  }
  assert.equal(hosts.parse(withParams({ o1: '0' })).error, 'missing-params');
  assert.equal(hosts.parse(withParams({ o1: 'abc' })).error, 'missing-params');
});

test('reports malformed ranges', () => {
  for (const ap of ['abc', '103591-', '-585080', '103591_585080', '1.5-2.5']) {
    assert.equal(hosts.parse(withParams({ ap })).error, 'malformed-range', ap);
  }
});

test('reports ranges outside the file', () => {
  assert.equal(hosts.parse(withParams({ ap: '100-585080' })).error, 'range-outside-file');
  assert.equal(hosts.parse(withParams({ ap: '103591-999999999' })).error, 'range-outside-file');
  assert.equal(hosts.parse(withParams({ ap: '585080-103591' })).error, 'range-outside-file');
});

test('reports overlapping ranges', () => {
  const source = hosts.parse(withParams({ ap: '103591-585080,500000-900000' }));
  assert.equal(source.error, 'overlapping-ranges');
});

test('lists parameter names without their values', () => {
  const { paramNames } = hosts.parse(STITCHED_URL);
  assert.ok(paramNames.includes('ap'));
  assert.ok(paramNames.includes('Signature'));
  assert.ok(!paramNames.some((name) => name.includes('EXAMPLE')));
});
