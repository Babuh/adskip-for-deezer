const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const { build, reader, id3, filler, BYTES_PER_SECOND } = require('./stitched.js');

const { stitching } = load('lib/stitching.js');

const SOURCE = 'https://example.test/episode.mp3';
const SERVED = 'https://example.test/ts/hash/episode.mp3';

async function locate(options) {
  const files = build(options);
  const { fetchSize, fetchRange, stats } = reader({ [SOURCE]: files.source, [SERVED]: files.served });
  const result = await stitching.locate({ source: SOURCE, stitched: SERVED, fetchSize, fetchRange });
  return { result, files, stats };
}

test('reads the file layout from the served file', async () => {
  const { result, files } = await locate({ ads: [{ at: 0, length: 480_000 }] });
  assert.equal(result.unit, 'bytes');
  assert.equal(result.audioOffset, files.servedTag);
  assert.equal(result.totalBytes, files.served.length);
  assert.equal(result.bytesPerSecond, BYTES_PER_SECOND);
});

test('finds a pre-roll, and reads very little to do it', async () => {
  const { result, files, stats } = await locate({ ads: [{ at: 0, length: 480_000 }] });
  assert.deepEqual(result.ranges, files.expected);
  assert.ok(stats.bytes < 100_000, `read ${stats.bytes} bytes`);
});

test('finds a mid-roll', async () => {
  const { result, files } = await locate({ ads: [{ at: 1_200_000, length: 472_513 }] });
  assert.deepEqual(result.ranges, files.expected);
});

test('finds a pre-roll and a mid-roll together', async () => {
  const { result, files } = await locate({
    ads: [
      { at: 0, length: 481_489 },
      { at: 1_500_000, length: 481_071 },
    ],
  });
  assert.deepEqual(result.ranges, files.expected);
});

test('finds several mid-rolls', async () => {
  const { result, files } = await locate({
    ads: [
      { at: 400_000, length: 320_000 },
      { at: 1_400_000, length: 480_000 },
      { at: 2_400_000, length: 160_000 },
    ],
  });
  assert.deepEqual(result.ranges, files.expected);
});

test('reports no ads when the two files carry the same audio', async () => {
  const { result } = await locate({ ads: [] });
  assert.deepEqual(result.ranges, []);
});

test('places a break exactly, whatever the size of the tags', async () => {
  const { result } = await locate({ sourceTag: 12_341, servedTag: 57_154, ads: [{ at: 999_999, length: 472_513 }] });
  assert.deepEqual(result.ranges, [[57_154 + 999_999, 57_154 + 999_999 + 472_513]]);
});

test('gives up when the file served is smaller than the original', async () => {
  const files = build({ ads: [{ at: 0, length: 480_000 }] });
  const { fetchSize, fetchRange } = reader({ [SOURCE]: files.served, [SERVED]: files.source });
  await assert.rejects(
    stitching.locate({ source: SOURCE, stitched: SERVED, fetchSize, fetchRange }),
    /source-not-smaller/,
  );
});

test('gives up when the two files have nothing in common', async () => {
  const other = Buffer.concat([id3(2048), filler(3_480_000, 7)]);
  const files = build({ ads: [{ at: 0, length: 480_000 }] });
  const { fetchSize, fetchRange } = reader({ [SOURCE]: files.source, [SERVED]: new Uint8Array(other) });
  await assert.rejects(
    stitching.locate({ source: SOURCE, stitched: SERVED, fetchSize, fetchRange }),
    /no-common-(head|tail)/,
  );
});

test('gives up rather than guess when a file cannot be read', async () => {
  const files = build({ ads: [{ at: 0, length: 480_000 }] });
  const { fetchSize, fetchRange } = reader({ [SERVED]: files.served });
  await assert.rejects(stitching.locate({ source: SOURCE, stitched: SERVED, fetchSize, fetchRange }), /http-404/);
});

test('finds a post-roll, which leaves the file ending on an ad', async () => {
  const { result, files } = await locate({ ads: [{ at: 3_000_000, length: 240_744 }] });
  assert.deepEqual(result.ranges, files.expected);
});

test('finds a pre-roll, a mid-roll and a post-roll together', async () => {
  const { result, files } = await locate({
    ads: [
      { at: 0, length: 481_907 },
      { at: 1_400_000, length: 1_125_980 },
      { at: 3_000_000, length: 240_744 },
    ],
  });
  assert.deepEqual(result.ranges, files.expected);
});

test('compares past the header frame, which a stitcher rewrites', async () => {
  // The first bytes of the original appear nowhere in the served file, the
  // way a Xing header frame does not survive being stitched.
  const files = build({ ads: [{ at: 0, length: 481_907 }] });
  files.served.set(new Uint8Array(64).fill(0x77), files.servedTag);
  const { fetchSize, fetchRange } = reader({ [SOURCE]: files.source, [SERVED]: files.served });
  const result = await stitching.locate({ source: SOURCE, stitched: SERVED, fetchSize, fetchRange });
  assert.deepEqual(result.ranges, files.expected);
});

test('reads the ID3 length, footer included', () => {
  assert.equal(stitching.id3Length(id3(57_154)), 57_154);
  assert.equal(stitching.id3Length(new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0, 0, 0])), 0);
});

test('reads the bitrate from the first frame', () => {
  assert.equal(stitching.readBitrate(new Uint8Array([0xff, 0xfb, 0x90, 0x00])), 16_000);
  assert.equal(stitching.readBitrate(new Uint8Array([0xff, 0xfb, 0x50, 0x00])), 8_000);
  assert.equal(stitching.readBitrate(new Uint8Array([0x00, 0x00, 0x00, 0x00])), null);
});

test('hands over both ends before it has looked for the middle', async () => {
  const files = build({
    ads: [
      { at: 0, length: 481_907 },
      { at: 1_400_000, length: 1_125_980 },
      { at: 3_000_000, length: 240_744 },
    ],
  });
  const { fetchSize, fetchRange } = reader({ [SOURCE]: files.source, [SERVED]: files.served });

  const steps = [];
  const result = await stitching.locate({
    source: SOURCE,
    stitched: SERVED,
    fetchSize,
    fetchRange,
    onPartial: (partial) => steps.push(partial.ranges.map(([start]) => start)),
  });

  assert.ok(steps.length >= 2, 'it speaks up more than once');
  assert.deepEqual(steps[0], [files.expected[0][0], files.expected[2][0]], 'the pre-roll and post-roll come first');
  assert.deepEqual(result.ranges, files.expected);
  assert.deepEqual(steps[steps.length - 1], files.expected.map(([start]) => start));

  // Every partial must be usable on its own: in order and never overlapping.
  for (const starts of steps) {
    assert.deepEqual([...starts].sort((a, b) => a - b), starts);
  }
});

test('says nothing partial when there is nothing to say', async () => {
  const files = build({ ads: [] });
  const { fetchSize, fetchRange } = reader({ [SOURCE]: files.source, [SERVED]: files.served });
  const steps = [];
  const result = await stitching.locate({
    source: SOURCE,
    stitched: SERVED,
    fetchSize,
    fetchRange,
    onPartial: (partial) => steps.push(partial),
  });
  assert.deepEqual(result.ranges, []);
  assert.equal(steps.length, 0);
});

test('says what a failed comparison cost, not only that it failed', async () => {
  const other = Buffer.concat([id3(2048), filler(3_480_000, 7)]);
  const files = build({ ads: [{ at: 0, length: 480_000 }] });
  const { fetchSize, fetchRange } = reader({ [SOURCE]: files.source, [SERVED]: new Uint8Array(other) });

  await assert.rejects(
    stitching.locate({ source: SOURCE, stitched: SERVED, fetchSize, fetchRange }),
    (error) => {
      assert.ok(error.probes > 0, 'it says how many requests it made');
      assert.ok(error.bytes > 0, 'and how much it read');
      return true;
    },
  );
});

// Stands in for a host that builds an assembly as it is listened to: the
// start is there, anything past it is refused.
function readableUpTo(files, limit) {
  const { fetchSize, fetchRange } = reader(files);
  return {
    fetchSize,
    fetchRange: (url, start, length) => {
      if (url === SERVED && start >= limit) return Promise.reject(new Error('redirected-or-unreachable'));
      return fetchRange(url, start, length);
    },
  };
}

test('still skips the pre-roll when the end of the file cannot be read', async () => {
  const files = build({
    ads: [
      { at: 0, length: 481_907 },
      { at: 1_400_000, length: 1_125_980 },
      { at: 3_000_000, length: 240_744 },
    ],
  });
  const transport = readableUpTo({ [SOURCE]: files.source, [SERVED]: files.served }, 1_500_000);

  const result = await stitching.locate({ source: SOURCE, stitched: SERVED, ...transport });
  assert.equal(result.incomplete, 'unreadable-end');
  assert.deepEqual(result.ranges, [files.expected[0]], 'the pre-roll, placed exactly');
  assert.equal(result.audioOffset, files.servedTag);
});

test('reports nothing rather than a guess when the start is unreadable too', async () => {
  const files = build({ ads: [{ at: 0, length: 481_907 }] });
  const transport = readableUpTo({ [SOURCE]: files.source, [SERVED]: files.served }, 8192);
  await assert.rejects(
    stitching.locate({ source: SOURCE, stitched: SERVED, ...transport }),
    /redirected-or-unreachable|no-common-head/,
  );
});
