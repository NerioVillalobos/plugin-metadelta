import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ensurePlaywrightTestDependency, resolveInstalledPlaywrightRuntime, buildFrontdoorUrlFromOrgDisplay} from '../src/utils/task/orchestrator.js';

function createFakeSfCli(baseDir, handlerSource) {
  const binPath = path.join(baseDir, process.platform === 'win32' ? 'sf.cmd' : 'sf');
  const script = `#!/usr/bin/env node\n${handlerSource}\n`;
  fs.writeFileSync(binPath, script, 'utf8');
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

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


test('buildFrontdoorUrlFromOrgDisplay uses org display verbose with SF_TEMP_SHOW_SECRETS workaround', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-sf-'));
  const callsFile = path.join(tmp, 'calls.json');
  const fakeSf = createFakeSfCli(
    tmp,
    `
const fs = require('node:fs');
const callsFile = ${JSON.stringify(callsFile)};
const calls = fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8')) : [];
calls.push({args: process.argv.slice(2), showSecrets: process.env.SF_TEMP_SHOW_SECRETS});
fs.writeFileSync(callsFile, JSON.stringify(calls), 'utf8');
const args = process.argv.slice(2);
if (args.includes('display') && args.includes('--verbose') && process.env.SF_TEMP_SHOW_SECRETS === 'true') {
  console.log(JSON.stringify({status: 0, result: {instanceUrl: 'https://example.my.salesforce.com', accessToken: 'real token'}}));
  process.exit(0);
}
console.error('unexpected command: ' + args.join(' '));
process.exit(1);
`
  );

  const previous = process.env.SF_BINPATH;
  process.env.SF_BINPATH = fakeSf;
  try {
    const url = buildFrontdoorUrlFromOrgDisplay('TLC-EPC');
    const calls = JSON.parse(fs.readFileSync(callsFile, 'utf8'));

    assert.equal(url, 'https://example.my.salesforce.com/secur/frontdoor.jsp?sid=real%20token');
    assert.deepEqual(calls, [
      {args: ['org', 'display', '--target-org', 'TLC-EPC', '--verbose', '--json'], showSecrets: 'true'},
    ]);
  } finally {
    if (previous === undefined) {
      delete process.env.SF_BINPATH;
    } else {
      process.env.SF_BINPATH = previous;
    }
  }
});

test('buildFrontdoorUrlFromOrgDisplay falls back to org open when display verbose returns a redacted token', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-sf-'));
  const callsFile = path.join(tmp, 'calls.json');
  const fakeSf = createFakeSfCli(
    tmp,
    `
const fs = require('node:fs');
const callsFile = ${JSON.stringify(callsFile)};
const calls = fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8')) : [];
calls.push({args: process.argv.slice(2), showSecrets: process.env.SF_TEMP_SHOW_SECRETS});
fs.writeFileSync(callsFile, JSON.stringify(calls), 'utf8');
const args = process.argv.slice(2);
if (args.includes('display') && args.includes('--verbose')) {
  console.log(JSON.stringify({status: 0, result: {instanceUrl: 'https://example.my.salesforce.com', accessToken: '[REDACTED]'}}));
  process.exit(0);
}
if (args.includes('open') && args.includes('--url-only')) {
  console.log(JSON.stringify({status: 0, result: {url: 'https://example.my.salesforce.com/secur/frontdoor.jsp?sid=from-open'}}));
  process.exit(0);
}
console.error('unexpected command: ' + args.join(' '));
process.exit(1);
`
  );

  const previous = process.env.SF_BINPATH;
  process.env.SF_BINPATH = fakeSf;
  try {
    const url = buildFrontdoorUrlFromOrgDisplay('TLC-EPC');
    const calls = JSON.parse(fs.readFileSync(callsFile, 'utf8'));

    assert.equal(url, 'https://example.my.salesforce.com/secur/frontdoor.jsp?sid=from-open');
    assert.deepEqual(calls, [
      {args: ['org', 'display', '--target-org', 'TLC-EPC', '--verbose', '--json'], showSecrets: 'true'},
      {args: ['org', 'open', '--target-org', 'TLC-EPC', '--url-only', '--json']},
    ]);
  } finally {
    if (previous === undefined) {
      delete process.env.SF_BINPATH;
    } else {
      process.env.SF_BINPATH = previous;
    }
  }
});

test('metadelta access obtains SFDX auth URL from org display verbose with SF_TEMP_SHOW_SECRETS', async () => {
  const {default: Access} = await import('../src/commands/metadelta/access.js');
  const access = Object.create(Access.prototype);
  let received;
  access.runJSON = (cmd, args, options) => {
    received = {cmd, args, showSecrets: options?.env?.SF_TEMP_SHOW_SECRETS};
    return {status: 0, result: {sfdxAuthUrl: 'force://PlatformCLI::refresh@example.my.salesforce.com'}};
  };

  const authUrl = access.getSfdxAuthUrl('TLC-EPC');

  assert.equal(authUrl, 'force://PlatformCLI::refresh@example.my.salesforce.com');
  assert.deepEqual(received, {
    cmd: 'sf',
    args: ['org', 'display', '--target-org', 'TLC-EPC', '--json', '--verbose'],
    showSecrets: 'true',
  });
});
