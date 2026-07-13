import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {toVlocityRelativePath} from '../src/utils/monitor/retriever.js';

test('toVlocityRelativePath uses portable relative paths for Vlocity CLI', () => {
  const orgRoot = path.join('C:', 'Users', 'Nerio', '.metadelta', 'monitor', 'Telecentro-demo');
  const jobPath = path.join(orgRoot, 'manifest', 'monitor-vlocity-export.yaml');
  assert.equal(toVlocityRelativePath(orgRoot, jobPath), 'manifest/monitor-vlocity-export.yaml');
});
