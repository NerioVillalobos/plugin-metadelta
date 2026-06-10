import fs from 'node:fs';
import path from 'node:path';
export function createMonitorWorkspace(projectRoot, orgAlias) {
    const root = path.join(projectRoot, '.metadelta-monitor');
    const orgRoot = path.join(root, orgAlias);
    const paths = {
        root,
        lock: path.join(root, '.lock'),
        orgRoot,
        current: path.join(orgRoot, 'current'),
        salesforce: path.join(orgRoot, 'current', 'salesforce'),
        vlocity: path.join(orgRoot, 'current', 'vlocity'),
        manifest: path.join(orgRoot, 'manifest'),
        temp: path.join(orgRoot, 'temp'),
        runtime: path.join(orgRoot, 'runtime.json'),
    };
    fs.mkdirSync(paths.root, { recursive: true });
    fs.writeFileSync(paths.lock, JSON.stringify({ pid: process.pid, org: orgAlias, startedAt: new Date().toISOString() }, null, 2));
    prepareOrgTree(paths);
    return paths;
}
export function prepareOrgTree(paths) {
    for (const dir of [paths.salesforce, paths.vlocity, paths.manifest, paths.temp]) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(paths.runtime, JSON.stringify({ lastRefresh: null, status: 'INITIALIZING' }, null, 2));
}
export function resetCurrent(paths, scope) {
    if (scope === 'all' || scope === 'salesforce') {
        fs.rmSync(paths.salesforce, { recursive: true, force: true });
        fs.mkdirSync(paths.salesforce, { recursive: true });
    }
    if (scope === 'all' || scope === 'vlocity') {
        fs.rmSync(paths.vlocity, { recursive: true, force: true });
        fs.mkdirSync(paths.vlocity, { recursive: true });
    }
    fs.rmSync(paths.temp, { recursive: true, force: true });
    fs.mkdirSync(paths.temp, { recursive: true });
}
export function cleanupMonitorWorkspace(paths) {
    if (!paths?.root) {
        return;
    }
    fs.rmSync(path.join(paths.root, '.git'), { recursive: true, force: true });
    if (paths.orgRoot) {
        fs.rmSync(paths.orgRoot, { recursive: true, force: true });
    }
    if (paths.lock) {
        fs.rmSync(paths.lock, { force: true });
    }
    fs.mkdirSync(paths.root, { recursive: true });
}
