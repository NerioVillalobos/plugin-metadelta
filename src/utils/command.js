import {spawn, spawnSync} from 'node:child_process';

const COMMAND_ENV = {
  sf: 'SF_BINPATH',
  npm: 'NPM_BINPATH',
  npx: 'NPX_BINPATH',
  vlocity: 'VLOCITY_BINPATH',
};

function hasExtension(command) {
  return /\.[a-z0-9]+$/i.test(command) || /[\\/]/.test(command);
}

function isWindowsShim(candidate, platform = process.platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(candidate);
}

function quoteWindowsCommandArg(value) {
  const text = String(value);
  if (text.length === 0) return '""';

  // cmd.exe parses the command text after /c. Quote the complete argument and
  // escape cmd metacharacters so SOQL, paths and user input remain one value.
  const escaped = text
    .replace(/([&|<>^()])/g, '^$1')
    .replace(/%/g, '^%')
    .replace(/!/g, '^!')
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function buildWindowsShimInvocation(candidate, args = [], env = process.env) {
  const commandLine = [candidate, ...args].map(quoteWindowsCommandArg).join(' ');
  return {
    executable: env.ComSpec || env.COMSPEC || 'cmd.exe',
    // /s removes the outer pair; the remaining pair keeps an executable path
    // with spaces intact when cmd.exe starts a .cmd/.bat shim.
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

export function getCommandInvocation(candidate, args = [], platform = process.platform, env = process.env) {
  return isWindowsShim(candidate, platform)
    ? buildWindowsShimInvocation(candidate, args, env)
    : {executable: candidate, args};
}

export function getCommandCandidates(command, platform = process.platform) {
  const value = String(command);
  const configured = COMMAND_ENV[value] ? process.env[COMMAND_ENV[value]] : null;
  const candidates = configured ? [configured] : [];

  if (hasExtension(value)) {
    candidates.push(value);
  } else {
    candidates.push(value);
    if (platform === 'win32') {
      candidates.push(`${value}.cmd`, `${value}.exe`, `${value}.bat`);
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function runCommandSync(command, args = [], options = {}) {
  let lastResult = null;

  for (const candidate of getCommandCandidates(command)) {
    const spec = getCommandInvocation(candidate, args);
    const result = spawnSync(spec.executable, spec.args, {
      encoding: 'utf8',
      shell: false,
      windowsVerbatimArguments: spec.windowsVerbatimArguments ?? false,
      ...options,
    });
    lastResult = {...result, command: candidate};
    if (!result.error || !['ENOENT', 'EINVAL'].includes(result.error.code)) {
      return lastResult;
    }
  }

  return lastResult ?? {
    command,
    status: 1,
    stdout: '',
    stderr: '',
    error: new Error(`No se pudo resolver el ejecutable ${command}.`),
  };
}

export function formatCommandFailure(result, fallback = 'El comando no pudo ejecutarse.') {
  const parts = [
    result?.error?.message,
    result?.stderr,
    result?.stdout,
    result?.status !== undefined && result?.status !== 0 ? `código ${result.status}` : '',
    result?.signal ? `señal ${result.signal}` : '',
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);

  return parts[0] || fallback;
}

export function runCommand(command, args = [], options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    stdin = 'ignore',
    timeoutMs = 0,
    stdout: stdoutStream = null,
    stderr: stderrStream = null,
  } = options;
  const candidates = getCommandCandidates(command);

  return new Promise((resolve) => {
    let index = 0;
    let lastResult = null;

    const tryNext = () => {
      const candidate = candidates[index++];
      if (!candidate) {
        resolve(lastResult ?? {
          command,
          status: 1,
          stdout: '',
          stderr: '',
          error: new Error(`No se pudo resolver el ejecutable ${command}.`),
        });
        return;
      }

      const spec = getCommandInvocation(candidate, args, process.platform, env);
      const child = spawn(spec.executable, spec.args, {
        cwd,
        env,
        shell: false,
        windowsVerbatimArguments: spec.windowsVerbatimArguments ?? false,
        stdio: [stdin, 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = timeoutMs > 0 ? setTimeout(() => {
        settled = true;
        child.kill('SIGTERM');
        resolve({command: candidate, status: 1, stdout, stderr, signal: 'SIGTERM', error: new Error(`${candidate} timed out after ${timeoutMs}ms`)});
      }, timeoutMs) : null;

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        stdoutStream?.write?.(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        stderrStream?.write?.(chunk);
      });
      child.on('error', (error) => {
        if (timeout) clearTimeout(timeout);
        if (settled) return;
        if (['ENOENT', 'EINVAL'].includes(error.code) && index < candidates.length) {
          tryNext();
          return;
        }
        settled = true;
        resolve({command: candidate, status: 1, stdout, stderr, signal: null, error});
      });
      child.on('close', (status, signal) => {
        if (timeout) clearTimeout(timeout);
        if (settled) return;
        settled = true;
        lastResult = {command: candidate, status: status ?? (signal ? 1 : 0), stdout, stderr, signal, error: null};
        resolve(lastResult);
      });
    };

    tryNext();
  });
}
