import fs from 'node:fs';
import path from 'node:path';
import { runProcess } from './process.js';
const pathTypeMap = [
    { pattern: /(^|\/)flows\//, type: 'Flow', field: 'DeveloperName' },
    { pattern: /(^|\/)classes\//, type: 'ApexClass', field: 'Name' },
    { pattern: /(^|\/)objects\//, type: 'CustomObject', field: 'DeveloperName' },
    { pattern: /(^|\/)layouts\//, type: 'Layout', field: 'Name' },
    { pattern: /(^|\/)permissionsets\//, type: 'PermissionSet', field: 'Name' },
    { pattern: /(^|\/)profiles\//, type: 'Profile', field: 'Name' },
    { pattern: /(^|\/)lwc\//, type: 'LightningComponentBundle', field: 'DeveloperName' },
    { pattern: /(^|\/)aura\//, type: 'AuraDefinitionBundle', field: 'DeveloperName' },
    { pattern: /(^|\/)cleanDataServices\//, type: 'CleanDataService', field: 'DeveloperName' },
    { pattern: /(^|\/)OmniScript\//, type: 'OmniProcess', field: 'Name', source: 'vlocity' },
    { pattern: /(^|\/)DataRaptor\//, type: 'DRBundle', field: 'Name', source: 'vlocity' },
    { pattern: /(^|\/)IntegrationProcedure\//, type: 'IntegrationProcedure', field: 'Name', source: 'vlocity' },
    { pattern: /(^|\/)FlexCard\//, type: 'FlexCard', field: 'Name', source: 'vlocity' },
    { pattern: /(^|\/)EPC\//, type: 'EPC', field: 'Name', source: 'vlocity' },
];
export function classifyChange(file) {
    const normalized = file.split(path.sep).join('/');
    const mapping = pathTypeMap.find((item) => item.pattern.test(normalized));
    const baseName = mapping?.source === 'vlocity' ? vlocityMemberName(normalized, mapping.type) : path.basename(file)
        .replace(/\.xml$/i, '')
        .replace(/\.[^.]+-meta$/i, '')
        .replace(/-meta$/i, '')
        .replace(/\.flow-meta$/i, '')
        .replace(/\.[^.]+$/i, '');
    return {
        file,
        type: mapping?.type ?? inferTypeFromPath(normalized),
        source: mapping?.source ?? (normalized.includes('/vlocity/') ? 'vlocity' : 'salesforce'),
        memberName: baseName,
        queryField: mapping?.field ?? 'Name',
    };
}
function vlocityMemberName(file, type) {
    const parts = file.split('/');
    const typeIndex = parts.findIndex((part) => part === type || (type === 'DRBundle' && part === 'DataRaptor'));
    if (typeIndex >= 0 && parts[typeIndex + 1]) {
        return parts[typeIndex + 1];
    }
    return path.basename(file).replace(/_AllRelationshipKeys\.json$/i, '').replace(/\.[^.]+$/i, '');
}
export async function enrichChanges(changes, orgAlias, gitRoot, getDiffSummary) {
    const rows = [];
    for (const change of changes) {
        const classified = classifyChange(change.file);
        const metadata = classified.source === 'salesforce'
            ? await queryMetadata(orgAlias, classified)
            : readVlocityMetadata(path.join(gitRoot, change.file));
        const summary = await getDiffSummary(gitRoot, change.file);
        rows.push({
            ...change,
            ...classified,
            user: metadata.user ?? 'Unknown',
            lastModifiedDate: metadata.lastModifiedDate,
            query: metadata.query,
            diffSummary: summary,
        });
    }
    return rows;
}
async function queryMetadata(orgAlias, classified) {
    const escapedName = classified.memberName.replace(/'/g, "\\'");
    const query = [
        'SELECT Id, Name, LastModifiedBy.Name, LastModifiedDate',
        `FROM ${classified.type}`,
        `WHERE ${classified.queryField} = '${escapedName}'`,
        'LIMIT 1',
    ].join(' ');
    for (const args of [
        ['data', 'query', '--query', query, '--target-org', orgAlias, '--use-tooling-api', '--json'],
        ['data', 'query', '--query', query, '--target-org', orgAlias, '--json'],
    ]) {
        try {
            const { stdout } = await runProcess('sf', args);
            const parsed = JSON.parse(stdout);
            const record = parsed.result?.records?.[0];
            if (record) {
                return {
                    user: record.LastModifiedBy?.Name ?? record.LastModifiedByName ?? 'Unknown',
                    lastModifiedDate: record.LastModifiedDate ?? null,
                    query,
                };
            }
        }
        catch {
            // Keep the monitor alive when a metadata type is not queryable.
        }
    }
    const listMetadata = await queryListMetadata(orgAlias, classified);
    return listMetadata ?? { user: 'Unknown', lastModifiedDate: null, query };
}
async function queryListMetadata(orgAlias, classified) {
    const args = ['org', 'list', 'metadata', '--metadata-type', classified.type, '--target-org', orgAlias, '--json'];
    try {
        const { stdout } = await runProcess('sf', args);
        const parsed = JSON.parse(stdout);
        const records = Array.isArray(parsed.result) ? parsed.result : [];
        const record = records.find((item) => {
            const fullName = item.fullName ?? item.fileName ?? '';
            return fullName === classified.memberName || fullName.endsWith(`/${classified.memberName}`) || fullName.includes(classified.memberName);
        });
        if (!record) {
            return null;
        }
        return {
            user: record.lastModifiedByName ?? 'Unknown',
            lastModifiedDate: record.lastModifiedDate ?? null,
            query: `sf org list metadata --metadata-type ${classified.type} --target-org ${orgAlias}`,
        };
    }
    catch {
        return null;
    }
}
function readVlocityMetadata(filePath) {
    const candidates = [filePath, ...siblingJsonFiles(filePath)];
    for (const candidate of candidates) {
        const metadata = readJsonMetadata(candidate);
        if (metadata.user !== 'N/A' || metadata.lastModifiedDate) {
            return metadata;
        }
    }
    return {
        user: 'N/A',
        lastModifiedDate: null,
        query: 'Vlocity DataPack metadata was not available in the exported JSON files.',
    };
}
function siblingJsonFiles(filePath) {
    const dir = path.dirname(filePath);
    try {
        return fs
            .readdirSync(dir)
            .filter((name) => name.endsWith('.json') && !name.endsWith('_AllRelationshipKeys.json'))
            .map((name) => path.join(dir, name));
    }
    catch {
        return [];
    }
}
function readJsonMetadata(filePath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const lastModifiedDate = findValue(parsed, ['LastModifiedDate', 'LastModifiedDate__c', 'lastModifiedDate']) ?? null;
        const user = findValue(parsed, [
            'LastModifiedBy.Name',
            'LastModifiedByName',
            'LastModifiedById',
            'lastModifiedByName',
            'VlocityLastModifiedByName',
        ]) ?? 'N/A';
        return {
            user,
            lastModifiedDate,
            query: `Read Vlocity metadata from ${path.basename(filePath)}`,
        };
    }
    catch {
        return { user: 'N/A', lastModifiedDate: null, query: `Could not parse ${path.basename(filePath)}` };
    }
}
function findValue(value, keys) {
    for (const key of keys) {
        const direct = findByPath(value, key);
        if (direct) {
            return direct;
        }
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findValue(item, keys);
            if (found) {
                return found;
            }
        }
        return null;
    }
    if (value && typeof value === 'object') {
        for (const nested of Object.values(value)) {
            const found = findValue(nested, keys);
            if (found) {
                return found;
            }
        }
    }
    return null;
}
function findByPath(value, key) {
    const parts = key.split('.');
    let current = value;
    for (const part of parts) {
        if (!current || typeof current !== 'object' || !(part in current)) {
            return null;
        }
        current = current[part];
    }
    return typeof current === 'string' && current.length > 0 ? current : null;
}
function inferTypeFromPath(file) {
    const parts = file.split('/');
    const index = parts.findIndex((part) => part === 'default');
    if (index >= 0 && parts[index + 1]) {
        return parts[index + 1].replace(/s$/i, '');
    }
    return parts.at(-2) ?? 'Metadata';
}
