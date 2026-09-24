const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const { hosts } = load('lib/hosts.js');

// Far enough away that nothing reaches it by accident; the one test that is
// about the deadline sets its own.
hosts.patience(5000);

const tick = () => new Promise((done) => setImmediate(done));

// A stand-in adapter whose work can be held open, so what lib/hosts.js does
// around it can be watched: the order it runs things in, what it hands them,
// and what happens when one never finishes.
function adapter(id) {
  const calls = [];
  hosts.register({
    id,
    matches: (url) => url.hostname === `${id}.test`,
    parse: (url) => ({
      unit: 'bytes',
      category: 'inserted',
      pending: true,
      paramNames: [],
      resolve: (tools) => {
        const call = { url: url.href, tools };
        calls.push(call);
        return new Promise((done, fail) => {
          call.finish = done;
          call.fail = fail;
        });
      },
    }),
  });
  return calls;
}

function resolved(address, predicate = () => true) {
  return new Promise((done) => {
    hosts.onResolved((at, source) => {
      if (at === address && predicate(source)) done(source);
    });
  });
}

const calls = adapter('queued');
const complete = (s) => !s.partial;

test('works one address out at a time', async () => {
  const first = 'https://queued.test/a.mp3';
  const second = 'https://queued.test/b.mp3';

  assert.equal(hosts.parse(first).pending, true);
  assert.equal(hosts.parse(second).pending, true);

  await tick();
  assert.equal(calls.length, 1, 'the second waits for the first');

  const done = resolved(first, complete);
  calls[0].finish({ ranges: [[1, 2]], totalBytes: 100, audioOffset: 0, bytesPerSecond: 16000 });
  await done;
  await tick();

  assert.equal(calls.length, 2, 'and starts once the first is out of the way');
  const second_done = resolved(second, complete);
  calls[1].finish({ ranges: [] });
  await second_done;
});

test('hands an adapter a way to report what it has so far', async () => {
  const address = 'https://queued.test/c.mp3';
  hosts.parse(address);
  await tick();
  const call = calls[calls.length - 1];

  assert.equal(typeof call.tools.onPartial, 'function', 'onPartial reaches the adapter');

  const early = resolved(address, (s) => s.partial);
  call.tools.onPartial({ ranges: [[10, 20]], totalBytes: 500, audioOffset: 0, bytesPerSecond: 16000 });
  const partial = await early;
  assert.deepEqual(partial.ranges, [[10, 20]]);
  assert.equal(partial.host, 'queued');
  assert.equal(partial.unit, 'bytes', 'and keeps what the adapter said up front');
  assert.equal(hosts.parse(address).partial, true, 'it is what parse answers meanwhile');

  const full = resolved(address, complete);
  call.finish({
    ranges: [
      [10, 20],
      [30, 40],
    ],
    totalBytes: 500,
    audioOffset: 0,
    bytesPerSecond: 16000,
  });
  const answer = await full;
  assert.deepEqual(answer.ranges, [
    [10, 20],
    [30, 40],
  ]);
  assert.equal(answer.partial, undefined, 'and the complete answer replaces it');
});

test('a file that never answers does not shut the queue', async () => {
  hosts.patience(200);
  const stuck = 'https://queued.test/stuck.mp3';
  const after = 'https://queued.test/after.mp3';

  const gaveUp = resolved(stuck, complete);
  hosts.parse(stuck);
  await tick();
  const held = calls.length;
  hosts.parse(after);

  const answer = await gaveUp;
  assert.equal(answer.error, 'took-too-long');
  assert.deepEqual(answer.ranges, []);

  await tick();
  assert.equal(calls.length, held + 1, 'the one behind it gets its turn');

  const done = resolved(after, complete);
  calls[calls.length - 1].finish({ ranges: [] });
  await done;
  hosts.patience(5000);
});

test('an adapter that answers nothing at all is not asked twice', async () => {
  const address = 'https://queued.test/once.mp3';
  const before = calls.length;
  hosts.parse(address);
  hosts.parse(address);
  await tick();
  assert.equal(calls.length, before + 1);
  const done = resolved(address, complete);
  calls[calls.length - 1].finish({ ranges: [] });
  await done;
});
