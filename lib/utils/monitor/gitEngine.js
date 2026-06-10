import { runProcess } from './process.js';
export async function initGit(root) {
    await runProcess('git', ['init'], { cwd: root });
    await runProcess('git', ['config', 'user.email', 'metadelta-monitor@local'], { cwd: root });
    await runProcess('git', ['config', 'user.name', 'Metadelta Monitor'], { cwd: root });
    await runProcess('git', ['config', 'commit.gpgsign', 'false'], { cwd: root });
}
export async function hasBaseline(root) {
    try {
        await runProcess('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root });
        return true;
    }
    catch {
        return false;
    }
}
export async function createBaseline(root, message = 'metadelta monitor baseline') {
    await runProcess('git', ['add', '--all'], { cwd: root });
    await runProcess('git', ['commit', '--allow-empty', '-m', message], { cwd: root });
}
export async function parseDiff(root) {
    const { stdout } = await runProcess('git', ['diff', '--name-status', '--find-renames', 'HEAD', '--'], { cwd: root });
    return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const parts = line.split(/\t/);
        const status = parts[0];
        const action = status.startsWith('R') ? 'RENAMED' : { A: 'ADDED', M: 'MODIFIED', D: 'DELETED' }[status] ?? 'MODIFIED';
        const file = status.startsWith('R') ? parts[2] : parts[1];
        const previousFile = status.startsWith('R') ? parts[1] : undefined;
        return { action, file, previousFile };
    });
}
export async function diffSummary(root, file) {
    try {
        const { stdout } = await runProcess('git', ['diff', '--', file], { cwd: root });
        return stdout
            .split(/\r?\n/)
            .filter((line) => /^[+-][^+-]/.test(line))
            .slice(0, 8);
    }
    catch {
        return [];
    }
}
export async function updateBaseline(root) {
    await runProcess('git', ['add', '--all'], { cwd: root });
    try {
        await runProcess('git', ['commit', '--allow-empty', '-m', `metadelta monitor refresh ${new Date().toISOString()}`], { cwd: root });
    }
    catch {
        // Nothing to commit is harmless for a monitor refresh.
    }
}
