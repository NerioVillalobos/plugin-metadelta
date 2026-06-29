import fs from 'node:fs';
import path from 'node:path';

export function appendSessionStarted(logPath, {orgAlias, scope, startedAt}) {
  appendLogEntry(logPath, {
    event: 'SESSION_STARTED',
    startedAt,
    org: orgAlias,
    scope,
  });
}

export function appendSessionEnded(logPath, {orgAlias, scope, startedAt, endedAt, exitCode, reason}) {
  appendLogEntry(logPath, {
    event: 'SESSION_ENDED',
    startedAt,
    endedAt,
    org: orgAlias,
    scope,
    exitCode,
    reason,
  });
}

export function appendChangeLogEntries(logPath, rows, {orgAlias, detectedAt}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  const entries = rows.map((row) => JSON.stringify({
    event: 'CHANGE_DETECTED',
    detectedAt,
    org: orgAlias,
    source: row.source ?? 'unknown',
    action: row.action ?? 'UNKNOWN',
    type: row.type ?? 'Metadata',
    component: row.memberName ?? row.file ?? 'Unknown',
    file: row.file,
    previousFile: row.previousFile,
    lastModifiedDate: row.lastModifiedDate ?? null,
    lastModifiedBy: row.user ?? 'Unknown',
  }));
  fs.appendFileSync(logPath, `${entries.join('\n')}\n`, 'utf8');
}

export function exportChangeLogToCsv(logPath, csvPath) {
  const entries = readChangeLogEntries(logPath);
  const columns = [
    'event',
    'org',
    'scope',
    'source',
    'action',
    'type',
    'component',
    'file',
    'previousFile',
    'detectedAt',
    'lastModifiedDate',
    'lastModifiedBy',
    'startedAt',
    'endedAt',
    'exitCode',
    'reason',
  ];
  const lines = [
    columns.join(','),
    ...entries.map((entry) => columns.map((column) => csvValue(entry[column])).join(',')),
  ];
  fs.mkdirSync(path.dirname(csvPath), {recursive: true});
  fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');
  return {entries: entries.length, csvPath};
}

function appendLogEntry(logPath, entry) {
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function readChangeLogEntries(logPath) {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return fs.readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function csvValue(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const text = String(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
