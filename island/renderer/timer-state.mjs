// Countdown state for the timer module, free of DOM so it can be tested.
// phase: idle | running | paused | ringing. Times are ms; `now` is passed in.

export const idle = (picked = [0, 5, 0]) => ({ phase: 'idle', picked, duration: 0, endAt: 0, remaining: 0 });

export const pickedMs = ([h, m, s]) => ((h * 60 + m) * 60 + s) * 1000;

export function start(state, now) {
  const duration = pickedMs(state.picked);
  if (!duration) return state;
  return { ...state, phase: 'running', duration, endAt: now + duration, remaining: 0 };
}

export function pause(state, now) {
  if (state.phase !== 'running') return state;
  return { ...state, phase: 'paused', remaining: Math.max(0, state.endAt - now) };
}

export function resume(state, now) {
  if (state.phase !== 'paused') return state;
  return { ...state, phase: 'running', endAt: now + state.remaining, remaining: 0 };
}

export const cancel = (state) => idle(state.picked);

// Adds time to a running, paused or ringing timer (ringing restarts it).
export function extend(state, ms, now) {
  if (state.phase === 'running') return { ...state, endAt: state.endAt + ms, duration: state.duration + ms };
  if (state.phase === 'paused') return { ...state, remaining: state.remaining + ms, duration: state.duration + ms };
  if (state.phase === 'ringing') return { ...state, phase: 'running', endAt: now + ms, duration: ms };
  return state;
}

// Moves a running timer to "ringing" once its time is up.
export function tick(state, now) {
  return state.phase === 'running' && now >= state.endAt ? { ...state, phase: 'ringing' } : state;
}

export function remaining(state, now) {
  switch (state.phase) {
    case 'running': return Math.max(0, state.endAt - now);
    case 'paused': return state.remaining;
    case 'ringing': return 0;
    default: return pickedMs(state.picked);
  }
}

// Share of the duration still left, 1 -> 0.
export const fraction = (state, now) => (state.duration ? remaining(state, now) / state.duration : 1);

// "4:59", "1:04:59" like the iOS timer; rounds up so it never shows 0:00 while running.
export function format(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Fits the small round badge: "4:59", or "1h05" from an hour up.
export function formatShort(ms) {
  if (Math.ceil(ms / 1000) < 3600) return format(ms);
  const minutes = Math.ceil(ms / 60000); // rounded up, like the seconds in format()
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}
