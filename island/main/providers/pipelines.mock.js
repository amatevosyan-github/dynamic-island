// Fake pipeline feed so the module has something to render.
// Swap for a real GitLab poller with the same { id, start(emit) } shape.
const CYCLE = ['pending', 'running', 'running', 'success', 'failed'];

module.exports = {
  id: 'pipelines',
  start(emit) {
    const pipelines = [
      { project: 'vistry-web', ref: 'main', step: 3 },
      { project: 'vistry-api', ref: 'staging', step: 1 },
      { project: 'vistry-utils', ref: 'feat/island', step: 0 },
    ];

    const send = () => emit(pipelines.map((p) => ({ project: p.project, ref: p.ref, status: CYCLE[p.step] })));
    const tick = () => {
      const p = pipelines[Math.floor(Math.random() * pipelines.length)];
      p.step = (p.step + 1) % CYCLE.length;
      send();
    };

    send();
    const timer = setInterval(tick, 7000);
    return () => clearInterval(timer);
  },
};
