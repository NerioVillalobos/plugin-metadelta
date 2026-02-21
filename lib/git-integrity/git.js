import {spawnSync} from 'node:child_process';
import path from 'node:path';

export function runGitCommand(args, {cwd} = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim();
    const error = new Error(message || `Git command failed: git ${args.join(' ')}`);
    error.code = result.status;
    throw error;
  }
  return result.stdout.trimEnd();
}

export function resolveRepoRoot(startDir) {
  const output = runGitCommand(['rev-parse', '--show-toplevel'], {cwd: startDir});
  return path.resolve(output);
}

export function ensureGitRepo(startDir) {
  const output = runGitCommand(['rev-parse', '--is-inside-work-tree'], {cwd: startDir});
  if (output.trim() !== 'true') {
    throw new Error('El directorio indicado no es un repositorio Git.');
  }
}

export function resolveMainlineRef(startDir) {
  const remoteHeadArgs = ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'];
  try {
    const remoteHead = runGitCommand(remoteHeadArgs, {cwd: startDir});
    if (remoteHead) {
      return remoteHead;
    }
  } catch {
    // ignore, fallback below
  }
  try {
    const headRef = runGitCommand(['symbolic-ref', '-q', '--short', 'HEAD'], {cwd: startDir});
    if (headRef) {
      return headRef;
    }
  } catch {
    // ignore, fallback below
  }
  return 'HEAD';
}
