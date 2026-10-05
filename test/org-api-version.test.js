import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOrgIsSandboxResponse} from '../src/commands/metadelta/orgApiVersion.js';

test('parseOrgIsSandboxResponse identifies production organizations', () => {
  assert.deepEqual(
    parseOrgIsSandboxResponse(JSON.stringify({result: {records: [{IsSandbox: false}]}})),
    {isSandbox: false, error: null}
  );
});

test('parseOrgIsSandboxResponse identifies sandbox organizations', () => {
  assert.deepEqual(
    parseOrgIsSandboxResponse(JSON.stringify({result: {records: [{IsSandbox: true}]}})),
    {isSandbox: true, error: null}
  );
});

test('parseOrgIsSandboxResponse fails closed when IsSandbox is unavailable', () => {
  const result = parseOrgIsSandboxResponse(JSON.stringify({result: {records: [{}]}}));
  assert.equal(result.isSandbox, null);
  assert.match(result.error, /IsSandbox/);
});
