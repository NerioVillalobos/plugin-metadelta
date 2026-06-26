import fs from 'node:fs';
import path from 'node:path';
export function appendChangeLogEntries(logPath, rows, { orgAlias, detectedAt }) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return;
    }
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const entries = rows.map((row) => JSON.stringify({
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
