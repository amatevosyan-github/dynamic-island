// Pipelines module: renders whatever the "pipelines" provider emits
// ([{ project, ref, status }]). Data is mocked in main/providers/pipelines.mock.js.
const STATUS = {
  failed: { label: 'Failed', color: 'var(--err)', rank: 3 },
  running: { label: 'Running', color: 'var(--run)', rank: 2 },
  pending: { label: 'Pending', color: 'var(--warn)', rank: 1 },
  success: { label: 'Passed', color: 'var(--ok)', rank: 0 },
};

let ctx;
let rowsEl;
let countEl;
let list = [];
const lastStatus = new Map();

function summary() {
  const worst = list.reduce((a, p) => (STATUS[p.status].rank > STATUS[a].rank ? p.status : a), 'success');
  const n = list.filter((p) => p.status === worst).length;
  const text = worst === 'success' ? 'All passed' : `${n} ${STATUS[worst].label.toLowerCase()}`;
  return { color: STATUS[worst].color, text };
}

function render() {
  const { color, text } = summary();
  ctx.left.style.setProperty('--c', color);
  ctx.right.style.setProperty('--c', color);
  ctx.right.querySelector('.pl-summary').textContent = text;
  countEl.textContent = `${list.length} active`;

  rowsEl.replaceChildren(...list.map((p) => {
    const s = STATUS[p.status];
    const row = document.createElement('div');
    row.className = 'pl-row';
    row.innerHTML = `
      <div class="pl-name">
        <div class="pl-project"></div>
        <div class="pl-ref"></div>
      </div>
      <div class="pl-status ${p.status}" style="--c:${s.color}">
        <span class="pl-dot"></span>${s.label}
      </div>`;
    row.querySelector('.pl-project').textContent = p.project;
    row.querySelector('.pl-ref').textContent = p.ref;
    return row;
  }));
}

export default {
  id: 'pipelines',
  title: 'Pipelines',
  get expandedHeight() {
    return 70 + list.length * 37;
  },

  setup(c) {
    ctx = c;
    c.left.innerHTML = '<span class="pl-dot"></span>';
    c.right.innerHTML = '<span class="pl-summary"></span>';
    c.body.innerHTML = `
      <div class="pl-head"><span>Pipelines</span><span class="pl-count"></span></div>
      <div class="pl-rows"></div>`;
    rowsEl = c.body.querySelector('.pl-rows');
    countEl = c.body.querySelector('.pl-count');
  },

  hasActivity: () => list.length > 0,

  onData(data) {
    // A pipeline that just finished (passed or failed) is worth a glance.
    const attention = data.some((p) => {
      const prev = lastStatus.get(p.project);
      return prev && prev !== p.status && (p.status === 'failed' || p.status === 'success');
    });
    for (const p of data) lastStatus.set(p.project, p.status);
    list = data;
    render();
    ctx.changed({ attention });
  },
};
