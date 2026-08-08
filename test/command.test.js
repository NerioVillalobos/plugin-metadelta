import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildWindowsShimInvocation, getCommandCandidates, runCommandSync} from '../src/utils/command.js';

test('command candidates include Windows shims for bare executables', () => {
  assert.deepEqual(getCommandCandidates('sf', 'win32'), ['sf', 'sf.cmd', 'sf.exe', 'sf.bat']);
  assert.deepEqual(getCommandCandidates('npm', 'win32'), ['npm', 'npm.cmd', 'npm.exe', 'npm.bat']);
});

test('runCommandSync preserves arguments without shell interpolation', () => {
  const result = runCommandSync(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'A&B !value! %PATH%']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'A&B !value! %PATH%');
});

test('Windows shims are invoked through cmd.exe with one escaped command line', () => {
  const invocation = buildWindowsShimInvocation(
    'C:\\Program Files\\Salesforce\\sf.cmd',
    ['data', 'query', '--query', "SELECT Id FROM User WHERE Name = 'A&B'", 'A&B !value! %PATH%'],
    {ComSpec: 'C:\\Windows\\System32\\cmd.exe'}
  );

  assert.equal(invocation.executable, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(invocation.windowsVerbatimArguments, true);
  assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(invocation.args[3], /^""C:\\Program Files\\Salesforce\\sf\.cmd"/);
  assert.match(invocation.args[3], /\^%PATH\^%""$/);
  assert.match(invocation.args[3], /C:\\Program Files\\Salesforce\\sf\.cmd/);
  assert.match(invocation.args[3], /\^&/);
  assert.match(invocation.args[3], /\^%PATH\^%/);
  assert.match(invocation.args[3], /\^!value\^!/);
});

test('executes a real Windows cmd shim without interpolating arguments', {skip: process.platform !== 'win32'}, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-cmd-'));
  const shimPath = path.join(tempDir, 'echo-args.cmd');
  fs.writeFileSync(shimPath, '@echo off\r\nnode -e "process.stdout.write(process.argv.slice(1).join(\'|\'))" %*\r\n', 'utf8');

  try {
    const result = runCommandSync(shimPath, ['A&B', '%PATH%', '!value!']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'A&B|%PATH%|!value!');
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
});
