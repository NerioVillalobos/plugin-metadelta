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

  fs.mkdirSync(paths.root, {recursive: true});
  fs.writeFileSync(paths.lock, JSON.stringify({pid: process.pid, org: orgAlias, startedAt: new Date().toISOString()}, null, 2));
  prepareOrgTree(paths);
  return paths;
}

export function prepareOrgTree(paths) {
  for (const dir of [paths.salesforce, paths.vlocity, paths.manifest, paths.temp]) {
    fs.mkdirSync(dir, {recursive: true});
  }
  fs.writeFileSync(paths.runtime, JSON.stringify({lastRefresh: null, status: 'INITIALIZING'}, null, 2));
}

export function resetCurrent(paths, scope) {
  if (scope === 'all' || scope === 'salesforce') {
    removeDirectory(paths.salesforce);
    fs.mkdirSync(paths.salesforce, {recursive: true});
  }
  if (scope === 'all' || scope === 'vlocity') {
    removeDirectory(paths.vlocity);
    fs.mkdirSync(paths.vlocity, {recursive: true});
  }
  removeDirectory(paths.temp);
  fs.mkdirSync(paths.temp, {recursive: true});
}

export function cleanupMonitorWorkspace(paths) {
  if (!paths?.root) {
    return;
  }
  fs.rmSync(path.join(paths.root, '.git'), {recursive: true, force: true});
  if (paths.orgRoot) {
    fs.rmSync(paths.orgRoot, {recursive: true, force: true});
  }
  if (paths.lock) {
    fs.rmSync(paths.lock, {force: true});
  }
  fs.mkdirSync(paths.root, {recursive: true});
}

function removeDirectory(dir) {
  try {
    fs.rmSync(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code)) {
      throw error;
    }
    makeWritable(dir);
    fs.rmSync(dir, {recursive: true, force: true, maxRetries: 15, retryDelay: 300});
  }
}

function makeWritable(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const entryPath = path.join(dir, entry.name);
    try {
      fs.chmodSync(entryPath, 0o700);
    } catch {
      // Best effort only; Windows may still lock files owned by another process.
    }
    if (entry.isDirectory()) {
      makeWritable(entryPath);
    }
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort only.
  }
}
