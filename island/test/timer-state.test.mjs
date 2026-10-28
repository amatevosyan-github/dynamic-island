import test from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../renderer/timer-state.mjs';

test('start counts down from the picked duration', () => {
  const s = t.start(t.idle([0, 1, 30]), 1000);
  assert.equal(s.phase, 'running');
  assert.equal(t.remaining(s, 1000), 90000);
  assert.equal(t.remaining(s, 31000), 60000);
  assert.equal(t.fraction(s, 46000), 0.5);
});

test('a zero duration does not start', () => {
  assert.equal(t.start(t.idle([0, 0, 0]), 0).phase, 'idle');
});

test('pause freezes the time left, resume continues from it', () => {
  let s = t.start(t.idle([0, 1, 0]), 0);
  s = t.pause(s, 20000);
  assert.equal(t.remaining(s, 999999), 40000);
  s = t.resume(s, 100000);
  assert.equal(t.remaining(s, 110000), 30000);
});

test('it rings when the time is up, and cancel keeps the picked duration', () => {
  let s = t.start(t.idle([0, 0, 10]), 0);
  assert.equal(t.tick(s, 9999).phase, 'running');
  s = t.tick(s, 10000);
  assert.equal(s.phase, 'ringing');
  assert.equal(t.remaining(s, 10000), 0);
  assert.deepEqual(t.cancel(s), t.idle([0, 0, 10]));
});

test('extend adds time, and restarts a ringing timer', () => {
  let s = t.start(t.idle([0, 1, 0]), 0);
  s = t.extend(s, 60000, 0);
  assert.equal(t.remaining(s, 0), 120000);
  s = t.tick(s, 120000);
  s = t.extend(s, 60000, 200000);
  assert.equal(s.phase, 'running');
  assert.equal(t.remaining(s, 200000), 60000);
});

test('format matches the iOS timer', () => {
  assert.equal(t.format(299001), '5:00');
  assert.equal(t.format(299000), '4:59');
  assert.equal(t.format(3899000), '1:04:59');
  assert.equal(t.formatShort(3899000), '1h05');
  assert.equal(t.formatShort(59000), '0:59');
});
