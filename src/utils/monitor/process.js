import {spawn, spawnSync} from 'node:child_process';

export function commandExists(command) {
  return getCommandCandidates(command).some((candidate) => {
    const result = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      shell: shouldUseShell(),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return result.status === 0;
  });
}

export function runProcess(command, args, options = {}) {
  const {cwd = process.cwd(), env = process.env, stdin = 'ignore', timeoutMs = 0} = options;
  const candidates = getCommandCandidates(command);
  let index = 0;
  const useShell = shouldUseShell();

  return new Promise((resolve, reject) => {
    const tryNext = (lastError) => {
      const candidate = candidates[index++];
      if (!candidate) {
        reject(lastError);
        return;
      }
      let child;
      try {
        const spawnCommand = useShell ? buildShellCommand(candidate, args) : candidate;
        const spawnArgs = useShell ? [] : args;
        child = spawn(spawnCommand, spawnArgs, {
          cwd,
          env,
          shell: useShell,
          stdio: [stdin, 'pipe', 'pipe'],
        });
      } catch (error) {
        if (isRetryableSpawnError(error) && index < candidates.length) {
          tryNext(error);
          return;
        }
        reject(error);
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = timeoutMs > 0 ? setTimeout(() => {
        settled = true;
        child.kill('SIGTERM');
        const error = new Error(`${candidate} ${args.join(' ')} timed out after ${timeoutMs}ms`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = 'ETIMEDOUT';
        reject(error);
      }, timeoutMs) : null;

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (settled) {
          return;
        }
        settled = true;
        if (isRetryableSpawnError(error) && index < candidates.length) {
          tryNext(error);
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (settled) {
          return;
        }
        settled = true;
        if (code !== 0) {
          const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
          const error = new Error(`${candidate} ${args.join(' ')} failed with code ${code}${detail ? `\n${detail}` : ''}`);
          error.stdout = stdout;
          error.stderr = stderr;
          error.code = code;
          reject(error);
          return;
        }
        resolve({stdout, stderr, code});
      });
    };

    tryNext();
  });
}

function isRetryableSpawnError(error) {
  return ['ENOENT', 'EINVAL'].includes(error?.code);
}

export function buildShellCommand(command, args, platform = process.platform) {
  return [command, ...args].map((value) => quoteShellArg(value, platform)).join(' ');
}

function quoteShellArg(value, platform) {
  const text = String(value);
  if (text.length === 0) return '""';
  if (!/[\s"'&|<>()[\]{}^;,%!]/.test(text)) return text;
  if (platform === 'win32') {
    return `"${text.replace(/"/g, '\\"')}"`;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

export function shouldUseShell(platform = process.platform) {
  return platform === 'win32';
}

export function getCommandCandidates(command, platform = process.platform) {
  if (platform !== 'win32' || /[\\/]/.test(command) || /\.[a-z0-9]+$/i.test(command)) {
    return [command];
  }
  return [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`];
}
