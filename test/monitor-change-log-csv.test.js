import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendChangeLogEntries,
  appendSessionEnded,
  appendSessionStarted,
  exportChangeLogToCsv,
} from '../src/utils/monitor/changeLog.js';

test('exportChangeLogToCsv exports monitor JSONL events with stable CSV columns', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-monitor-log-'));
  const logPath = path.join(tmp, 'change-log.jsonl');
  const csvPath = path.join(tmp, 'change-log.csv');

  appendSessionStarted(logPath, {
    orgAlias: 'Telecentro-qa',
    scope: 'all-custom',
    startedAt: '2026-06-26T22:02:51.033Z',
  });
  appendChangeLogEntries(logPath, [
    {
      source: 'vlocity',
      action: 'MODIFIED',
      type: 'Promotion',
      memberName: 'Promo, Internet',
      file: 'Telecentro-qa/current/vlocity/Promotion/abc/Promo.json',
      lastModifiedDate: '2026-06-26T22:17:19.783Z',
      user: 'Luis "QA" Ramírez',
    },
  ], {
    orgAlias: 'Telecentro-qa',
    detectedAt: '2026-06-26T22:17:19.783Z',
  });
  appendSessionEnded(logPath, {
    orgAlias: 'Telecentro-qa',
    scope: 'all-custom',
    startedAt: '2026-06-26T22:02:51.033Z',
    endedAt: '2026-06-26T23:34:02.985Z',
    exitCode: 0,
    reason: 'USER_EXIT',
  });

  const result = exportChangeLogToCsv(logPath, csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');

  assert.equal(result.entries, 3);
  assert.match(csv, /^event,org,scope,source,action,type,component,file,previousFile,detectedAt,lastModifiedDate,lastModifiedBy,startedAt,endedAt,exitCode,reason\n/);
  assert.match(csv, /CHANGE_DETECTED,Telecentro-qa,,vlocity,MODIFIED,Promotion,"Promo, Internet"/);
  assert.match(csv, /"Luis ""QA"" Ramírez"/);
  assert.match(csv, /SESSION_ENDED,Telecentro-qa,all-custom/);
});
