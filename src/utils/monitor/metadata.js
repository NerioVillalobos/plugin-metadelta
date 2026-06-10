import path from 'node:path';
import {runProcess} from './process.js';

const pathTypeMap = [
  {pattern: /(^|\/)flows\//, type: 'Flow', field: 'DeveloperName'},
  {pattern: /(^|\/)classes\//, type: 'ApexClass', field: 'Name'},
  {pattern: /(^|\/)objects\//, type: 'CustomObject', field: 'DeveloperName'},
  {pattern: /(^|\/)layouts\//, type: 'Layout', field: 'Name'},
  {pattern: /(^|\/)permissionsets\//, type: 'PermissionSet', field: 'Name'},
  {pattern: /(^|\/)profiles\//, type: 'Profile', field: 'Name'},
  {pattern: /(^|\/)lwc\//, type: 'LightningComponentBundle', field: 'DeveloperName'},
  {pattern: /(^|\/)aura\//, type: 'AuraDefinitionBundle', field: 'DeveloperName'},
  {pattern: /(^|\/)OmniScript\//, type: 'OmniProcess', field: 'Name', source: 'vlocity'},
  {pattern: /(^|\/)DataRaptor\//, type: 'DRBundle', field: 'Name', source: 'vlocity'},
  {pattern: /(^|\/)IntegrationProcedure\//, type: 'IntegrationProcedure', field: 'Name', source: 'vlocity'},
  {pattern: /(^|\/)FlexCard\//, type: 'FlexCard', field: 'Name', source: 'vlocity'},
  {pattern: /(^|\/)EPC\//, type: 'EPC', field: 'Name', source: 'vlocity'},
];

export function classifyChange(file) {
  const normalized = file.split(path.sep).join('/');
  const mapping = pathTypeMap.find((item) => item.pattern.test(normalized));
  const baseName = path.basename(file)
    .replace(/\.xml$/i, '')
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

export async function enrichChanges(changes, orgAlias, gitRoot, getDiffSummary) {
  const rows = [];
  for (const change of changes) {
    const classified = classifyChange(change.file);
    const metadata = classified.source === 'salesforce'
      ? await queryMetadata(orgAlias, classified)
      : {user: 'N/A', lastModifiedDate: null, query: 'Vlocity DataPack metadata is read from local export.'};
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
      const {stdout} = await runProcess('sf', args);
      const parsed = JSON.parse(stdout);
      const record = parsed.result?.records?.[0];
      if (record) {
        return {
          user: record.LastModifiedBy?.Name ?? 'Unknown',
          lastModifiedDate: record.LastModifiedDate ?? null,
          query,
        };
      }
    } catch {
      // Keep the monitor alive when a metadata type is not queryable.
    }
  }

  return {user: 'Unknown', lastModifiedDate: null, query};
}

function inferTypeFromPath(file) {
  const parts = file.split('/');
  const index = parts.findIndex((part) => part === 'default');
  if (index >= 0 && parts[index + 1]) {
    return parts[index + 1].replace(/s$/i, '');
  }
  return parts.at(-2) ?? 'Metadata';
}
