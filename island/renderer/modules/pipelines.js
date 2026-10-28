// Pipelines module: latest GitLab pipeline per project from the "pipelines" provider
// ([{ id, project, account, ref, status, url?, error? }]). Hidden until GitLab is configured.
import { STATUS_ICON, statusPill } from '../icons.js';

const STATUS = {
  failed: { label: 'Failed', color: 'var(--err)', rank: 5 },
  error: { label: 'Error', color: 'var(--err)', rank: 4 },
  running: { label: 'Running', color: 'var(--run)', rank: 3 },
  pending: { label: 'Pending', color: 'var(--warn)', rank: 2 },
  manual: { label: 'Manual', color: 'var(--fg-2)', rank: 1 },
  canceled: { label: 'Canceled', color: 'var(--fg-2)', rank: 0 },
  success: { label: 'Passed', color: 'var(--ok)', rank: 0 },
};
const MAX_ROWS = 5;

let ctx;
let rowsEl;
let countEl;
let list = [];
const lastStatus = new Map();

function summary() {
  const worst = list.reduce((a, p) => (STATUS[p.status].rank > STATUS[a].rank ? p.status : a), 'success');
  const n = list.filter((p) => p.status === worst).length;
  const text = worst === 'success' || worst === 'canceled' ? 'All passed' : `${n} ${STATUS[worst].label.toLowerCase()}`;
  return { worst, n, color: STATUS[worst].color, text };
}

function render() {
  const { worst, n, color, text } = summary();
  ctx.left.style.setProperty('--c', color);
  ctx.right.style.setProperty('--c', color);
  ctx.left.querySelector('.ear-icon').innerHTML = STATUS_ICON[worst];
  ctx.right.querySelector('.summary').textContent = text;
  ctx.right.querySelector('.summary-count').textContent = n;
  countEl.textContent = `${list.length} project${list.length === 1 ? '' : 's'}`;

  // Broken and running first.
  const sorted = [...list].sort((a, b) => STATUS[b.status].rank - STATUS[a.status].rank);

  rowsEl.replaceChildren(...sorted.slice(0, MAX_ROWS).map((p) => {
    const s = STATUS[p.status];
    const row = document.createElement(p.url ? 'button' : 'div');
    row.className = p.url ? 'row link' : 'row';
    if (p.url) {
      row.title = 'Open in GitLab';
      row.addEventListener('click', () => window.island.open(p.url));
    }
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title"></div>
        <div class="row-sub"></div>
      </div>
      ${statusPill(p.status, s.label, s.color)}`;
    row.querySelector('.row-title').textContent = p.project;
    row.querySelector('.row-sub').textContent = [p.error || p.ref, p.account].filter(Boolean).join(' · ');
    return row;
  }));
}

export default {
  id: 'pipelines',
  title: 'Pipelines',
  get expandedHeight() {
    return 76 + Math.min(list.length, MAX_ROWS) * 37;
  },

  setup(c) {
    ctx = c;
    c.left.innerHTML = '<span class="status-dot"></span><span class="ear-icon"></span>';
    c.right.innerHTML = '<span class="summary"></span><span class="summary-count"></span>';
    c.body.innerHTML = `
      <div class="list-head"><span>Pipelines</span><span class="list-count"></span></div>
      <div class="list-rows"></div>`;
    rowsEl = c.body.querySelector('.list-rows');
    countEl = c.body.querySelector('.list-count');
  },

  hasActivity: () => list.length > 0,

  onData(data) {
    // A pipeline that just finished (passed or failed) is worth a glance.
    const attention = data.some((p) => {
      const prev = lastStatus.get(p.id);
      return prev && prev !== p.status && (p.status === 'failed' || p.status === 'success');
    });
    for (const p of data) lastStatus.set(p.id, p.status);
    list = data.filter((p) => STATUS[p.status]);
    render();
    ctx.changed({ attention });
  },
};
