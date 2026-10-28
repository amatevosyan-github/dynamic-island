const { test } = require('node:test');
const assert = require('node:assert/strict');
const dock = require('../main/dock');

const AREA = { x: 0, y: 0, width: 1920, height: 1032 }; // 1080p minus a 48px taskbar

test('nearestEdge picks the closest side', () => {
  assert.equal(dock.nearestEdge({ x: 960, y: 10 }, AREA), 'top');
  assert.equal(dock.nearestEdge({ x: 960, y: 1020 }, AREA), 'bottom');
  assert.equal(dock.nearestEdge({ x: 5, y: 500 }, AREA), 'left');
  assert.equal(dock.nearestEdge({ x: 1910, y: 500 }, AREA), 'right');
});

test('offsetOn is the position along the edge, clamped to 0..1', () => {
  assert.equal(dock.offsetOn('top', { x: 960, y: 0 }, AREA), 0.5);
  assert.equal(dock.offsetOn('left', { x: 0, y: 1032 }, AREA), 1);
  assert.equal(dock.offsetOn('bottom', { x: -50, y: 0 }, AREA), 0);
});

test('windowPosition keeps the pill against the edge and the window on screen', () => {
  const { width: W, height: H } = dock.WIN;
  const top = dock.windowPosition('top', 0.5, AREA);
  assert.deepEqual(top, { x: 960 - W / 2, y: 2 });

  const bottom = dock.windowPosition('bottom', 0.5, AREA);
  assert.equal(bottom.y + H, 1030, 'window ends 2px above the work area bottom');

  const left = dock.windowPosition('left', 0.5, AREA);
  assert.deepEqual(left, { x: 2, y: 516 - H / 2 });

  const right = dock.windowPosition('right', 0.5, AREA);
  assert.equal(right.x + W, 1918);

  // Near a corner the window is clamped so the expanded island isn't cut off.
  assert.equal(dock.windowPosition('top', 0, AREA).x, 0);
  assert.equal(dock.windowPosition('left', 1, AREA).y, 1032 - H);
});

test('windowPosition respects a second monitor offset', () => {
  const second = { x: 1920, y: 0, width: 1280, height: 984 };
  const p = dock.windowPosition('right', 0.5, second);
  assert.equal(p.x + dock.WIN.width, 1920 + 1280 - 2);
});
