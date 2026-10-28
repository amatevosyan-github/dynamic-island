// Agents module: Claude Code / Cursor chats from the "agents" provider
// ([{ tool, session, project, prompt, message, state, updatedAt }]).
const STATE = {
  waiting: { label: 'Needs you', color: 'var(--warn)', rank: 3 },
  error: { label: 'Error', color: 'var(--err)', rank: 2 },
  working: { label: 'Working', color: 'var(--run)', rank: 1 },
  done: { label: 'Done', color: 'var(--ok)', rank: 0 },
};
const TOOL = {
  claude: { letter: 'C', name: 'Claude', color: '#d97757' },
  cursor: { letter: 'Cu', name: 'Cursor', color: '#e8e8e8' },
};
const MAX_ROWS = 5;

let ctx;
let rowsEl;
let countEl;
let list = [];
let loaded = false;
const lastState = new Map();

function age(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function summary() {
  const worst = list.reduce((a, x) => (STATE[x.state].rank > STATE[a].rank ? x.state : a), 'done');
  const n = list.filter((x) => x.state === worst).length;
  const text = worst === 'waiting' ? `${n} need${n === 1 ? 's' : ''} you` : `${n} ${STATE[worst].label.toLowerCase()}`;
  return { color: STATE[worst].color, text };
}

function render() {
  if (!list.length) {
    rowsEl.innerHTML = '<div class="agent-empty">No active chats</div>';
    countEl.textContent = '';
    return;
  }

  const { color, text } = summary();
  ctx.left.style.setProperty('--c', color);
  ctx.right.style.setProperty('--c', color);
  ctx.right.querySelector('.summary').textContent = text;
  countEl.textContent = `${list.length} chat${list.length === 1 ? '' : 's'}`;

  // Chats that need you first, then by recency.
  const sorted = [...list].sort((a, b) => STATE[b.state].rank - STATE[a.state].rank || b.updatedAt - a.updatedAt);

  rowsEl.replaceChildren(...sorted.slice(0, MAX_ROWS).map((a) => {
    const s = STATE[a.state];
    const t = TOOL[a.tool] || { letter: '?', name: a.tool, color: 'var(--fg-3)' };
    const row = document.createElement(a.openUrl ? 'button' : 'div');
    row.className = a.openUrl ? 'row agent link' : 'row agent';
    if (a.openUrl) {
      row.title = `Open in ${t.name} · right-click for more`;
      row.addEventListener('click', () => window.island.open(a.openUrl));
    }
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation(); // not the island's own menu
      window.island.command('agents', 'menu', { key: a.key });
    });
    row.innerHTML = `
      <div class="agent-tool" style="--t:${t.color}"></div>
      <div class="row-main">
        <div class="row-title"></div>
        <div class="row-sub"></div>
      </div>
      <div class="status-pill ${a.state}" style="--c:${s.color}">
        <span class="status-dot"></span>${s.label}
      </div>
      <div class="agent-age" title="Time in this state">${age(a.since)}</div>`;
    const badge = row.querySelector('.agent-tool');
    badge.textContent = t.letter;
    badge.title = t.name;
    const detail = (a.state === 'waiting' && a.message) || a.prompt;
    row.querySelector('.row-title').textContent = a.title || a.project;
    row.querySelector('.row-sub').textContent = [a.project, detail].filter(Boolean).join(' · ');
    return row;
  }));
}

export default {
  id: 'agents',
  title: 'Agents',
  get expandedHeight() {
    return 76 + Math.max(1, Math.min(list.length, MAX_ROWS)) * 44;
  },

  setup(c) {
    ctx = c;
    c.left.innerHTML = '<span class="status-dot"></span>';
    c.right.innerHTML = '<span class="summary"></span>';
    c.body.innerHTML = `
      <div class="list-head"><span>Agents</span><span class="list-count"></span></div>
      <div class="list-rows"></div>`;
    rowsEl = c.body.querySelector('.list-rows');
    countEl = c.body.querySelector('.list-count');
    setInterval(render, 30 * 1000); // keep the "5m" ages fresh
    render();
  },

  hasActivity: () => list.length > 0,

  onData(data) {
    // Finished or blocked on you: bring the island forward (not for the initial load).
    const attention = loaded && data.some((a) => a.state !== 'working' && lastState.get(a.session) !== a.state);
    loaded = true;
    lastState.clear();
    for (const a of data) lastState.set(a.session, a.state);
    list = data.filter((a) => STATE[a.state]);
    render();
    ctx.changed({ attention });
  },
};
