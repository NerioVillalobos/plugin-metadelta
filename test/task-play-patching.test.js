import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

test('TaskPlay exposes optional AI flags', () => {
  assert.ok(TaskPlay.flags.ai);
  assert.ok(TaskPlay.flags['ai-provider']);
  assert.ok(TaskPlay.flags['ai-key']);
  assert.ok(TaskPlay.flags['ai-model']);
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

test('applyPatchedTestNormalizations adds post-save stabilization for save input clicks', () => {
  const taskPlay = createTaskPlay();
  const source = `
import {test, expect} from '@playwright/test';

test('save action', async ({page}) => {
  await page.locator('iframe[name^="vfFrameId_"]').contentFrame().getByRole('row', { name: 'Save Save & New Cancel', exact: true }).locator('input[name="save"]').click();
});
`;
  const normalized = taskPlay.applyPatchedTestNormalizations(source, 180);
  assert.match(normalized, /waitForLoadState\('networkidle'\)/);
  assert.match(normalized, /waitForTimeout\(1200\)/);
});

test('createAiEnhancedTestFilePath appends .ai before extension', () => {
  const taskPlay = createTaskPlay();
  const aiPath = taskPlay.createAiEnhancedTestFilePath('/tmp/tests/.metadelta.sample.ts');
  assert.equal(aiPath, '/tmp/tests/.metadelta.sample.ai.ts');
});

test('buildPlaywrightArgs includes --headed when header is true', () => {
  const taskPlay = createTaskPlay();
  const withHeader = taskPlay.buildPlaywrightArgs({cliPath: '/tmp/cli.js', configPath: '/tmp/pw.cjs', header: true});
  const withoutHeader = taskPlay.buildPlaywrightArgs({cliPath: '/tmp/cli.js', configPath: '/tmp/pw.cjs', header: false});
  assert.equal(withHeader.includes('--headed'), true);
  assert.equal(withoutHeader.includes('--headed'), false);
});

test('normalizeGeminiModelName accepts short and full formats', () => {
  const taskPlay = createTaskPlay();
  assert.equal(taskPlay.normalizeGeminiModelName('gemini-2.0-flash'), 'models/gemini-2.0-flash');
  assert.equal(taskPlay.normalizeGeminiModelName('models/gemini-2.0-flash'), 'models/gemini-2.0-flash');
});

test('parseAiHardeningPlan accepts valid JSON and rejects fenced responses', () => {
  const taskPlay = createTaskPlay();
  const ok = taskPlay.parseAiHardeningPlan('{"changes":[{"type":"setup_button_disambiguation"}]}');
  const fenced = taskPlay.parseAiHardeningPlan('```json\\n{"changes":[{"type":"setup_button_disambiguation"}]}\\n```');

  assert.equal(ok.valid, true);
  assert.equal(ok.changes.length, 1);
  assert.equal(fenced.valid, false);
});

test('isValidAiPatchedTestContent validates expected Playwright/metadelta signatures', () => {
  const taskPlay = createTaskPlay();
  const valid = `
import {test} from '@playwright/test';
// METADELTA_HELPERS_BEGIN
async function gotoWithRetry() {}
// METADELTA_HELPERS_END
async function runTaskOrchestrator() {}
test('x', async ({page}) => {
  await gotoWithRetry(page, 'https://example.com');
  await runTaskOrchestrator(page);
});
`;
  const invalid = "import {test} from '@playwright/test'; test('x', async () => {});";

  assert.equal(taskPlay.isValidAiPatchedTestContent(valid), true);
  assert.equal(taskPlay.isValidAiPatchedTestContent(invalid), false);
});

test('validateAiTypescriptSyntax rejects markdown fences and parsing errors', () => {
  const taskPlay = createTaskPlay();
  const fenced = "```ts\nimport {test} from '@playwright/test';\n```";
  const brokenTs = "import {test} from '@playwright/test';\nconst a = `unterminated;\ntest('x', async () => {});";

  const fencedResult = taskPlay.validateAiTypescriptSyntax(fenced, '/tmp/.metadelta.sample.ts');
  const brokenResult = taskPlay.validateAiTypescriptSyntax(brokenTs, '/tmp/.metadelta.sample.ts');

  assert.equal(fencedResult.valid, false);
  assert.match(fencedResult.reason, /markdown fences/i);
  assert.equal(brokenResult.valid, false);
});

test('applyAiHardeningPlan hardens ambiguous Setup selector and Quick Find timing', () => {
  const taskPlay = createTaskPlay();
  const source = `
import {test} from '@playwright/test';
test('x', async ({page}) => {
  await page.getByRole('button', { name: 'Setup' }).click();
  await page.getByRole('searchbox', { name: 'Quick Find' }).click();
});
`;
  const hardened = taskPlay.applyAiHardeningPlan(source, [
    {type: 'setup_button_disambiguation'},
    {type: 'quick_find_ready_guard'},
  ]);

  assert.match(hardened, /slds-global-actions__setup/);
  assert.match(hardened, /exact: true/);
  assert.match(hardened, /waitFor\(\{state: 'visible', timeout: 15000\}\)/);
});

test('ensureMandatoryFragilityChanges enforces setup hardening for known ambiguous selector', () => {
  const taskPlay = createTaskPlay();
  const source = "await page.getByRole('button', { name: 'Setup' }).click();";
  const changes = taskPlay.ensureMandatoryFragilityChanges(source, []);
  assert.equal(changes.some((entry) => entry.type === 'setup_button_disambiguation'), true);
});

test('maybeCreateAiEnhancedTestFile falls back when AI credentials are missing', async () => {
  const taskPlay = createTaskPlay();
  const warnings = [];
  taskPlay.warn = (message) => warnings.push(message);

  const outcome = await taskPlay.maybeCreateAiEnhancedTestFile({
    aiEnabled: true,
    aiProvider: 'gemini',
    aiKey: '',
    originalTestFile: '/tmp/original.ts',
    patchedTestFile: '/tmp/patched.ts',
  });

  assert.equal(outcome.result, 'fallback-missing-config');
  assert.equal(outcome.executionFile, '/tmp/patched.ts');
  assert.equal(warnings.length > 0, true);
  assert.equal(warnings.join('\n').includes('ai-key'), true);
});

test('maybeCreateAiEnhancedTestFile writes AI file when provider returns valid content', async () => {
  const taskPlay = createTaskPlay();
  taskPlay.warn = () => {};
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-ai-'));
  const originalPath = path.join(tmp, 'original.ts');
  const patchedPath = path.join(tmp, '.metadelta.sample.ts');
  const patched = `
import {test} from '@playwright/test';
// METADELTA_HELPERS_BEGIN
async function gotoWithRetry() {}
// METADELTA_HELPERS_END
async function runTaskOrchestrator() {}
test('x', async ({page}) => {
  await page.getByRole('button', { name: 'Setup' }).click();
  await gotoWithRetry(page, 'x');
  await runTaskOrchestrator(page);
});
`;
  fs.writeFileSync(originalPath, patched, 'utf8');
  fs.writeFileSync(patchedPath, patched, 'utf8');
  taskPlay.requestGeminiStabilization = async () =>
    JSON.stringify({
      changes: [],
    });
  taskPlay.resolveGeminiModel = async () => 'models/gemini-2.0-flash';

  const outcome = await taskPlay.maybeCreateAiEnhancedTestFile({
    aiEnabled: true,
    aiProvider: 'gemini',
    aiKey: 'fake-key',
    originalTestFile: originalPath,
    patchedTestFile: patchedPath,
  });

  assert.equal(outcome.result, 'ai-safe-hardening-applied');
  assert.ok(outcome.generatedAiFile?.endsWith('.ai.ts'));
  assert.equal(fs.existsSync(outcome.generatedAiFile), true);
  const hardened = fs.readFileSync(outcome.generatedAiFile, 'utf8');
  assert.match(hardened, /slds-global-actions__setup/);
});

test('maybeCreateAiEnhancedTestFile falls back on invalid AI output and provider failures', async () => {
  const taskPlay = createTaskPlay();
  const warnings = [];
  taskPlay.warn = (message) => warnings.push(message);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-ai-'));
  const originalPath = path.join(tmp, 'original.ts');
  const patchedPath = path.join(tmp, '.metadelta.sample.ts');
  const patched = `
import {test} from '@playwright/test';
// METADELTA_HELPERS_BEGIN
async function gotoWithRetry() {}
// METADELTA_HELPERS_END
async function runTaskOrchestrator() {}
test('x', async ({page}) => {
  await gotoWithRetry(page, 'x');
  await runTaskOrchestrator(page);
});
`;
  fs.writeFileSync(originalPath, patched, 'utf8');
  fs.writeFileSync(patchedPath, patched, 'utf8');
  taskPlay.resolveGeminiModel = async () => 'models/gemini-2.0-flash';

  taskPlay.requestGeminiStabilization = async () => '';
  const invalidOutcome = await taskPlay.maybeCreateAiEnhancedTestFile({
    aiEnabled: true,
    aiProvider: 'gemini',
    aiKey: 'fake-key',
    originalTestFile: originalPath,
    patchedTestFile: patchedPath,
  });
  assert.equal(invalidOutcome.result, 'fallback-invalid-ai-output');

  taskPlay.requestGeminiStabilization = async () => '```json\n{"changes":[{"type":"setup_button_disambiguation"}]}\n```';
  const invalidTsOutcome = await taskPlay.maybeCreateAiEnhancedTestFile({
    aiEnabled: true,
    aiProvider: 'gemini',
    aiKey: 'fake-key',
    originalTestFile: originalPath,
    patchedTestFile: patchedPath,
  });
  assert.equal(invalidTsOutcome.result, 'fallback-invalid-ai-output');
  assert.equal(invalidTsOutcome.generatedAiFile, null);
  assert.equal(warnings.some((message) => /hardening dirigido/i.test(message)), true);

  taskPlay.requestGeminiStabilization = async () => {
    throw new Error('provider down');
  };
  const providerOutcome = await taskPlay.maybeCreateAiEnhancedTestFile({
    aiEnabled: true,
    aiProvider: 'gemini',
    aiKey: 'fake-key',
    originalTestFile: originalPath,
    patchedTestFile: patchedPath,
  });
  assert.equal(providerOutcome.result, 'fallback-provider-error');
  assert.equal(warnings.some((message) => message.includes('fake-key')), false);
});

test('resolveGeminiModel uses preferred model and list-models fallback', async () => {
  const taskPlay = createTaskPlay();
  const originalFetch = global.fetch;
  try {
    const preferred = await taskPlay.resolveGeminiModel({apiKey: 'x', preferredModel: 'gemini-2.5-flash'});
    assert.equal(preferred, 'models/gemini-2.5-flash');

    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          models: [
            {name: 'models/embedding-001', supportedGenerationMethods: ['embedContent']},
            {name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent']},
          ],
        };
      },
    });

    const discovered = await taskPlay.resolveGeminiModel({apiKey: 'x', preferredModel: ''});
    assert.equal(discovered, 'models/gemini-2.0-flash');
  } finally {
    global.fetch = originalFetch;
  }
});
