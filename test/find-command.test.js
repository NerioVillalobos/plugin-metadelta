import test from 'node:test';
import assert from 'node:assert/strict';
import {filterListMetadataTypes} from '../src/commands/metadelta/find.js';

test('find skips ContentWorkspace when preparing list metadata queries', () => {
  assert.deepEqual(
    filterListMetadataTypes(['ApexClass', 'ContentWorkspace', 'CustomObject']),
    ['ApexClass', 'CustomObject']
  );
});

test('find keeps supported metadata types in their original order', () => {
  assert.deepEqual(
    filterListMetadataTypes(['Flow', 'Layout', 'ApexClass']),
    ['Flow', 'Layout', 'ApexClass']
  );
});
