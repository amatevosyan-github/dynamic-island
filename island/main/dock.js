// Geometry of the island on a screen edge. The window is a fixed transparent canvas big
// enough for any expanded state; the renderer pins the pill to the edge side of it
// (.stage in island.css), and the window is placed so the pill hugs the screen edge.
// Wide enough for the 400px island centered with the settings button beside it.
const WIN = { width: 520, height: 560 };
const PAD = 4; // .stage padding
const THICK = 36; // compact pill thickness
const GAP = 6; // pill distance from the screen edge

const horizontal = (edge) => edge === 'top' || edge === 'bottom';

// Where the pill's center sits inside the window for a given edge.
function pillCenter(edge) {
  const near = PAD + THICK / 2;
  switch (edge) {
    case 'bottom': return { x: WIN.width / 2, y: WIN.height - near };
    case 'left': return { x: near, y: WIN.height / 2 };
    case 'right': return { x: WIN.width - near, y: WIN.height / 2 };
    default: return { x: WIN.width / 2, y: near };
  }
}

// The edge of `area` ({ x, y, width, height }) closest to `point`.
function nearestEdge(point, area) {
  const d = {
    top: point.y - area.y,
    bottom: area.y + area.height - point.y,
    left: point.x - area.x,
    right: area.x + area.width - point.x,
  };
  return Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a));
}

// Position of `point` along `edge` as 0..1.
function offsetOn(edge, point, area) {
  const t = horizontal(edge) ? (point.x - area.x) / area.width : (point.y - area.y) / area.height;
  return Math.min(1, Math.max(0, t));
}

// Window position that puts the pill on `edge` at `offset`, kept inside `area` so the
// expanded island stays on screen.
function windowPosition(edge, offset, area) {
  const along = horizontal(edge) ? area.x + offset * area.width : area.y + offset * area.height;
  const across = {
    top: area.y + GAP + THICK / 2,
    bottom: area.y + area.height - GAP - THICK / 2,
    left: area.x + GAP + THICK / 2,
    right: area.x + area.width - GAP - THICK / 2,
  }[edge];
  const target = horizontal(edge) ? { x: along, y: across } : { x: across, y: along };
  const c = pillCenter(edge);
  const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(v, lo), hi));
  return {
    x: clamp(target.x - c.x, area.x, area.x + area.width - WIN.width),
    y: clamp(target.y - c.y, area.y, area.y + area.height - WIN.height),
  };
}

// Window position that keeps the pill under the cursor while dragging.
function followCursor(edge, cursor) {
  const c = pillCenter(edge);
  return { x: Math.round(cursor.x - c.x), y: Math.round(cursor.y - c.y) };
}

module.exports = { WIN, nearestEdge, offsetOn, windowPosition, followCursor };
