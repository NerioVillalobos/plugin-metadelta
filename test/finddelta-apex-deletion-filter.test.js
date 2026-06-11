import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCompleteApexClassDeletions,
  filterCompleteVlocityDatapackDeletions,
} from '../src/commands/metadelta/finddelta.js';

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
