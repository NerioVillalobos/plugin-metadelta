import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {toVlocityRelativePath, writeVlocityMonitorJob} from '../src/utils/monitor/retriever.js';

test('toVlocityRelativePath uses portable relative paths for Vlocity CLI', () => {
  const orgRoot = path.join('C:', 'Users', 'Nerio', '.metadelta', 'monitor', 'Telecentro-demo');
  const jobPath = path.join(orgRoot, 'manifest', 'monitor-vlocity-export.yaml');
  assert.equal(toVlocityRelativePath(orgRoot, jobPath), 'manifest/monitor-vlocity-export.yaml');
});

test('writeVlocityMonitorJob includes parser-safe defaults', () => {
  const orgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-monitor-retriever-'));
  try {
    const paths = {
      orgRoot,
      manifest: path.join(orgRoot, 'manifest'),
      vlocity: path.join(orgRoot, 'current', 'vlocity'),
    };
    const jobPath = writeVlocityMonitorJob(paths);
    const yaml = fs.readFileSync(jobPath, 'utf8');

    assert.match(yaml, /^projectPath: 'current\/vlocity'$/m);
    assert.match(yaml, /^continueAfterError: true$/m);
    assert.match(yaml, /^manifest: \[\]$/m);
    assert.match(yaml, /^OverrideSettings:$/m);
    assert.match(yaml, /^  DataPacks:$/m);
    assert.match(yaml, /^    Catalog: \{\}$/m);
    assert.match(yaml, /^    Product2:$/m);
    assert.match(yaml, /^      MaxDeploy: 1$/m);
  } finally {
    fs.rmSync(orgRoot, {recursive: true, force: true});
  }
});
