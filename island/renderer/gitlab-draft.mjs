// GitLab account draft shown in the settings panel, and the payload Save sends.
// An empty saved list stays empty: a placeholder row is not an account.

const projectsToText = (projects) => (projects || [])
  .map((p) => (typeof p === 'string' ? p : `${p.path}@${p.ref}`))
  .join('\n');

const textToProjects = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const at = l.lastIndexOf('@');
  return at > 0 ? { path: l.slice(0, at).trim(), ref: l.slice(at + 1).trim() } : l;
});

export function visibleAccounts(gitlab = []) {
  return gitlab.map((a) => ({ ...a, projects: projectsToText(a.projects), token: '' }));
}

// A row with no id, name, token or projects is the blank "Add account" form.
export function accountsToSave(accounts) {
  return accounts
    .filter((a) => a.id || String(a.name || '').trim() || String(a.token || '').trim() || String(a.projects || '').trim())
    .map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      ref: a.ref,
      projects: textToProjects(a.projects),
      token: a.token,
    }));
}
