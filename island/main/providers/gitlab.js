// Latest pipeline per GitLab project, for the "pipelines" module.
// Configured in ~/.vistry-island/config.json:
//   "gitlab": { "url": "https://gitlab.com", "token": "<read_api token>",
//               "projects": ["group/project", ...], "ref": "" }
// "ref" limits it to one branch; empty means the latest pipeline on any branch.
// Without a token or projects the provider stays idle and the module hides.
const STATUS = {
  running: 'running',
  pending: 'pending',
  created: 'pending',
  preparing: 'pending',
  waiting_for_resource: 'pending',
  scheduled: 'pending',
  success: 'success',
  failed: 'failed',
  canceled: 'canceled',
  skipped: 'canceled',
  manual: 'manual',
};
const POLL_IDLE_MS = 60 * 1000;
const POLL_ACTIVE_MS = 15 * 1000; // while something runs
const TIMEOUT_MS = 15 * 1000;

const NOTIFY = {
  success: (p) => [`${p.project} passed`, p.ref],
  failed: (p) => [`${p.project} failed`, p.ref],
};

module.exports = {
  id: 'pipelines',
  start(emit, ctx) {
    const { url, token, projects, ref } = ctx.config.gitlab || {};
    if (!token || !Array.isArray(projects) || !projects.length) {
      emit([]);
      return () => {};
    }

    const api = `${String(url || 'https://gitlab.com').replace(/\/+$/, '')}/api/v4`;
    const lastStatus = new Map();
    let stopped = false;
    let timer;

    const latest = async (project) => {
      const query = new URLSearchParams({ per_page: '1' });
      if (ref) query.set('ref', ref);
      const res = await fetch(`${api}/projects/${encodeURIComponent(project)}/pipelines?${query}`, {
        headers: { 'PRIVATE-TOKEN': token },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(res.status === 401 ? 'Token rejected' : res.status === 404 ? 'Project not found' : `HTTP ${res.status}`);
      const [p] = await res.json();
      return p && { id: project, project: project.split('/').pop(), ref: p.ref, status: STATUS[p.status] || 'pending', url: p.web_url };
    };

    const poll = async () => {
      const results = await Promise.allSettled(projects.map(latest));
      if (stopped) return;
      const list = results
        .map((r, i) => r.status === 'fulfilled'
          ? r.value
          : { id: projects[i], project: projects[i].split('/').pop(), ref: '', status: 'error', error: r.reason.message })
        .filter(Boolean);

      for (const p of list) {
        const prev = lastStatus.get(p.id);
        if (prev && prev !== p.status && NOTIFY[p.status]) ctx.notify(...NOTIFY[p.status](p), p.url);
        lastStatus.set(p.id, p.status);
      }

      emit(list);
      const busy = list.some((p) => p.status === 'running' || p.status === 'pending');
      timer = setTimeout(poll, busy ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    };

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  },
};
