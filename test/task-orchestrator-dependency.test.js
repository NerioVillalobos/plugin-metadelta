import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ensurePlaywrightTestDependency, resolveInstalledPlaywrightRuntime} from '../src/utils/task/orchestrator.js';

function createLocalPlaywrightInstall(baseDir) {
  const packageDir = path.join(baseDir, 'node_modules', '@playwright', 'test');
  fs.mkdirSync(packageDir, {recursive: true});
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({name: '@playwright/test', version: '1.0.0'}), 'utf8');
  fs.writeFileSync(path.join(packageDir, 'cli.js'), "console.log('fake playwright cli');\n", 'utf8');
}

test('resolveInstalledPlaywrightRuntime resolves @playwright/test from current project', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-pw-'));
  createLocalPlaywrightInstall(tmp);

  const runtime = resolveInstalledPlaywrightRuntime(tmp);

  assert.ok(runtime);
  assert.equal(runtime.cacheDir, tmp);
  assert.equal(runtime.cliPath.endsWith(path.join('@playwright', 'test', 'cli.js')), true);
});

test('ensurePlaywrightTestDependency reuses local project install without auto-install', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-pw-'));
  createLocalPlaywrightInstall(tmp);

  const runtime = ensurePlaywrightTestDependency(tmp);

  assert.ok(runtime);
  assert.equal(runtime.cacheDir, tmp);
  assert.equal(fs.existsSync(runtime.cliPath), true);
  assert.equal(runtime.cliPath.includes(path.join('tests', '.metadelta-playwright')), false);
});
