const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const { skipper } = load('lib/skipper.js');

const BREAKS = [
  { start: 0, end: 30.09 },
  { start: 667.99, end: 698.05 },
];

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);
}

test('skips a pre-roll starting at zero', () => {
  const hit = skipper.createSkipper(BREAKS).check(0, 0);
  near(hit.to, 30.09 + skipper.GUARD_OUT);
  assert.equal(hit.retry, false);
});

test('skips a mid-roll when playback reaches it', () => {
  const s = skipper.createSkipper(BREAKS);
  assert.equal(s.check(660, 0), null);
  assert.equal(s.check(667.8, 250), null);
  const hit = s.check(667.9, 500);
  assert.equal(hit.ad, BREAKS[1]);
  near(hit.to, 698.05 + skipper.GUARD_OUT);
});

test('leaves the last fraction of a break alone', () => {
  assert.equal(skipper.createSkipper(BREAKS).check(697.9, 0), null);
});

test('skips when the user seeks into the middle of a break', () => {
  const hit = skipper.createSkipper(BREAKS).check(680, 0);
  near(hit.to, 698.05 + skipper.GUARD_OUT);
});

test('does not loop when a seek lands back inside the break', () => {
  const s = skipper.createSkipper(BREAKS);
  assert.ok(s.check(670, 0));
  assert.equal(s.check(670.1, 100), null);
  assert.equal(s.check(670.2, 1200).retry, true);
  assert.equal(s.check(670.3, 2400).retry, true);
  assert.equal(s.check(670.4, 3600), null);
  assert.equal(s.check(670.5, 10000), null);
});

test('skips a break again after the user goes back before it', () => {
  const s = skipper.createSkipper(BREAKS);
  assert.ok(s.check(668, 0));
  assert.equal(s.check(698.1, 50), null);
  assert.equal(s.check(600, 100), null);
  const hit = s.check(668, 200);
  assert.ok(hit);
  assert.equal(hit.retry, false);
});

test('stops at the end of the file for a post-roll', () => {
  const s = skipper.createSkipper([{ start: 6380, end: 6405.2 }], { duration: 6405.2 });
  near(s.check(6381, 0).to, 6405.2);
});

test('lets the show play outside of breaks', () => {
  const s = skipper.createSkipper(BREAKS);
  for (const time of [30.2, 100, 667.5, 698.1, 6000]) {
    assert.equal(s.check(time, 0), null, String(time));
  }
});
