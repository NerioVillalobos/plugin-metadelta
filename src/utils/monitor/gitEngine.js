import fs from 'node:fs';
import path from 'node:path';
import {runProcess} from './process.js';

const GIT_TIMEOUT_MS = 10 * 60 * 1000;

export async function initGit(root) {
  if (!hasGitMetadata(root)) {
    await runGit(root, ['init']);
  }
  await ensureGitConfig(root, 'user.email', 'metadelta-monitor@local');
  await ensureGitConfig(root, 'user.name', 'Metadelta Monitor');
  await ensureGitConfig(root, 'commit.gpgsign', 'false');
}

export async function hasBaseline(root) {
  try {
    await runGit(root, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

export async function createBaseline(root, message = 'metadelta monitor baseline') {
  await runGit(root, ['add', '--all']);
  await runGit(root, ['commit', '--allow-empty', '-m', message]);
}

export async function parseDiff(root) {
  const {stdout} = await runGit(root, ['diff', '--name-status', '--find-renames', 'HEAD', '--']);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t/);
      const status = parts[0];
      const action = status.startsWith('R') ? 'RENAMED' : {A: 'ADDED', M: 'MODIFIED', D: 'DELETED'}[status] ?? 'MODIFIED';
      const file = status.startsWith('R') ? parts[2] : parts[1];
      const previousFile = status.startsWith('R') ? parts[1] : undefined;
      return {action, file, previousFile};
    });
}

export async function diffSummary(root, file) {
  try {
    const {stdout} = await runGit(root, ['diff', '--', file]);
    return stdout
      .split(/\r?\n/)
      .filter((line) => /^[+-][^+-]/.test(line))
      .slice(0, 8);
  } catch {
    return [];
  }
}

export async function updateBaseline(root) {
  await runGit(root, ['add', '--all']);
  try {
    await runGit(root, ['commit', '--allow-empty', '-m', `metadelta monitor refresh ${new Date().toISOString()}`]);
  } catch {
    // Nothing to commit is harmless for a monitor refresh.
  }
}

function hasGitMetadata(root) {
  return fs.existsSync(path.join(root, '.git'));
}

async function ensureGitConfig(root, key, value) {
  const current = await getGitConfigValues(root, key);
  if (current.length === 1 && current[0] === value) return;
  const args =
    current.length === 0 ? ['config', '--local', key, value] : ['config', '--local', '--replace-all', key, value];
  await runGit(root, args);
}

async function getGitConfigValues(root, key) {
  try {
    const {stdout} = await runGit(root, ['config', '--local', '--get-all', key]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function runGit(root, args) {
  return runProcess('git', args, {cwd: root, timeoutMs: GIT_TIMEOUT_MS});
}
