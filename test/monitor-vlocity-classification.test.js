import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyChange} from '../src/utils/monitor/metadata.js';

test('classifyChange keeps generic Vlocity datapack folder type and member name', () => {
  const classified = classifyChange(
    'DEV/current/vlocity/CustomFieldMap/CustomerFieldMap/CustomerFieldMap_DataPack.json'
  );

  assert.equal(classified.source, 'vlocity');
  assert.equal(classified.type, 'CustomFieldMap');
  assert.equal(classified.memberName, 'CustomerFieldMap');
});
