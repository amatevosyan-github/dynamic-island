const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const gitlab = require('../main/providers/gitlab');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

// Fake GitLab: answers per host + token; records every request.
function fakeGitlab(routes) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const u = new URL(url);
    const token = opts.headers['PRIVATE-TOKEN'];
    calls.push({ host: u.host, path: decodeURIComponent(u.pathname), ref: u.searchParams.get('ref'), token });
    const route = routes[`${u.host} ${token}`];
    if (!route) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => [route] };
  };
  return calls;
}

// Runs the provider until its first emit.
function firstEmit(config) {
  return new Promise((resolve) => {
    let stop;
    stop = gitlab.start((rows) => {
      if (stop) stop();
      else setImmediate(() => stop && stop());
      resolve(rows);
    }, { config: { gitlab: config }, notify() {} });
  });
}

const pipeline = (status, ref, url) => ({ status, ref, web_url: url });

test('each account is queried with its own token and URL', async () => {
  const calls = fakeGitlab({
    'gitlab.work.test tok-work': pipeline('running', 'main', 'https://gitlab.work.test/p/1'),
    'gitlab.com tok-me': pipeline('success', 'master', 'https://gitlab.com/p/2'),
  });
  const rows = await firstEmit([
    { name: 'work', url: 'https://gitlab.work.test/', token: 'tok-work', projects: ['team/web', { path: 'team/api', ref: 'release' }] },
    { url: 'https://gitlab.com', token: 'tok-me', projects: ['me/site'] },
  ]);

  assert.deepEqual(calls.map((c) => `${c.host} ${c.token} ${c.path} ${c.ref}`).sort(), [
    'gitlab.com tok-me /api/v4/projects/me/site/pipelines null',
    'gitlab.work.test tok-work /api/v4/projects/team/api/pipelines release',
    'gitlab.work.test tok-work /api/v4/projects/team/web/pipelines null',
  ]);
  assert.deepEqual(rows.map((r) => [r.project, r.status, r.account]), [
    ['web', 'running', 'work'],
    ['api', 'running', 'work'],
    ['site', 'success', 'gitlab.com'],
  ]);
});

test('a rejected token shows as an error row, other accounts still load', async () => {
  fakeGitlab({ 'gitlab.com good': pipeline('failed', 'main', 'https://gitlab.com/x') });
  const rows = await firstEmit([
    { url: 'https://gitlab.com', token: 'good', projects: ['a/one'] },
    { url: 'https://gitlab.com', token: 'expired', projects: ['a/two'] },
  ]);
  assert.deepEqual(rows.map((r) => [r.project, r.status, r.error]), [
    ['one', 'failed', undefined],
    ['two', 'error', 'Token rejected'],
  ]);
});

test('the old single-object config still works and shows no account label', async () => {
  fakeGitlab({ 'gitlab.com t': pipeline('success', 'main', 'https://gitlab.com/x') });
  const rows = await firstEmit({ url: 'https://gitlab.com', token: 't', projects: ['g/p'] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account, '');
});

test('accounts without a token or projects are skipped', () => {
  assert.equal(gitlab.targets([{ token: '', projects: ['a/b'] }, { token: 't', projects: [] }]).length, 0);
  assert.equal(gitlab.targets(undefined).length, 0);
});
