import test from 'node:test';
import assert from 'node:assert/strict';
import TaskPlay from '../src/commands/metadelta/task/play.js';

function createTaskPlay() {
  const taskPlay = Object.create(TaskPlay.prototype);
  taskPlay.shouldNormalizeVisualforceFrames = () => false;
  taskPlay.shouldNormalizeGenericButtonSelectors = () => false;
  return taskPlay;
}

test('hasInjectedHelperBlock detects full helper block', () => {
  const taskPlay = createTaskPlay();
  const helperBlock = taskPlay.getPatchedTestHelpersBlock();
  const contents = `${helperBlock}\nconst x = 1;`;

  assert.equal(taskPlay.hasInjectedHelperBlock(contents), true);
});

test('injectHelperBlockIfNeeded injects when helper block is absent', () => {
  const taskPlay = createTaskPlay();
  const source = "import {test} from '@playwright/test';\ntest('x', async ({page}) => {});";

  const injected = taskPlay.injectHelperBlockIfNeeded(source);

  assert.equal(taskPlay.hasInjectedHelperBlock(injected), true);
  assert.ok(injected.endsWith(source));
});

test('injectHelperBlockIfNeeded does not reinject when helper block already exists', () => {
  const taskPlay = createTaskPlay();
  const once = taskPlay.injectHelperBlockIfNeeded("import {test} from '@playwright/test';");
  const twice = taskPlay.injectHelperBlockIfNeeded(once);

  const beginCount = (twice.match(/METADELTA_HELPERS_BEGIN/g) ?? []).length;
  const endCount = (twice.match(/METADELTA_HELPERS_END/g) ?? []).length;

  assert.equal(beginCount, 1);
  assert.equal(endCount, 1);
  assert.equal(twice, once);
});

test('validatePatchedTestStructure fails on evident duplicates', () => {
  const taskPlay = createTaskPlay();
  const invalid = `
import {test, expect} from '@playwright/test';
import {runTaskOrchestrator} from './metadelta-task-orchestrator-routes.js';
const baseUrl = process.env.METADELTA_BASE_URL;
${taskPlay.getPatchedTestHelpersBlock()}
test('one', async ({page}) => {});
test('two', async ({page}) => {});
`;

  assert.throws(
    () => taskPlay.validatePatchedTestStructure(invalid, '/tmp/.metadelta.invalid.ts'),
    /no pasó validación estructural/
  );
});

test('detectLegacyOrPartialHelperIssue flags partial marker contamination', () => {
  const taskPlay = createTaskPlay();
  const partial = `
import {test, expect} from '@playwright/test';
// METADELTA_HELPERS_BEGIN
async function gotoWithRetry() {}
test('x', async ({page}) => {});
`;

  const issue = taskPlay.detectLegacyOrPartialHelperIssue(partial);

  assert.ok(issue);
  assert.match(issue, /desbalanceados|parciales/i);
});

test('applyPatchedTestNormalizations applies key orchestration transformations', () => {
  const taskPlay = createTaskPlay();
  const source = `
import {test, expect} from '@playwright/test';

test('patch me', async ({page}) => {
  await page.goto('https://example.my.salesforce.com/lightning/page/home');
});
`;

  const normalized = taskPlay.applyPatchedTestNormalizations(source, 180);

  assert.match(normalized, /import \{runTaskOrchestrator\} from '\.\/metadelta-task-orchestrator-routes\.js';/);
  assert.match(normalized, /const baseUrl = process\.env\.METADELTA_BASE_URL;/);
  assert.match(normalized, /await gotoWithRetry\(page, baseUrl \+ '\/lightning\/page\/home'\);/);
  assert.match(normalized, /await runTaskOrchestrator\(page\);/);
});
