import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBundledMetadataDeltaComponents,
  filterCompleteApexClassDeletions,
  filterCompleteVlocityDatapackDeletions,
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
