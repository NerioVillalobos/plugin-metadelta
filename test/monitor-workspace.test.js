import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createMonitorWorkspace, resetCurrent} from '../src/utils/monitor/workspace.js';

test('resetCurrent keeps base directories and clears their contents', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-monitor-workspace-'));
  try {
    const paths = createMonitorWorkspace(projectRoot, 'DEV');
    fs.mkdirSync(path.join(paths.salesforce, 'nested'), {recursive: true});
    fs.writeFileSync(path.join(paths.salesforce, 'nested', 'component.xml'), '<xml />');
    fs.writeFileSync(path.join(paths.vlocity, 'datapack.json'), '{}');
    fs.writeFileSync(path.join(paths.temp, 'tmp.txt'), 'tmp');

    resetCurrent(paths, 'all');

    assert.equal(fs.existsSync(paths.salesforce), true);
    assert.equal(fs.existsSync(paths.vlocity), true);
    assert.equal(fs.existsSync(paths.temp), true);
    assert.deepEqual(fs.readdirSync(paths.salesforce), []);
    assert.deepEqual(fs.readdirSync(paths.vlocity), []);
    assert.deepEqual(fs.readdirSync(paths.temp), []);
  } finally {
    fs.rmSync(projectRoot, {recursive: true, force: true});
  }
});
