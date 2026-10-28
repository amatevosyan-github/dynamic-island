import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleAccounts, accountsToSave } from '../renderer/gitlab-draft.mjs';

test('deleting the last GitLab account leaves the list empty', () => {
  assert.deepEqual(visibleAccounts([]), []);
});

test('an untouched blank row is not written back', () => {
  const blank = { id: '', name: '', url: 'https://gitlab.com', ref: '', projects: '', token: '' };
  assert.deepEqual(accountsToSave([blank]), []);
});

test('save sends the accounts that are still in the draft', () => {
  const kept = {
    id: 'acct-2', name: 'personal', url: 'https://gitlab.com', ref: '', projects: 'me/site', token: '',
  };
  assert.deepEqual(accountsToSave([kept]).map((a) => a.id), ['acct-2']);
});
