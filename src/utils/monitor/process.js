import {spawn, spawnSync} from 'node:child_process';

export function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return result.status === 0;
}

export function runProcess(command, args, options = {}) {
  const {cwd = process.cwd(), env = process.env, stdin = 'ignore'} = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: [stdin, 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
        const error = new Error(`${command} ${args.join(' ')} failed with code ${code}${detail ? `\n${detail}` : ''}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
        return;
      }
      resolve({stdout, stderr, code});
    });
  });
}
