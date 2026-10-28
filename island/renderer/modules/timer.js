// Timer module: an iOS-style countdown. Pick a duration on the wheels (or a preset),
// start, pause, cancel. While it runs, a small ring beside the island shows the time left.
// The state lives in localStorage, so a reload doesn't lose a running timer.
import * as T from '../timer-state.mjs';

const STORE = 'island.timer.v2'; // v1 could hold a duration picked by a mis-snapping wheel
const ROW = 30; // wheel row height, px
const PRESETS = [1, 5, 10, 15, 25, 45];
const RING_MS = 60 * 1000; // stop ringing on its own after a minute
const ORANGE = '#ff9f0a';

const RING_R = 70;
const RING_C = 2 * Math.PI * RING_R;
const MINI_R = 17; // on the badge's edge (36px badge, 2px stroke)
const MINI_C = 2 * Math.PI * MINI_R;

const GLYPH = '<svg class="timer-glyph" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9" r="5.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9V6M6.3 1.8h3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

let ctx;
let els;
let state;
let ticker;
let ringStop;
let alarm;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && saved.phase) return saved.phase === 'ringing' ? T.cancel(saved) : saved;
  } catch {
    // private storage or bad JSON: start fresh
  }
  return T.idle();
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    // not fatal: the timer just won't survive a reload
  }
}

function set(next) {
  const was = state.phase;
  state = next;
  save();
  if (state.phase === 'ringing' && was !== 'ringing') ring();
  if (state.phase !== 'ringing') stopRinging();
  render();
  ctx.changed({ attention: state.phase === 'ringing' && was !== 'ringing' });
}

// ---------- alarm ----------

function beep(audio, at) {
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    const t0 = at + i * 0.16;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + 0.13);
  }
}

function ring() {
  window.island.notify('Timer', `${T.format(state.duration)} timer is done`);
  try {
    const audio = new AudioContext();
    beep(audio, audio.currentTime);
    const repeat = setInterval(() => beep(audio, audio.currentTime), 1600);
    alarm = () => {
      clearInterval(repeat);
      audio.close();
    };
  } catch {
    // no audio device: the notification and the pulse still show
  }
  ringStop = setTimeout(() => set(T.cancel(state)), RING_MS);
}

function stopRinging() {
  clearTimeout(ringStop);
  if (alarm) alarm();
  alarm = null;
}

// ---------- wheels ----------

// iOS picker look: rows tilt away and fade as they leave the middle, like digits printed
// on a drum.
function curve(wheel) {
  const center = wheel.scrollTop + wheel.clientHeight / 2;
  for (const item of wheel.children) {
    if (!item.classList.contains('wheel-item')) continue;
    const d = Math.max(-3, Math.min(3, (item.offsetTop + ROW / 2 - center) / ROW));
    item.style.transform = `perspective(240px) rotateX(${-d * 24}deg) scale(${1 - Math.abs(d) * 0.06})`;
    item.style.opacity = String(Math.max(0, 1 - Math.abs(d) * 0.3));
  }
}

function buildWheel(wheel, max) {
  const items = [];
  for (let v = 0; v <= max; v++) items.push(`<div class="wheel-item">${v}</div>`);
  wheel.innerHTML = `<div class="wheel-pad"></div>${items.join('')}<div class="wheel-pad"></div>`;
  // One mouse-wheel notch moves one row (Windows would scroll ~100px, three or four rows);
  // touchpad deltas add up until they make a row.
  const NOTCH = 40;
  let target = null;
  let lastWheel = 0;
  let acc = 0;
  wheel.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastWheel > 400) {
      target = Math.round(wheel.scrollTop / ROW); // resync once the last move has settled
      acc = 0;
    }
    lastWheel = now;
    const delta = e.deltaMode === 1 ? e.deltaY * ROW : e.deltaY;
    acc += Math.abs(delta) >= NOTCH ? Math.sign(delta) * NOTCH : delta;
    const rows = Math.trunc(acc / NOTCH);
    if (!rows) return;
    acc -= rows * NOTCH;
    target = Math.max(0, Math.min(max, target + rows));
    wheel.scrollTo({ top: target * ROW, behavior: 'smooth' });
  }, { passive: false });

  let settle;
  let frame;
  wheel.addEventListener('scroll', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => curve(wheel));
    clearTimeout(settle);
    settle = setTimeout(() => {
      const value = Math.max(0, Math.min(max, Math.round(wheel.scrollTop / ROW)));
      const picked = [...state.picked];
      picked[Number(wheel.dataset.index)] = value;
      if (state.phase === 'idle') {
        state = { ...state, picked };
        save();
        updateButtons();
      }
    }, 90);
  });
}

function scrollWheels(smooth = false) {
  els.wheels.forEach((wheel, i) => {
    wheel.scrollTo({ top: state.picked[i] * ROW, behavior: smooth ? 'smooth' : 'auto' });
    curve(wheel);
  });
}

// ---------- render ----------

// Idle: one wide Start button. Once started it shrinks into a round Pause and a round
// Cancel fades in beside it (CSS, keyed on data-phase).
function updateButtons() {
  const { phase } = state;
  els.buttons.dataset.phase = phase;
  els.left.textContent = phase === 'ringing' ? '+1 min' : 'Cancel';
  els.left.tabIndex = phase === 'idle' ? -1 : 0;
  const label = { idle: 'Start', running: 'Pause', paused: 'Resume', ringing: 'Stop' }[phase];
  els.right.textContent = label;
  els.right.className = `round-btn ${phase === 'running' ? 'orange' : phase === 'ringing' ? 'red' : 'green'}`;
  els.right.disabled = phase === 'idle' && !T.pickedMs(state.picked);
}

function render() {
  const now = Date.now();
  const left = T.remaining(state, now);
  const running = state.phase !== 'idle';

  els.setup.hidden = running;
  els.run.hidden = !running;
  updateButtons();

  if (running) {
    els.time.textContent = state.phase === 'ringing' ? 'Done' : T.format(left);
    els.ends.textContent = state.phase === 'paused'
      ? 'Paused'
      : state.phase === 'ringing'
        ? `${T.format(state.duration)} timer`
        : `Ends ${new Date(state.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    els.ring.style.strokeDashoffset = String(RING_C * (1 - T.fraction(state, now)));
    els.run.classList.toggle('ringing', state.phase === 'ringing');
  }

  // Compact ears (when the timer is the island's module) and the badge beside the island.
  const short = state.phase === 'ringing' ? 'Done' : T.formatShort(left);
  els.compactTime.textContent = short;
  els.compactShort.textContent = state.phase === 'ringing' ? '!' : Math.ceil(left / 60000);
  els.badgeTime.textContent = state.phase === 'ringing' ? '!' : short;
  els.badgeRing.style.strokeDashoffset = String(MINI_C * (1 - T.fraction(state, now)));
  ctx.satellite.classList.toggle('ringing', state.phase === 'ringing');
  ctx.satellite.classList.toggle('long', short.length > 4);
}

function loop() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (state.phase === 'running') {
      const next = T.tick(state, Date.now());
      if (next !== state) set(next);
      else render();
    }
  }, 250);
}

export default {
  id: 'timer',
  title: 'Timer',
  alwaysListed: true, // reachable from the dots even when nothing runs
  badgeWhenCollapsed: true, // collapsed, it shows as the round badge beside the pill
  expandedHeight: 350,

  setup(c) {
    ctx = c;
    state = load();

    c.left.innerHTML = `<span class="timer-ear" style="--c:${ORANGE}">${GLYPH}</span>`;
    c.right.innerHTML = `<span class="timer-ear time" style="--c:${ORANGE}"></span><span class="summary-count" style="--c:${ORANGE}"></span>`;
    c.body.innerHTML = `
      <div class="list-head"><span>Timer</span><span class="list-count"></span></div>
      <div class="timer-setup">
        <div class="picker">
          <div class="picker-band"></div>
          <div class="wheel-col"><div class="wheel" data-index="0"></div><span class="wheel-unit">hours</span></div>
          <div class="wheel-col"><div class="wheel" data-index="1"></div><span class="wheel-unit">min</span></div>
          <div class="wheel-col"><div class="wheel" data-index="2"></div><span class="wheel-unit">sec</span></div>
        </div>
        <div class="presets">${PRESETS.map((m) => `<button data-preset="${m}">${m} min</button>`).join('')}</div>
      </div>
      <div class="timer-run" hidden>
        <svg class="timer-ring" viewBox="0 0 160 160" aria-hidden="true">
          <circle cx="80" cy="80" r="${RING_R}" class="track"/>
          <circle cx="80" cy="80" r="${RING_R}" class="progress" stroke-dasharray="${RING_C}"/>
        </svg>
        <div class="timer-center"><div class="timer-time"></div><div class="timer-ends"></div></div>
      </div>
      <div class="timer-buttons" data-phase="idle">
        <button class="round-btn gray" data-act="left"></button>
        <button class="round-btn green" data-act="right"></button>
      </div>`;

    // The badge's progress runs along its own outline, leaving the inside for the digits.
    c.satellite.innerHTML = `
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="${MINI_R}" class="track"/>
        <circle cx="18" cy="18" r="${MINI_R}" class="progress" stroke-dasharray="${MINI_C}"/>
      </svg>
      <span class="badge-time"></span>`;
    c.satellite.title = 'Timer';

    const q = (s) => c.body.querySelector(s);
    els = {
      setup: q('.timer-setup'),
      run: q('.timer-run'),
      time: q('.timer-time'),
      ends: q('.timer-ends'),
      ring: q('.timer-ring .progress'),
      buttons: q('.timer-buttons'),
      left: q('[data-act="left"]'),
      right: q('[data-act="right"]'),
      wheels: [...c.body.querySelectorAll('.wheel')],
      compactTime: c.right.querySelector('.time'),
      compactShort: c.right.querySelector('.summary-count'),
      badgeTime: c.satellite.querySelector('.badge-time'),
      badgeRing: c.satellite.querySelector('.progress'),
    };
    els.wheels.forEach((w, i) => buildWheel(w, i === 0 ? 23 : 59));

    c.body.addEventListener('click', (e) => {
      const preset = e.target.closest('[data-preset]');
      if (preset) {
        state = { ...state, picked: [0, Number(preset.dataset.preset), 0] };
        scrollWheels(true);
        set(T.start(state, Date.now()));
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const now = Date.now();
      if (act.dataset.act === 'left') {
        set(state.phase === 'ringing' ? T.extend(state, 60000, now) : T.cancel(state));
        if (state.phase === 'idle') scrollWheels();
        return;
      }
      const next = { idle: T.start, running: T.pause, paused: T.resume, ringing: T.cancel }[state.phase];
      set(next(state, now));
    });

    render();
    // A hidden tab can't scroll, so line the wheels up whenever the picker gets laid out.
    new ResizeObserver(() => scrollWheels()).observe(c.body.querySelector('.picker'));
    loop();
  },

  // Running, paused or ringing: shows in the compact island and as the badge.
  hasActivity: () => state.phase !== 'idle',
  satelliteVisible: () => state.phase !== 'idle',
};
