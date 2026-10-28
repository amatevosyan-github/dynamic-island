// Mock "Now Playing" module: local fake tracks, no real media integration.
const TRACKS = [
  { title: 'Midnight City', artist: 'M83', duration: 243, art: ['#ff5f6d', '#6a3093'] },
  { title: 'Nightcall', artist: 'Kavinsky', duration: 258, art: ['#f7971e', '#d4145a'] },
  { title: 'Intro', artist: 'The xx', duration: 128, art: ['#43cea2', '#185a9d'] },
];

const ICON = {
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l10.5-7z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15L19.5 12z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/></svg>',
};

const EQ = '<div class="eq"><i></i><i></i><i></i><i></i></div>';

let ctx;
let els;
let index = 0;
let position = 37;
let playing = true;

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function render({ jump = false } = {}) {
  const track = TRACKS[index];
  for (const root of [ctx.left, ctx.right, ctx.body]) {
    root.dataset.playing = String(playing);
    root.style.setProperty('--a1', track.art[0]);
    root.style.setProperty('--a2', track.art[1]);
  }
  els.title.textContent = track.title;
  els.artist.textContent = track.artist;
  els.pos.textContent = fmt(position);
  els.left.textContent = `-${fmt(track.duration - position)}`;
  els.toggle.innerHTML = playing ? ICON.pause : ICON.play;
  els.toggle.title = playing ? 'Pause' : 'Play';

  // Skip the 1s linear transition when the position jumps (track change).
  if (jump) els.fill.style.transition = 'none';
  els.fill.style.transform = `scaleX(${position / track.duration})`;
  if (jump) {
    void els.fill.offsetWidth;
    els.fill.style.transition = '';
  }
  ctx.changed();
}

function go(step) {
  index = (index + step + TRACKS.length) % TRACKS.length;
  position = 0;
  render({ jump: true });
}

const ACTIONS = {
  prev: () => (position > 3 ? ((position = 0), render({ jump: true })) : go(-1)),
  next: () => go(1),
  toggle: () => {
    playing = !playing;
    render();
  },
};

export default {
  id: 'media',
  title: 'Now Playing',
  expandedHeight: 178,

  setup(c) {
    ctx = c;
    c.left.innerHTML = '<div class="art art-sm"></div>';
    c.right.innerHTML = EQ;
    c.body.innerHTML = `
      <div class="media-top">
        <div class="art art-lg"></div>
        <div class="media-meta">
          <div class="media-title"></div>
          <div class="media-artist"></div>
        </div>
        ${EQ.replace('class="eq"', 'class="eq eq-lg"')}
      </div>
      <div class="progress">
        <span class="t-pos"></span>
        <div class="bar"><div class="fill"></div></div>
        <span class="t-left"></span>
      </div>
      <div class="controls">
        <button data-act="prev" title="Previous">${ICON.prev}</button>
        <button data-act="toggle" class="big"></button>
        <button data-act="next" title="Next">${ICON.next}</button>
      </div>`;

    const q = (s) => c.body.querySelector(s);
    els = {
      title: q('.media-title'),
      artist: q('.media-artist'),
      pos: q('.t-pos'),
      left: q('.t-left'),
      fill: q('.fill'),
      toggle: q('[data-act="toggle"]'),
    };

    c.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) ACTIONS[btn.dataset.act]();
    });

    setInterval(() => {
      if (!playing) return;
      position += 1;
      if (position >= TRACKS[index].duration) go(1);
      else render();
    }, 1000);

    render({ jump: true });
  },

  hasActivity: () => true,
};
