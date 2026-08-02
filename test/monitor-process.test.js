import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {buildShellCommand, getCommandCandidates, runProcess, shouldUseShell} from '../src/utils/monitor/process.js';

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

test('buildShellCommand keeps Windows arguments with spaces together', () => {
  assert.equal(
    buildShellCommand('git', ['commit', '--allow-empty', '-m', 'metadelta monitor baseline'], 'win32'),
    'git commit --allow-empty -m "metadelta monitor baseline"'
  );
});

test('runProcess rejects cleanly when command cannot be spawned', async () => {
  await assert.rejects(
    () => runProcess(path.join(os.tmpdir(), 'metadelta-missing-command'), ['--version']),
    /ENOENT|spawn/
  );
});

test('runProcess rejects when a command exceeds timeoutMs', async () => {
  await assert.rejects(
    () => runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], {timeoutMs: 50}),
    /timed out/
  );
});
