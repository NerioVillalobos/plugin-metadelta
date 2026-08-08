import test from 'node:test';
import assert from 'node:assert/strict';
import {getCommandCandidates, runCommandSync} from '../src/utils/command.js';

test('command candidates include Windows shims for bare executables', () => {
  assert.deepEqual(getCommandCandidates('sf', 'win32'), ['sf', 'sf.cmd', 'sf.exe', 'sf.bat']);
  assert.deepEqual(getCommandCandidates('npm', 'win32'), ['npm', 'npm.cmd', 'npm.exe', 'npm.bat']);
});

test('runCommandSync preserves arguments without shell interpolation', () => {
  const result = runCommandSync(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'A&B !value! %PATH%']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'A&B !value! %PATH%');
});
