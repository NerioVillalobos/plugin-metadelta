import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBundledMetadataDeltaComponents,
  expandCoreCandidateFiles,
  filterDiffEntriesByProject,
  filterCompleteApexClassDeletions,
  filterCompleteVlocityDatapackDeletions,
  groupFilesByComponent,
  isPathInPackageDirectory,
  matchesForceIgnorePattern,
  normalizePackageDirectories,
} from '../src/commands/metadelta/finddelta.js';

const customLabels = (labels) => `<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
${labels.map(({name, value}) => `    <labels>
        <fullName>${name}</fullName>
        <language>es_MX</language>
        <protected>false</protected>
        <shortDescription>${name}</shortDescription>
        <value>${value}</value>
    </labels>`).join('\n')}
</CustomLabels>`;

test('filterCompleteApexClassDeletions keeps ApexClass only when cls and cls-meta.xml are deleted', () => {
  const files = [
    'force-app/main/default/classes/Complete.cls',
    'force-app/main/default/classes/Complete.cls-meta.xml',
    'force-app/main/default/classes/OnlyClass.cls',
    'force-app/main/default/classes/OnlyMeta.cls-meta.xml',
    'force-app/main/default/triggers/AccountTrigger.trigger',
  ];

  assert.deepEqual(filterCompleteApexClassDeletions(files), [
    'force-app/main/default/classes/Complete.cls',
    'force-app/main/default/classes/Complete.cls-meta.xml',
    'force-app/main/default/triggers/AccountTrigger.trigger',
  ]);
});

test('filterCompleteApexClassDeletions matches ApexClass pairs case-insensitively', () => {
  const files = [
    'force-app/main/default/classes/MyClass.CLS',
    'force-app/main/default/classes/MyClass.cls-META.XML',
  ];

  assert.deepEqual(filterCompleteApexClassDeletions(files), [
    'force-app/main/default/classes/MyClass.CLS',
    'force-app/main/default/classes/MyClass.cls-META.XML',
  ]);
});

test('filterCompleteVlocityDatapackDeletions keeps only datapacks without remaining files in the source branch', () => {
  const files = [
    'Vlocity/OmniScript/DeletedPack/DeletedPack_DataPack.json',
    'Vlocity/OmniScript/DeletedPack/Child/step.json',
    'Vlocity/OmniScript/PartialPack/removed-step.json',
    'force-app/Vlocity/DataRaptor/DeletedWithPrefix/DeletedWithPrefix_DataPack.json',
  ];
  const remainingByRoot = new Map([
    ['feature::Vlocity/OmniScript/DeletedPack', false],
    ['feature::Vlocity/OmniScript/PartialPack', true],
    ['feature::force-app/Vlocity/DataRaptor/DeletedWithPrefix', false],
  ]);
  const hasFilesInBranch = (branch, datapackRoot) => remainingByRoot.get(`${branch}::${datapackRoot}`);

  assert.deepEqual(filterCompleteVlocityDatapackDeletions(files, 'feature', hasFilesInBranch), [
    'Vlocity/OmniScript/DeletedPack/DeletedPack_DataPack.json',
    'Vlocity/OmniScript/DeletedPack/Child/step.json',
    'force-app/Vlocity/DataRaptor/DeletedWithPrefix/DeletedWithPrefix_DataPack.json',
  ]);
});

test('buildCustomLabelDeltaComponents returns only added or modified labels', () => {
  const files = ['force-app/main/default/labels/CustomLabels.labels-meta.xml'];
  const source = customLabels([
    {name: 'ExistingLabel', value: 'same'},
    {name: 'ChangedLabel', value: 'new'},
    {name: 'AddedLabel', value: 'added'},
  ]);
  const target = customLabels([
    {name: 'ExistingLabel', value: 'same'},
    {name: 'ChangedLabel', value: 'old'},
    {name: 'RemovedLabel', value: 'removed'},
  ]);

  const delta = buildBundledMetadataDeltaComponents('source', 'target', files, (branch) => (
    branch === 'source' ? source : target
  ));

  assert.deepEqual(delta.active, [
    {type: 'CustomLabel', fullName: 'ChangedLabel'},
    {type: 'CustomLabel', fullName: 'AddedLabel'},
  ]);
  assert.deepEqual(delta.destructive, [
    {type: 'CustomLabel', fullName: 'RemovedLabel'},
  ]);
});

test('expandCoreCandidateFiles includes generic metadata siblings and bundle metadata', () => {
  const expanded = expandCoreCandidateFiles([
    'force-app/main/default/email/Folder/Notice.email',
    'force-app/main/default/documents/Folder/Logo.png',
    'force-app/main/default/staticresources/site/app.js'
  ]);

  assert.ok(expanded.includes('force-app/main/default/email/Folder/Notice.email-meta.xml'));
  assert.ok(expanded.includes('force-app/main/default/documents/Folder/Logo.document-meta.xml'));
  assert.ok(expanded.includes('force-app/main/default/staticresources/site.resource-meta.xml'));
});

test('expandCoreCandidateFiles includes the parent of decomposed object translations', () => {
  const expanded = expandCoreCandidateFiles([
    'force-app/main/default/objectTranslations/Quote-es_MX/quote_currency.fieldTranslation-meta.xml'
  ]);

  assert.ok(expanded.includes(
    'force-app/main/default/objectTranslations/Quote-es_MX/Quote-es_MX.objectTranslation-meta.xml'
  ));
});

test('groupFilesByComponent keeps decomposed children and their parent together', () => {
  const groups = groupFilesByComponent([
    'force-app/main/default/objectTranslations/Quote-es_MX/Quote-es_MX.objectTranslation-meta.xml',
    'force-app/main/default/objectTranslations/Quote-es_MX/quote_currency.fieldTranslation-meta.xml',
    'force-app/main/default/classes/Unrelated.cls-meta.xml'
  ]);

  assert.ok(groups.some((group) => (
    group.includes('force-app/main/default/objectTranslations/Quote-es_MX/Quote-es_MX.objectTranslation-meta.xml')
      && group.includes('force-app/main/default/objectTranslations/Quote-es_MX/quote_currency.fieldTranslation-meta.xml')
  )));
  assert.ok(groups.some((group) => group.includes('force-app/main/default/classes/Unrelated.cls-meta.xml')));
});

test('normalizePackageDirectories removes nested paths and normalizes prefixes', () => {
  assert.deepEqual(
    normalizePackageDirectories([
      {path: 'force-app/'},
      {path: './extra-app/'},
      {path: 'force-app/main/default'}
    ]),
    ['force-app', 'extra-app']
  );
});

test('package directory matching keeps Vlocity outside package directories separate', () => {
  assert.equal(isPathInPackageDirectory('force-app/main/default/classes/A.cls', ['force-app']), true);
  assert.equal(isPathInPackageDirectory('data/backup/force-app/main/default/classes/A.cls', ['force-app']), false);
  assert.equal(isPathInPackageDirectory('Vlocity/OmniScript/Order/Order_DataPack.json', ['force-app']), false);
});

test('forceignore patterns support recursive and negated entries', () => {
  assert.equal(matchesForceIgnorePattern('force-app/main/default/flows/debug.flow-meta.xml', '**/debug.flow-meta.xml'), true);
  assert.equal(matchesForceIgnorePattern('force-app/main/default/classes/Keep.cls', 'classes/Keep.cls'), false);
  assert.equal(matchesForceIgnorePattern('data/backup/file.xml', 'data/'), true);
});

test('filterDiffEntriesByProject drops out-of-project Core files but keeps Vlocity', () => {
  const logs = [];
  const entries = filterDiffEntriesByProject([
    {status: 'A', path: 'force-app/main/default/classes/Real.cls'},
    {status: 'A', path: 'data/history/force-app/main/default/classes/Backup.cls'},
    {status: 'A', path: 'Vlocity/OmniScript/Order/Order_DataPack.json'},
    {status: 'R100', oldPath: 'data/old/Backup.cls', newPath: 'force-app/main/default/classes/Real.cls'}
  ], {
    packageDirectories: ['force-app'],
    forceIgnore: () => false
  }, {log: (message) => logs.push(message)});

  assert.deepEqual(entries, [
    {status: 'A', path: 'force-app/main/default/classes/Real.cls'},
    {status: 'A', path: 'Vlocity/OmniScript/Order/Order_DataPack.json'},
    {status: 'A', path: 'force-app/main/default/classes/Real.cls'}
  ]);
  assert.match(logs[0], /Ignorados 2 archivo/);
  assert.match(logs[1], /data\/history/);
  assert.match(logs[2], /data\/old/);
});

test('filterDiffEntriesByProject excludes forceignored Core files', () => {
  const logs = [];
  const entries = filterDiffEntriesByProject([
    {status: 'A', path: 'force-app/main/default/flows/debug.flow-meta.xml'},
    {status: 'A', path: 'force-app/main/default/flows/Real.flow-meta.xml'}
  ], {
    packageDirectories: ['force-app'],
    forceIgnore: (filePath) => filePath.endsWith('/debug.flow-meta.xml')
  }, {log: (message) => logs.push(message)});

  assert.deepEqual(entries, [{status: 'A', path: 'force-app/main/default/flows/Real.flow-meta.xml'}]);
  assert.match(logs[1], /\.forceignore/);
});
