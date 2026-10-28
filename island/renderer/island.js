import modules from './modules/index.js';
import { createSettings } from './settings.js';

// Pill sizes per orientation: top/bottom docks are horizontal, left/right vertical.
const SIZES = {
  horizontal: { idle: { w: 120, h: 32 }, compact: { w: 236, h: 36 }, expandedW: 400, settings: { w: 400, h: 470 } },
  vertical: { idle: { w: 32, h: 120 }, compact: { w: 36, h: 180 }, expandedW: 340, settings: { w: 380, h: 470 } },
};
const EXPANDED_RADIUS = 34;
const DOTS_H = 14; // part of a module's expandedHeight, given back when the dots are hidden
const HOVER_INTENT_MS = 120;
const COLLAPSE_DELAY_MS = 350;
const ATTENTION_MS = 4000;
const WHEEL_THROTTLE_MS = 300;
const DRAG_THRESHOLD = 6; // px before a press becomes a drag

const island = document.getElementById('island');
const compactLayer = document.getElementById('compact');
const bodies = document.getElementById('bodies');
const dots = document.getElementById('dots');
const cluster = document.querySelector('.cluster');
const gear = document.getElementById('gear');

const views = [];
let activeIndex = 0;      // module the user picked
let attentionIndex = null; // module temporarily shown because it asked for attention
let expanded = false;
let hovered = false;
let dragging = false;
let edge = 'top';
let expandTimer, collapseTimer, attentionTimer;
let lastWheel = 0;

const vertical = () => edge === 'left' || edge === 'right';

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

modules.forEach((mod, i) => {
  const ears = el('div', 'ears');
  const left = el('div', 'ear left');
  const right = el('div', 'ear right');
  ears.append(left, right);
  compactLayer.append(ears);

  const body = el('div', 'body');
  bodies.append(body);

  const dot = el('button', 'dot');
  dot.title = mod.title;
  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    activate(i);
  });
  dots.append(dot);

  views.push({ mod, ears, body, dot });
  mod.setup({ left, right, body, changed: (opts) => onModuleChanged(i, opts) });
});

const settings = createSettings(document.getElementById('settings'), {
  onClose: () => closeSettings(),
  onResize: () => render(),
});

function currentIndex() {
  if (attentionIndex !== null) return attentionIndex;
  if (views[activeIndex].mod.hasActivity()) return activeIndex;
  const firstActive = views.findIndex((v) => v.mod.hasActivity());
  return firstActive === -1 ? activeIndex : firstActive;
}

function render() {
  if (views.length !== modules.length) return; // still in setup
  const idx = currentIndex();
  const view = views[idx];
  const sizes = SIZES[vertical() ? 'vertical' : 'horizontal'];
  const open = settings.isOpen();
  const state = open || expanded ? 'expanded' : view.mod.hasActivity() ? 'compact' : 'idle';

  // Dots only for modules that have something to show.
  let shown = 0;
  views.forEach((v, i) => {
    const on = i === idx;
    v.ears.hidden = !on;
    v.body.hidden = !on || open;
    v.dot.classList.toggle('active', on);
    v.dot.hidden = !on && !v.mod.hasActivity();
    if (!v.dot.hidden) shown++;
  });
  dots.hidden = shown < 2 || open;

  let w;
  let h;
  if (open) ({ w, h } = sizes.settings);
  else if (state === 'expanded') [w, h] = [sizes.expandedW, (view.mod.expandedHeight ?? 160) - (dots.hidden ? DOTS_H : 0)];
  else ({ w, h } = sizes[state]);

  island.dataset.state = state;
  cluster.classList.toggle('show-gear', state === 'expanded' && !open && !dragging);
  island.style.setProperty('--xw', `${w}px`);
  island.style.width = `${w}px`;
  island.style.height = `${h}px`;
  island.style.borderRadius = `${state === 'expanded' ? EXPANDED_RADIUS : Math.min(w, h) / 2}px`;
}

// Next module with activity in direction dir (±1), or the current one.
function step(dir) {
  const from = currentIndex();
  for (let k = 1; k < views.length; k++) {
    const i = (from + dir * k + views.length * k) % views.length;
    if (views[i].mod.hasActivity()) return i;
  }
  return from;
}

function setExpanded(value) {
  if (dragging && value) return;
  if (expanded === value) return;
  expanded = value;
  if (expanded) clearAttention();
  render();
}

function activate(i) {
  activeIndex = (i + views.length) % views.length;
  clearAttention();
  render();
}

function onModuleChanged(i, opts = {}) {
  if (opts.attention && !expanded && !hovered && !settings.isOpen()) {
    attentionIndex = i;
    clearTimeout(attentionTimer);
    attentionTimer = setTimeout(clearAttention, ATTENTION_MS);
    island.classList.remove('pulse');
    void island.offsetWidth; // restart the animation
    island.classList.add('pulse');
  }
  render();
}

function clearAttention() {
  clearTimeout(attentionTimer);
  if (attentionIndex === null) return;
  // Hovering a module that grabbed attention makes it the user's pick.
  if (hovered) activeIndex = attentionIndex;
  attentionIndex = null;
  render();
}

function setDock(next) {
  edge = next;
  document.body.dataset.dock = edge;
  document.body.classList.toggle('vertical', vertical());
  render();
}

// ---------- settings ----------

function openSettings() {
  clearTimeout(collapseTimer);
  window.island.setInteractive(true);
  window.island.setFocusable(true);
  expanded = true;
  settings.open();
  render();
}

function closeSettings() {
  if (!settings.isOpen()) return;
  settings.close();
  window.island.setFocusable(false);
  if (!hovered) {
    expanded = false;
    window.island.setInteractive(false);
  }
  render();
}

gear.addEventListener('click', (e) => {
  e.stopPropagation();
  openSettings();
});

window.island.onOpenSettings(openSettings);
window.island.onBlur(closeSettings); // clicked into another app
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSettings();
});

// ---------- pointer: hover, click, drag ----------

// The island and its settings button count as one hover area: crossing the gap between
// them starts the collapse delay, and entering the other one cancels it.
function hoverStart() {
  hovered = true;
  window.island.setInteractive(true);
  clearTimeout(collapseTimer);
  if (!dragging && !expanded) expandTimer = setTimeout(() => setExpanded(true), HOVER_INTENT_MS);
}

function hoverEnd() {
  if (dragging) return; // the window follows the cursor; don't drop mouse events mid-drag
  hovered = false;
  clearTimeout(expandTimer);
  if (settings.isOpen()) return; // stays open (and focused) until closed
  window.island.setInteractive(false);
  collapseTimer = setTimeout(() => setExpanded(false), COLLAPSE_DELAY_MS);
}

for (const target of [island, gear]) {
  target.addEventListener('mouseenter', hoverStart);
  target.addEventListener('mouseleave', hoverEnd);
}

// A press on the pill (not on a control) becomes a drag once it moves a few pixels.
let press = null;
let suppressClick = false;
const INTERACTIVE = 'button, input, textarea, select, a, label, .settings';

island.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;
  press = { x: e.screenX, y: e.screenY, id: e.pointerId };
});

island.addEventListener('pointermove', (e) => {
  if (!press || dragging) return;
  if (Math.hypot(e.screenX - press.x, e.screenY - press.y) < DRAG_THRESHOLD) return;
  dragging = true;
  island.setPointerCapture(press.id);
  clearTimeout(expandTimer);
  expanded = false;
  document.body.classList.add('dragging');
  render();
  window.island.drag(true);
});

function endPress() {
  if (dragging) {
    dragging = false;
    suppressClick = true; // the click that ends a drag isn't a tap
    document.body.classList.remove('dragging');
    window.island.drag(false);
  }
  press = null;
}
island.addEventListener('pointerup', endPress);
island.addEventListener('pointercancel', endPress);
island.addEventListener('lostpointercapture', endPress);

island.addEventListener('click', () => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  clearTimeout(expandTimer);
  setExpanded(true);
});

island.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.island.showMenu();
});

island.addEventListener('wheel', (e) => {
  if (settings.isOpen()) return; // the panel scrolls
  const now = Date.now();
  if (now - lastWheel < WHEEL_THROTTLE_MS || views.length < 2) return;
  lastWheel = now;
  activate(step(Math.sign(e.deltaY || e.deltaX) || 1));
}, { passive: true });

island.addEventListener('animationend', () => island.classList.remove('pulse'));

window.island.onData(({ id, data }) => {
  const view = views.find((v) => v.mod.id === id);
  if (view && view.mod.onData) view.mod.onData(data);
});

window.island.onDock(({ edge: next }) => setDock(next));

render();
