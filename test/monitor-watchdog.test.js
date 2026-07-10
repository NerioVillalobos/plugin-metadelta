import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addWatchTarget,
  buildMessageCard,
  buildMonitorRunArgs,
  processWatchTarget,
  readNewEntries,
  updateWatchTarget,
} from '../src/utils/monitor/watchdog.js';

test('readNewEntries processes only complete JSONL lines and preserves incomplete tail', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-watchdog-'));
  const logPath = path.join(tmp, 'change-log.jsonl');
  fs.writeFileSync(logPath, '{"event":"SESSION_STARTED"}\n{"event":"CHANGE_DETECTED"', 'utf8');

  const result = readNewEntries(logPath, 0);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].line, '{"event":"SESSION_STARTED"}');
  assert.equal(result.entries[0].endOffset, Buffer.byteLength('{"event":"SESSION_STARTED"}\n'));
});

test('processWatchTarget alerts only for non-allowlisted changes from today and advances offset', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-watchdog-'));
  const logPath = path.join(tmp, 'change-log.jsonl');
  const today = '2026-07-10T12:00:00.000Z';
  fs.writeFileSync(logPath, [
    JSON.stringify({event: 'SESSION_STARTED'}),
    JSON.stringify({
      event: 'CHANGE_DETECTED',
      detectedAt: today,
      org: 'DEV',
      action: 'MODIFIED',
      type: 'ApexClass',
      component: 'Allowed',
      lastModifiedBy: 'Nerio Villalobos',
    }),
    JSON.stringify({
      event: 'CHANGE_DETECTED',
      detectedAt: today,
      org: 'DEV',
      action: 'MODIFIED',
      type: 'ApexClass',
      component: 'Unauthorized',
      lastModifiedBy: 'Jane Smith',
    }),
    '',
  ].join('\n'), 'utf8');

  const posted = [];
  const state = {};
  const summary = await processWatchTarget(
    {org: 'DEV', logPath},
    {
      webhookUrl: 'https://example.invalid/webhook',
      devopsAllowlist: ['Nerio Villalobos'],
      ignoreEvents: ['SESSION_STARTED', 'SESSION_ENDED'],
    },
    state,
    {
      now: today,
      postToTeams: async (_url, payload) => {
        posted.push(payload);
      },
    }
  );

  assert.equal(summary.alerts, 1);
  assert.equal(summary.errors, 0);
  assert.equal(posted[0].sections[0].facts.find((fact) => fact.name === 'Componente').value, 'Unauthorized');
  assert.equal(state[logPath].offset, fs.statSync(logPath).size);
});

test('buildMessageCard understands monitor action names', () => {
  const card = buildMessageCard({
    org: 'DEV',
    action: 'DELETED',
    type: 'CustomObject',
    component: 'Account',
    lastModifiedBy: 'QA User',
  });

  assert.equal(card.themeColor, 'D93025');
  assert.equal(card.sections[0].facts.find((fact) => fact.name === 'Accion').value, 'Eliminado');
});

test('watch target config stores custom XML and YAML scopes for monitor command generation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-watchdog-'));
  const configPath = path.join(tmp, 'watchdog.config.json');
  const xmlPath = path.join(tmp, 'Release.xml');
  const yamlPath = path.join(tmp, 'Release.yaml');
  fs.writeFileSync(xmlPath, '<Package/>', 'utf8');
  fs.writeFileSync(yamlPath, 'projectPath: .', 'utf8');

  addWatchTarget(configPath, 'Telecentro-qa', {interval: 8});
  const {target} = updateWatchTarget(configPath, 'Telecentro-qa', {
    scopeXml: xmlPath,
    scopeYaml: yamlPath,
  });
  const args = buildMonitorRunArgs(target);

  assert.deepEqual(args, [
    'metadelta',
    'monitor',
    'run',
    '--org',
    'Telecentro-qa',
    '--interval',
    '8',
    '--scope-xml',
    xmlPath,
    '--scope-yaml',
    yamlPath,
    '--export-csv',
    path.join(os.homedir(), '.metadelta', 'Telecentro-qa-metadelta-monitor.csv'),
  ]);
});
