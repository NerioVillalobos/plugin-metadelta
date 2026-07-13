import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initGit} from '../src/utils/monitor/gitEngine.js';
import {commandExists, runProcess} from '../src/utils/monitor/process.js';

test('initGit replaces duplicate local monitor identity values', async () => {
  if (!commandExists('git')) return;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-monitor-git-'));
  try {
    await runProcess('git', ['init'], {cwd: root});
    await runProcess('git', ['config', '--add', 'user.name', 'First Value'], {cwd: root});
    await runProcess('git', ['config', '--add', 'user.name', 'Second Value'], {cwd: root});
    await runProcess('git', ['config', '--add', 'user.email', 'first@example.test'], {cwd: root});
    await runProcess('git', ['config', '--add', 'user.email', 'second@example.test'], {cwd: root});

    await initGit(root);

    const {stdout: names} = await runProcess('git', ['config', '--local', '--get-all', 'user.name'], {cwd: root});
    const {stdout: emails} = await runProcess('git', ['config', '--local', '--get-all', 'user.email'], {cwd: root});
    assert.deepEqual(names.trim().split(/\r?\n/), ['Metadelta Monitor']);
    assert.deepEqual(emails.trim().split(/\r?\n/), ['metadelta-monitor@local']);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
