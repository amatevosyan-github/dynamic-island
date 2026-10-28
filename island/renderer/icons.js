// Status glyphs, used instead of words where the island is too narrow (side docks).
const svg = (body, cls = '') => `<svg class="status-icon ${cls}" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;

const ICONS = {
  spinner: svg('<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="22 13" stroke-linecap="round"/>', 'spin'),
  check: svg('<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  cross: svg('<path d="M4.5 4.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  ask: svg('<path d="M8 1.8a5.7 5.7 0 0 0-5 8.5L2 14l3.8-1a5.7 5.7 0 1 0 2.2-11.2Z" fill="currentColor"/><path d="M6.4 6.2a1.7 1.7 0 1 1 2.4 1.6c-.5.3-.8.6-.8 1.1v.3" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11" r=".85" fill="#000"/>'),
  clock: svg('<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  minus: svg('<path d="M4 8h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  play: svg('<path d="M5.5 3.8v8.4L12 8Z" fill="currentColor"/>'),
};

// Status name (agents and pipelines) -> icon markup.
export const STATUS_ICON = {
  working: ICONS.spinner,
  running: ICONS.spinner,
  waiting: ICONS.ask,
  done: ICONS.check,
  success: ICONS.check,
  error: ICONS.cross,
  failed: ICONS.cross,
  pending: ICONS.clock,
  canceled: ICONS.minus,
  manual: ICONS.play,
};

// The status pill: dot + label when there's room, icon only on side docks (CSS decides).
export function statusPill(status, label, color) {
  return `<div class="status-pill ${status}" style="--c:${color}" title="${label}">
    <span class="status-dot"></span>${STATUS_ICON[status] || ''}<span class="status-label">${label}</span>
  </div>`;
}
