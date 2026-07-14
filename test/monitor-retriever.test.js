import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildVlocityEnv, toVlocityRelativePath, writeScopedVlocityMonitorJob, writeVlocityMonitorJob} from '../src/utils/monitor/retriever.js';

test('toVlocityRelativePath uses portable relative paths for Vlocity CLI', () => {
  const orgRoot = path.join('C:', 'Users', 'Nerio', '.metadelta', 'monitor', 'Telecentro-demo');
  const jobPath = path.join(orgRoot, 'manifest', 'monitor-vlocity-export.yaml');
  assert.equal(toVlocityRelativePath(orgRoot, jobPath), 'manifest/monitor-vlocity-export.yaml');
});

test('buildVlocityEnv exposes sf auth secrets for Vlocity CLI session refresh', () => {
  const env = buildVlocityEnv({PATH: 'C:\\bin', SF_TEMP_SHOW_SECRETS: 'false'});
  assert.equal(env.PATH, 'C:\\bin');
  assert.equal(env.SF_TEMP_SHOW_SECRETS, 'true');
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

test('writeScopedVlocityMonitorJob injects missing defaults and preserves custom manifest', () => {
  const orgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-monitor-retriever-'));
  try {
    const paths = {
      orgRoot,
      manifest: path.join(orgRoot, 'manifest'),
      vlocity: path.join(orgRoot, 'current', 'vlocity'),
    };
    const sourceJobPath = path.join(orgRoot, 'Release.yaml');
    fs.writeFileSync(sourceJobPath, [
      'projectPath: ./old',
      'compileOnBuild: true',
      'manifest:',
      '- IntegrationProcedure/TC_ExternalServiceAssets',
      '- Promotion/Promo-Test',
      '',
    ].join('\n'));

    const jobPath = writeScopedVlocityMonitorJob(paths, sourceJobPath);
    const yaml = fs.readFileSync(jobPath, 'utf8');

    assert.match(yaml, /^projectPath: 'current\/vlocity'$/m);
    assert.match(yaml, /^continueAfterError: true$/m);
    assert.match(yaml, /^compileOnBuild: true$/m);
    assert.match(yaml, /^maxDepth: 0$/m);
    assert.match(yaml, /^autoUpdateSettings: true$/m);
    assert.match(yaml, /^manifest:$/m);
    assert.match(yaml, /^- IntegrationProcedure\/TC_ExternalServiceAssets$/m);
    assert.equal((yaml.match(/^compileOnBuild:/gm) ?? []).length, 1);
    assert.doesNotMatch(yaml, /projectPath: \.\/old/);
  } finally {
    fs.rmSync(orgRoot, {recursive: true, force: true});
  }
});
