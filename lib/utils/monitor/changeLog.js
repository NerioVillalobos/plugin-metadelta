import fs from 'node:fs';
import path from 'node:path';
export function appendSessionStarted(logPath, { orgAlias, scope, startedAt }) {
    appendLogEntry(logPath, {
        event: 'SESSION_STARTED',
        startedAt,
        org: orgAlias,
        scope,
    });
}
export function appendSessionEnded(logPath, { orgAlias, scope, startedAt, endedAt, exitCode, reason }) {
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
export function appendChangeLogEntries(logPath, rows, { orgAlias, detectedAt }) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return;
    }
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
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
function appendLogEntry(logPath, entry) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}
