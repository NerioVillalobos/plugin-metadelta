import fs from 'node:fs';
import path from 'node:path';
import {runProcess} from './process.js';

const pathTypeMap = [
  {pattern: /(^|\/)flows\//, type: 'Flow', field: 'DeveloperName'},
  {pattern: /(^|\/)classes\//, type: 'ApexClass', field: 'Name'},
  {pattern: /(^|\/)triggers\//, type: 'ApexTrigger', field: 'Name'},
  {pattern: /(^|\/)pages\//, type: 'ApexPage', field: 'Name'},
  {pattern: /(^|\/)components\//, type: 'ApexComponent', field: 'Name'},
  {pattern: /(^|\/)flexipages\//, type: 'FlexiPage', field: 'DeveloperName'},
  {pattern: /(^|\/)applications\//, type: 'CustomApplication', field: 'DeveloperName'},
  {pattern: /(^|\/)tabs\//, type: 'CustomTab', field: 'DeveloperName'},
  {pattern: /(^|\/)staticresources\//, type: 'StaticResource', field: 'Name'},
  {pattern: /(^|\/)labels\//, type: 'CustomLabels', field: 'Name'},
  {pattern: /(^|\/)quickActions\//, type: 'QuickAction', field: 'DeveloperName'},
  {pattern: /(^|\/)remoteSiteSettings\//, type: 'RemoteSiteSetting', field: 'Name'},
  {pattern: /(^|\/)settings\//, type: 'Settings', field: 'Name'},
  {pattern: /(^|\/)email\//, type: 'EmailTemplate', field: 'Name', member: 'nested'},
  {pattern: /(^|\/)workflows\//, type: 'Workflow', field: 'Name'},
  {pattern: /(^|\/)groups\//, type: 'Group', field: 'DeveloperName'},
  {pattern: /(^|\/)queues\//, type: 'Queue', field: 'DeveloperName'},
  {pattern: /(^|\/)reports\//, type: 'Report', field: 'DeveloperName', member: 'nested'},
  {pattern: /(^|\/)dashboards\//, type: 'Dashboard', field: 'DeveloperName', member: 'nested'},
  {pattern: /(^|\/)reportTypes\//, type: 'ReportType', field: 'DeveloperName'},
  {pattern: /(^|\/)matchingRules\//, type: 'MatchingRules', field: 'DeveloperName'},
  {pattern: /(^|\/)duplicateRules\//, type: 'DuplicateRule', field: 'DeveloperName'},
  {pattern: /(^|\/)objects\/[^/]+\/fields\//, type: 'CustomField', field: 'DeveloperName', member: 'objectChild'},
  {pattern: /(^|\/)objects\/[^/]+\/validationRules\//, type: 'ValidationRule', field: 'ValidationName', member: 'objectChild'},
  {pattern: /(^|\/)objects\/[^/]+\/webLinks\//, type: 'WebLink', field: 'Name', member: 'objectChild'},
  {pattern: /(^|\/)objects\/[^/]+\/listViews\//, type: 'ListView', field: 'DeveloperName', member: 'objectChild'},
  {pattern: /(^|\/)objects\/[^/]+\/compactLayouts\//, type: 'CompactLayout', field: 'DeveloperName', member: 'objectChild'},
  {pattern: /(^|\/)objects\/[^/]+\/recordTypes\//, type: 'RecordType', field: 'DeveloperName', member: 'objectChild'},
  {pattern: /(^|\/)objects\/[^/]+\/businessProcesses\//, type: 'BusinessProcess', field: 'Name', member: 'objectChild'},
  {pattern: /(^|\/)objects\/[^/]+\/fieldSets\//, type: 'FieldSet', field: 'DeveloperName', member: 'objectChild'},
  {pattern: /(^|\/)objects\/[^/]+\/sharingReasons\//, type: 'SharingReason', field: 'DeveloperName', member: 'objectChild'},
  {pattern: /(^|\/)objects\/[^/]+\/sharingRules\//, type: 'SharingRules', field: 'Name', member: 'objectChild'},
  {pattern: /(^|\/)objects\//, type: 'CustomObject', field: 'DeveloperName'},
  {pattern: /(^|\/)layouts\//, type: 'Layout', field: 'Name'},
  {pattern: /(^|\/)permissionsets\//, type: 'PermissionSet', field: 'Name'},
  {pattern: /(^|\/)profiles\//, type: 'Profile', field: 'Name'},
  {pattern: /(^|\/)lwc\//, type: 'LightningComponentBundle', field: 'DeveloperName', member: 'bundle'},
  {pattern: /(^|\/)aura\//, type: 'AuraDefinitionBundle', field: 'DeveloperName', member: 'bundle'},
  {pattern: /(^|\/)cleanDataServices\//, type: 'CleanDataService', field: 'DeveloperName'},
  {pattern: /(^|\/)OmniScript\//, type: 'OmniProcess', field: 'Name', source: 'vlocity'},
  {pattern: /(^|\/)DataRaptor\//, type: 'DRBundle', field: 'Name', source: 'vlocity'},
  {pattern: /(^|\/)IntegrationProcedure\//, type: 'IntegrationProcedure', field: 'Name', source: 'vlocity'},
  {pattern: /(^|\/)FlexCard\//, type: 'FlexCard', field: 'Name', source: 'vlocity'},
  {pattern: /(^|\/)EPC\//, type: 'EPC', field: 'Name', source: 'vlocity'},
];

const vlocityDatapackQueries = {
  AttributeAssignmentRule: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__AttributeAssignmentRule__c',
  AttributeCategory: 'SELECT Id, Name, %vlocity_namespace%__Code__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__AttributeCategory__c',
  CalculationMatrix: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__CalculationMatrix__c',
  CalculationProcedure: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__CalculationProcedure__c',
  Catalog: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__Catalog__c',
  ContextAction: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ContextAction__c',
  ContextDimension: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ContextDimension__c',
  ContextScope: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ContextScope__c',
  ContractType: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ContractType__c',
  DataRaptor: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__DRBundle__c WHERE %vlocity_namespace%__Type__c != \'Migration\'',
  DocumentClause: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__DocumentClause__c',
  DocumentTemplate: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__DocumentTemplate__c',
  EntityFilter: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__EntityFilter__c',
  IntegrationProcedure: 'SELECT Id, %vlocity_namespace%__Type__c, %vlocity_namespace%__SubType__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OmniScript__c WHERE %vlocity_namespace%__IsActive__c = true AND %vlocity_namespace%__IsProcedure__c = true',
  InterfaceImplementation: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__InterfaceImplementation__c',
  ItemImplementation: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ItemImplementation__c',
  ManualQueue: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ManualQueue__c',
  ObjectClass: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ObjectClass__c',
  ObjectContextRule: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ObjectRuleAssignment__c',
  ObjectLayout: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ObjectLayout__c',
  OmniScript: 'SELECT Id, %vlocity_namespace%__Type__c, %vlocity_namespace%__SubType__c, %vlocity_namespace%__Language__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OmniScript__c WHERE %vlocity_namespace%__IsActive__c = true AND %vlocity_namespace%__IsProcedure__c = false',
  OrchestrationDependencyDefinition: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OrchestrationDependencyDefinition__c',
  OrchestrationItemDefinition: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OrchestrationItemDefinition__c',
  OrchestrationPlanDefinition: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OrchestrationPlanDefinition__c',
  PriceList: 'SELECT Id, Name, %vlocity_namespace%__Code__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__PriceList__c',
  Pricebook2: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM Pricebook2',
  PricingPlan: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__PricingPlan__c',
  PricingVariable: 'SELECT Id, Name, %vlocity_namespace%__Code__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__PricingVariable__c',
  Product2: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM Product2',
  Promotion: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__Promotion__c',
  QueryBuilder: 'SELECT Id, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__QueryBuilder__c',
  Rule: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__Rule__c',
  StoryObjectConfiguration: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__StoryObjectConfiguration__c',
  System: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__System__c',
  TimePlan: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__TimePlan__c',
  TimePolicy: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__TimePolicy__c',
  UIFacet: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__UIFacet__c',
  UISection: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__UISection__c',
  VlocityAction: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocityAction__c WHERE %vlocity_namespace%__IsActive__c = true',
  VlocityCard: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocityCard__c WHERE %vlocity_namespace%__Active__c = true',
  VlocityFunction: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocityFunction__c',
  VlocityPicklist: 'SELECT Id, Name, %vlocity_namespace%__GlobalKey__c, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__Picklist__c',
  VlocitySearchWidgetSetup: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocitySearchWidgetSetup__c',
  VlocityStateModel: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocityStateModel__c',
  VlocityUILayout: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocityUILayout__c WHERE %vlocity_namespace%__Active__c = true',
  VlocityUITemplate: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocityUITemplate__c WHERE %vlocity_namespace%__Active__c = true',
  VqMachine: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VqMachine__c',
  VqResource: 'SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VqResource__c',
};

const globalKeyTypes = new Set([
  'ContextAction',
  'ContextDimension',
  'ContextScope',
  'EntityFilter',
  'ObjectClass',
  'ObjectLayout',
  'OrchestrationDependencyDefinition',
  'Product2',
  'Promotion',
  'Rule',
  'TimePlan',
  'TimePolicy',
  'UIFacet',
  'UISection',
  'VlocityFunction',
  'VlocityPicklist',
]);

const codeTypes = new Set(['AttributeCategory', 'PriceList', 'PricingVariable']);

export function classifyChange(file) {
  const normalized = file.split(path.sep).join('/');
  const mapping = pathTypeMap.find((item) => item.pattern.test(normalized));
  const vlocityPathInfo = getVlocityPathInfo(normalized);
  const source = mapping?.source ?? (vlocityPathInfo ? 'vlocity' : 'salesforce');
  const type = mapping?.type ?? vlocityPathInfo?.type ?? inferTypeFromPath(normalized);
  const baseName = mapping?.source === 'vlocity'
    ? vlocityMemberName(normalized, mapping.type)
    : salesforceMemberName(normalized, mapping);
  return {
    file,
    type,
    source,
    memberName: source === 'vlocity' ? (vlocityPathInfo?.memberName ?? baseName) : baseName,
    queryField: mapping?.field ?? 'Name',
  };
}

function salesforceMemberName(file, mapping) {
  if (mapping?.member === 'bundle') {
    return memberAfterFolder(file, mapping.pattern) ?? stripSourceSuffix(path.basename(file));
  }
  if (mapping?.member === 'objectChild') {
    const parts = file.split('/');
    const objectIndex = parts.findIndex((part) => part === 'objects');
    if (objectIndex >= 0 && parts[objectIndex + 1]) {
      return `${parts[objectIndex + 1]}.${stripSourceSuffix(path.basename(file))}`;
    }
  }
  if (mapping?.member === 'nested') {
    const parts = file.split('/');
    const folderIndex = parts.findIndex((part, index) => index > 0 && mapping.pattern.test(`/${part}/`));
    if (folderIndex >= 0 && parts[folderIndex + 1] && parts[folderIndex + 2]) {
      return `${parts[folderIndex + 1]}/${stripSourceSuffix(path.basename(file))}`;
    }
  }
  return stripSourceSuffix(path.basename(file));
}

function memberAfterFolder(file, pattern) {
  const parts = file.split('/');
  const folderIndex = parts.findIndex((part) => pattern.test(`/${part}/`));
  return folderIndex >= 0 ? parts[folderIndex + 1] : null;
}

function stripSourceSuffix(fileName) {
  const metadataSuffixMatch = fileName.match(/^(.*)\.[^.]+-meta\.xml$/i);
  if (metadataSuffixMatch) {
    return metadataSuffixMatch[1];
  }
  return fileName
    .replace(/-meta\.xml$/i, '')
    .replace(/\.xml$/i, '')
    .replace(/\.[^.]+$/i, '');
}

function vlocityMemberName(file, type) {
  const parts = file.split('/');
  const typeIndex = parts.findIndex((part) => part === type || (type === 'DRBundle' && part === 'DataRaptor'));
  if (typeIndex >= 0 && parts[typeIndex + 1]) {
    return parts[typeIndex + 1];
  }
  return path.basename(file).replace(/_AllRelationshipKeys\.json$/i, '').replace(/\.[^.]+$/i, '');
}

function getVlocityPathInfo(file) {
  const parts = file.split('/');
  const index = parts.findIndex((part) => part.toLowerCase() === 'vlocity');
  if (index < 0 || !parts[index + 1]) {
    return null;
  }
  return {
    type: parts[index + 1],
    memberName: parts[index + 2] ?? path.basename(file).replace(/_AllRelationshipKeys\.json$/i, '').replace(/\.[^.]+$/i, ''),
  };
}

export async function enrichChanges(changes, orgAlias, gitRoot, getDiffSummary) {
  const rows = [];
  const context = {namespace: undefined, metadataCache: new Map()};
  for (const change of changes) {
    const classified = classifyChange(change.file);
    const metadata = classified.source === 'salesforce'
      ? await queryMetadata(orgAlias, classified)
      : await queryVlocityMetadata(orgAlias, classified, path.join(gitRoot, change.file), context);
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

async function queryVlocityMetadata(orgAlias, classified, filePath, context) {
  const cacheKey = `${classified.type}:${classified.memberName}`;
  if (context.metadataCache.has(cacheKey)) {
    return context.metadataCache.get(cacheKey);
  }

  const namespace = await detectVlocityNamespace(orgAlias, context);
  const orgMetadata = namespace !== null ? await queryVlocityOrgMetadata(orgAlias, classified, namespace) : null;
  const metadata = orgMetadata ?? readVlocityMetadata(filePath);
  context.metadataCache.set(cacheKey, metadata);
  return metadata;
}

async function detectVlocityNamespace(orgAlias, context) {
  if (context.namespace !== undefined) {
    return context.namespace;
  }
  for (const namespace of ['omnistudio', 'vlocity_cmt', 'vlocity_ins', 'vlocity_ps', 'vlocity']) {
    try {
      await runProcess('sf', [
        'data',
        'query',
        '--query',
        `SELECT Id FROM ${namespace}__DRBundle__c LIMIT 1`,
        '--target-org',
        orgAlias,
        '--json',
      ]);
      context.namespace = namespace;
      return namespace;
    } catch {
      // Try the next known OmniStudio/Vlocity namespace.
    }
  }
  for (const objectName of ['OmniUiCard', 'OmniProcess']) {
    try {
      await runProcess('sf', [
        'data',
        'query',
        '--query',
        `SELECT Id FROM ${objectName} LIMIT 1`,
        '--target-org',
        orgAlias,
        '--json',
      ]);
      context.namespace = '';
      return '';
    } catch {
      // No legacy namespace or modern OmniStudio objects were queryable.
    }
  }
  context.namespace = null;
  return null;
}

async function queryVlocityOrgMetadata(orgAlias, classified, namespace) {
  const queries = buildVlocityQueries(classified, namespace);
  for (const query of queries) {
    try {
      const {stdout} = await runProcess('sf', ['data', 'query', '--query', query, '--target-org', orgAlias, '--json']);
      const parsed = JSON.parse(stdout);
      const record = parsed.result?.records?.[0];
      if (!record) {
        continue;
      }
      return {
        user: record.LastModifiedBy?.Name ?? record.LastModifiedByName ?? 'Audit unavailable',
        lastModifiedDate: record.LastModifiedDate ?? null,
        query: `metadelta find base query:\n${query}`,
      };
    } catch {
      // Some orgs use modern OmniStudio objects, others use namespaced legacy objects.
    }
  }
  return null;
}

function buildVlocityQueries(classified, namespace) {
  const name = soql(classified.memberName);
  const ns = namespace ? `${namespace}__` : '';
  const omniNameParts = classified.memberName.split('_').map(soql);
  const typeValue = omniNameParts[0] ?? name;
  const subTypeValue = omniNameParts.slice(1, -1).join('_') || omniNameParts[1] || '';
  const languageValue = omniNameParts.at(-1) || '';
  const queries = [];
  const findQuery = buildFindVlocityQuery(classified, namespace);

  if (findQuery) {
    queries.push(findQuery);
  }

  if (classified.type === 'DRBundle') {
    if (ns) {
      // Same base query used by metadelta find for DataRaptor.
      queries.push(`SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM ${ns}DRBundle__c WHERE ${ns}Type__c != 'Migration' AND Name = '${name}' LIMIT 1`);
    }
  }
  if (classified.type === 'FlexCard') {
    queries.push(
      ...(ns
        ? [
            // Same base query used by metadelta find for VlocityCard/FlexCard.
            `SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM ${ns}VlocityCard__c WHERE ${ns}Active__c = true AND Name = '${name}' LIMIT 1`,
          ]
        : []),
      `SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM OmniUiCard WHERE Name = '${name}' LIMIT 1`,
    );
  }
  if (classified.type === 'IntegrationProcedure') {
    queries.push(
      ...(ns
        ? [
            // Same base query used by metadelta find for IntegrationProcedure.
            `SELECT Id, ${ns}Type__c, ${ns}SubType__c, LastModifiedDate, LastModifiedBy.Name FROM ${ns}OmniScript__c WHERE ${ns}IsActive__c = true AND ${ns}IsProcedure__c = true AND ${ns}Type__c = '${typeValue}' AND ${ns}SubType__c = '${subTypeValue}' LIMIT 1`,
          ]
        : []),
      `SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM OmniProcess WHERE Type = '${typeValue}' AND SubType = '${subTypeValue}' AND IsActive = true LIMIT 1`,
      `SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM OmniProcess WHERE Name = '${name}' LIMIT 1`,
    );
  }
  if (classified.type === 'OmniProcess') {
    queries.push(
      ...(ns
        ? [
            // Same base query used by metadelta find for OmniScript.
            `SELECT Id, ${ns}Type__c, ${ns}SubType__c, ${ns}Language__c, LastModifiedDate, LastModifiedBy.Name FROM ${ns}OmniScript__c WHERE ${ns}IsActive__c = true AND ${ns}IsProcedure__c = false AND ${ns}Type__c = '${typeValue}' AND ${ns}SubType__c = '${subTypeValue}' AND ${ns}Language__c = '${languageValue}' LIMIT 1`,
          ]
        : []),
      `SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM OmniProcess WHERE Type = '${typeValue}' AND SubType = '${subTypeValue}' AND Language = '${languageValue}' AND IsActive = true LIMIT 1`,
      `SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM OmniProcess WHERE Name = '${name}' LIMIT 1`,
    );
  }

  return Array.from(new Set(queries));
}

function buildFindVlocityQuery(classified, namespace) {
  const template = vlocityDatapackQueries[classified.type];
  if (!template) {
    return null;
  }
  if (!namespace && template.includes('%vlocity_namespace%')) {
    return null;
  }

  const query = template.replace(/%vlocity_namespace%/g, namespace);
  const filters = buildFindVlocityFilters(classified, namespace);
  if (filters.length === 0) {
    return `${query} LIMIT 1`;
  }
  const operator = /\bwhere\b/i.test(query) ? 'AND' : 'WHERE';
  return `${query} ${operator} (${filters.join(' OR ')}) LIMIT 1`;
}

function buildFindVlocityFilters(classified, namespace) {
  const name = soql(classified.memberName);
  const ns = namespace ? `${namespace}__` : '';
  const filters = classified.type === 'QueryBuilder'
    ? [`Id = '${name}'`]
    : [`Name = '${name}'`, `Id = '${name}'`];

  if (globalKeyTypes.has(classified.type) && ns) {
    filters.push(`${ns}GlobalKey__c = '${name}'`);
  }
  if (codeTypes.has(classified.type) && ns) {
    filters.push(`${ns}Code__c = '${name}'`);
  }
  if (classified.type === 'Pricebook2' || classified.type === 'PricingPlan') {
    filters.push(`Name = '${soql(classified.memberName.replace(/-/g, ' '))}'`);
  }

  return Array.from(new Set(filters));
}

function soql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
          user: record.LastModifiedBy?.Name ?? record.LastModifiedByName ?? 'Unknown',
          lastModifiedDate: record.LastModifiedDate ?? null,
          query,
        };
      }
    } catch {
      // Keep the monitor alive when a metadata type is not queryable.
    }
  }

  const listMetadata = await queryListMetadata(orgAlias, classified);
  return listMetadata ?? {user: 'Unknown', lastModifiedDate: null, query};
}

async function queryListMetadata(orgAlias, classified) {
  const args = ['org', 'list', 'metadata', '--metadata-type', classified.type, '--target-org', orgAlias, '--json'];
  try {
    const {stdout} = await runProcess('sf', args);
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
  } catch {
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
  } catch {
    return [];
  }
}

function readJsonMetadata(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const lastModifiedDate =
      findValue(parsed, ['LastModifiedDate', 'LastModifiedDate__c', 'lastModifiedDate']) ?? null;
    const user =
      findValue(parsed, [
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
  } catch {
    return {user: 'N/A', lastModifiedDate: null, query: `Could not parse ${path.basename(filePath)}`};
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
