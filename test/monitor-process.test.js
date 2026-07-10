import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {getCommandCandidates, runProcess, shouldUseShell} from '../src/utils/monitor/process.js';

test('getCommandCandidates includes Windows command shims for bare commands', () => {
  assert.deepEqual(getCommandCandidates('sf', 'win32'), ['sf', 'sf.cmd', 'sf.exe', 'sf.bat']);
  assert.deepEqual(getCommandCandidates('vlocity', 'win32'), ['vlocity', 'vlocity.cmd', 'vlocity.exe', 'vlocity.bat']);
});

test('getCommandCandidates leaves non-Windows and explicit paths unchanged', () => {
  assert.deepEqual(getCommandCandidates('sf', 'linux'), ['sf']);
  assert.deepEqual(getCommandCandidates('sf.cmd', 'win32'), ['sf.cmd']);
  assert.deepEqual(getCommandCandidates('C:\\Tools\\sf.cmd', 'win32'), ['C:\\Tools\\sf.cmd']);
});

test('shouldUseShell is enabled only on Windows for command shims', () => {
  assert.equal(shouldUseShell('win32'), true);
  assert.equal(shouldUseShell('linux'), false);
  assert.equal(shouldUseShell('darwin'), false);
});

test('runProcess rejects cleanly when command cannot be spawned', async () => {
  await assert.rejects(
    () => runProcess(path.join(os.tmpdir(), 'metadelta-missing-command'), ['--version']),
    /ENOENT|spawn/
  );
});
