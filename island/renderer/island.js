import modules from './modules/index.js';

const SIZES = {
  idle: { w: 120, h: 32, r: 16 },
  compact: { w: 236, h: 36, r: 18 },
  expanded: { w: 400, r: 36 },
};
const HOVER_INTENT_MS = 120;
const COLLAPSE_DELAY_MS = 350;
const ATTENTION_MS = 4000;
const WHEEL_THROTTLE_MS = 300;

const island = document.getElementById('island');
const compactLayer = document.getElementById('compact');
const bodies = document.getElementById('bodies');
const dots = document.getElementById('dots');

const views = [];
let activeIndex = 0;      // module the user picked
let attentionIndex = null; // module temporarily shown because it asked for attention
let expanded = false;
let hovered = false;
let expandTimer, collapseTimer, attentionTimer;
let lastWheel = 0;

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
  const state = expanded ? 'expanded' : view.mod.hasActivity() ? 'compact' : 'idle';
  const size = SIZES[state];

  island.dataset.state = state;
  island.style.width = `${size.w}px`;
  island.style.height = `${state === 'expanded' ? view.mod.expandedHeight ?? 160 : size.h}px`;
  island.style.borderRadius = `${size.r}px`;

  views.forEach((v, i) => {
    const on = i === idx;
    v.ears.hidden = !on;
    v.body.hidden = !on;
    v.dot.classList.toggle('active', on);
  });
  dots.hidden = views.length < 2;
}

function setExpanded(value) {
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
  if (opts.attention && !expanded && !hovered) {
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

island.addEventListener('mouseenter', () => {
  hovered = true;
  window.island.setInteractive(true);
  clearTimeout(collapseTimer);
  expandTimer = setTimeout(() => setExpanded(true), HOVER_INTENT_MS);
});

island.addEventListener('mouseleave', () => {
  hovered = false;
  window.island.setInteractive(false);
  clearTimeout(expandTimer);
  collapseTimer = setTimeout(() => setExpanded(false), COLLAPSE_DELAY_MS);
});

island.addEventListener('click', () => {
  clearTimeout(expandTimer);
  setExpanded(true);
});

island.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.island.showMenu();
});

island.addEventListener('wheel', (e) => {
  const now = Date.now();
  if (now - lastWheel < WHEEL_THROTTLE_MS || views.length < 2) return;
  lastWheel = now;
  activate(currentIndex() + Math.sign(e.deltaY || e.deltaX));
}, { passive: true });

island.addEventListener('animationend', () => island.classList.remove('pulse'));

window.island.onData(({ id, data }) => {
  const view = views.find((v) => v.mod.id === id);
  if (view && view.mod.onData) view.mod.onData(data);
});

render();
