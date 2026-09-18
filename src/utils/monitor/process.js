import {getCommandCandidates, runCommand, runCommandSync} from '../command.js';

export {getCommandCandidates};

export function commandExists(command) {
  const result = runCommandSync(command, ['--version'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return result.status === 0;
}

export function runProcess(command, args, options = {}) {
  const {cwd = process.cwd(), env = process.env, stdin = 'ignore', timeoutMs = 0} = options;
  return runCommand(command, args, {cwd, env, stdin, timeoutMs}).then((result) => {
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const detail = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join('\n');
      const error = new Error(`${result.command} ${args.join(' ')} failed with code ${result.status}${detail ? `\n${detail}` : ''}`);
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      error.code = result.status;
      throw error;
    }
    return {stdout: result.stdout, stderr: result.stderr, code: result.status};
  });
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
