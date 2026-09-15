const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const { DURATION } = require('./fixtures.js');

const { timing } = load('lib/timing.js');

const SOURCE = {
  unit: 'bytes',
  category: 'inserted',
  ranges: [
    [103591, 585080],
    [10792063, 11273134],
  ],
  bytesPerSecond: 16001,
  totalBytes: 102593457,
  audioOffset: 103590,
};

const round = (value, digits = 2) => Number(value.toFixed(digits));

test('converts bytes to seconds with the observed values', () => {
  assert.equal(round(timing.toSeconds(103591, SOURCE)), 0);
  assert.equal(round(timing.toSeconds(585080, SOURCE)), 30.09);
  assert.equal(round(timing.toSeconds(10792063, SOURCE)), 667.99);
  assert.equal(round(timing.toSeconds(11273134, SOURCE)), 698.05);
});

test('computes the duration announced by the URL', () => {
  assert.equal(round(timing.expectedDuration(SOURCE), 1), DURATION);
});

test('uses the declared bitrate when the durations agree', () => {
  const calibration = timing.calibrate(SOURCE, DURATION + 1.5);
  assert.equal(calibration.ok, true);
  assert.equal(calibration.method, 'declared');
  assert.equal(calibration.bytesPerSecond, 16001);
});

test('falls back to the measured bitrate when it is a standard one', () => {
  // A browser counting the ID3 tag as audio would report this duration.
  const calibration = timing.calibrate(SOURCE, 102593457 / 16000);
  assert.equal(calibration.ok, true);
  assert.equal(calibration.method, 'measured');
  assert.equal(Math.round((calibration.bytesPerSecond * 8) / 1000), 128);
});

test('gives up when the durations disagree and the bitrate is not standard', () => {
  const calibration = timing.calibrate(SOURCE, 5000);
  assert.equal(calibration.ok, false);
  assert.equal(calibration.reason, 'duration-mismatch');
});

test('gives up without a usable duration', () => {
  for (const duration of [NaN, Infinity, 0, -1]) {
    assert.equal(timing.calibrate(SOURCE, duration).reason, 'unknown-duration', String(duration));
  }
});

test('gives up without a bitrate', () => {
  assert.equal(timing.calibrate({ ...SOURCE, bytesPerSecond: null }, DURATION).reason, 'missing-params');
});

test('places the observed ads on the timeline', () => {
  const result = timing.resolveBreaks(SOURCE, DURATION);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.breaks.map(({ start, end, category }) => [round(start), round(end), category]),
    [
      [0, 30.09, 'inserted'],
      [667.99, 698.05, 'inserted'],
    ],
  );
});

test('accepts an episode without ads, even before the duration is known', () => {
  const result = timing.resolveBreaks({ ...SOURCE, ranges: [] }, NaN);
  assert.equal(result.ok, true);
  assert.deepEqual(result.breaks, []);
});

test('rejects breaks that are too short to be ads', () => {
  const result = timing.resolveBreaks({ ...SOURCE, ranges: [[103591, 103700]] }, DURATION);
  assert.equal(result.reason, 'implausible-length');
});

test('rejects episodes that would be mostly ads', () => {
  const ranges = [];
  for (let i = 0; i < 7; i++) {
    const start = 103590 + i * (500 * 16001 + 16001);
    ranges.push([start, start + 500 * 16001]);
  }
  assert.equal(timing.resolveBreaks({ ...SOURCE, ranges }, DURATION).reason, 'too-much-ad-time');
});

test('accepts ranges given in seconds', () => {
  const source = { unit: 'seconds', category: 'inserted', ranges: [[120, 150]] };
  const result = timing.resolveBreaks(source, 3600);
  assert.equal(result.ok, true);
  assert.deepEqual(result.breaks, [{ start: 120, end: 150, category: 'inserted' }]);
});

test('rejects breaks past the end or overlapping', () => {
  const past = { unit: 'seconds', category: 'inserted', ranges: [[3590, 3620]] };
  assert.equal(timing.resolveBreaks(past, 3600).reason, 'outside-episode');
  const overlapping = { unit: 'seconds', category: 'inserted', ranges: [[10, 50], [40, 80]] };
  assert.equal(timing.resolveBreaks(overlapping, 3600).reason, 'overlapping');
});

test('matches a URL to a player by duration', () => {
  assert.equal(timing.matchesDuration(SOURCE, DURATION), true);
  assert.equal(timing.matchesDuration(SOURCE, 3000), false);
  assert.equal(timing.matchesDuration({ unit: 'seconds', ranges: [] }, DURATION), false);
});
