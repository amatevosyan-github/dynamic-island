// Latest pipeline per GitLab project, for the "pipelines" module.
// Configured in ~/.vistry-island/config.json as a list of accounts, each with its own
// instance and token (a single object is accepted too):
//   "gitlab": [
//     { "name": "work", "url": "https://gitlab.example.com", "token": "<read_api token>",
//       "projects": ["group/web", { "path": "group/api", "ref": "main" }], "ref": "" },
//     { "name": "personal", "url": "https://gitlab.com", "token": "…", "projects": ["me/site"] }
//   ]
// "ref" limits a project (or the whole account) to one branch; empty means the latest
// pipeline on any branch. Accounts without a token or projects are skipped; with none
// left the provider stays idle and the module hides.
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

// Flattens the config into one target per project: { id, account, path, ref, api, token }.
function targets(gitlab) {
  const accounts = [].concat(gitlab || []).filter((a) => a && a.token && Array.isArray(a.projects) && a.projects.length);
  return accounts.flatMap((a) => {
    const base = String(a.url || 'https://gitlab.com').replace(/\/+$/, '');
    return a.projects
      .map((p) => (typeof p === 'string' ? { path: p } : p))
      .filter((p) => p && p.path)
      .map((p) => ({
        id: `${base}/${p.path}`,
        account: accounts.length > 1 ? a.name || base.replace(/^\w+:\/\//, '') : '',
        path: p.path,
        ref: p.ref || a.ref || '',
        api: `${base}/api/v4`,
        token: a.token,
      }));
  });
}

async function latest(t) {
  const query = new URLSearchParams({ per_page: '1' });
  if (t.ref) query.set('ref', t.ref);
  const res = await fetch(`${t.api}/projects/${encodeURIComponent(t.path)}/pipelines?${query}`, {
    headers: { 'PRIVATE-TOKEN': t.token },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Token rejected' : res.status === 404 ? 'Project not found' : `HTTP ${res.status}`);
  const [p] = await res.json();
  return p && { status: STATUS[p.status] || 'pending', ref: p.ref, url: p.web_url };
}

module.exports = {
  id: 'pipelines',
  targets,
  start(emit, ctx) {
    const list = targets(ctx.config.gitlab);
    if (!list.length) {
      emit([]);
      return () => {};
    }

    const lastStatus = new Map();
    let stopped = false;
    let timer;

    const poll = async () => {
      const results = await Promise.allSettled(list.map(latest));
      if (stopped) return;
      const rows = results
        .map((r, i) => {
          const t = list[i];
          const base = { id: t.id, project: t.path.split('/').pop(), account: t.account };
          if (r.status === 'rejected') return { ...base, ref: t.ref, status: 'error', error: r.reason.message };
          return r.value && { ...base, ...r.value };
        })
        .filter(Boolean);

      for (const p of rows) {
        const prev = lastStatus.get(p.id);
        if (prev && prev !== p.status && NOTIFY[p.status]) ctx.notify(...NOTIFY[p.status](p), p.url);
        lastStatus.set(p.id, p.status);
      }

      emit(rows);
      const busy = rows.some((p) => p.status === 'running' || p.status === 'pending');
      timer = setTimeout(poll, busy ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    };

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  },
};
