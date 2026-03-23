import { Command, Flags } from '@oclif/core';
import fs from 'node:fs';
import path from 'node:path';
import { TaskOrchestrator, ensureTestsDirectory, ensurePlaywrightReady, buildFrontdoorUrlFromOrgDisplay, ensurePlaywrightTestDependency, executeCommandLive, extractPlaywrightFailureDetails, resolveTestFilePath, } from '../../../utils/task/orchestrator.js';
class TaskPlay extends Command {
    static summary = 'Reproduce una grabación de Playwright en una org de Salesforce.';
    static flags = {
        org: Flags.string({
            char: 'o',
            summary: 'Alias de sf-cli para la org en la que se ejecutará la tarea.',
            required: false,
        }),
        'target-org': Flags.string({
            summary: 'Alias alternativo compatible con la convención de Salesforce CLI.',
            required: false,
        }),
        tstname: Flags.string({
            summary: 'Nombre del archivo .ts generado por el comando record.',
            required: true,
        }),
        header: Flags.boolean({
            summary: 'Muestra el navegador durante la ejecución.',
            default: false,
        }),
        'vlocity-job-time': Flags.integer({
            summary: 'Tiempo de espera (en segundos) después de confirmar Maintenance Jobs.',
            default: 180,
        }),
    };
    async run() {
        const { flags } = await this.parse(TaskPlay);
        const orchestrator = new TaskOrchestrator({ commandName: 'metadelta task play' });
        if (flags['target-org'] && flags.org && flags['target-org'] !== flags.org) {
            this.error('Los valores de --org y --target-org no pueden diferir.');
        }
        const targetOrg = flags.org || flags['target-org'];
        if (!targetOrg) {
            this.error('Debes indicar la org con --org o --target-org.');
        }
        const testFile = resolveTestFilePath({ name: flags.tstname });
        try {
            ensureTestsDirectory();
            if (!testFile || !fs.existsSync(testFile)) {
                this.error(`No se encontró el archivo de prueba: ${flags.tstname}`);
            }
            const { cacheDir, cliPath } = ensurePlaywrightTestDependency(process.cwd());
            ensurePlaywrightReady({ baseDir: process.cwd(), playwrightCliPath: cliPath });
            const url = buildFrontdoorUrlFromOrgDisplay(targetOrg);
            const baseOrigin = this.extractBaseOrigin(url);
            const patchedTestFile = this.createPatchedTestFile(testFile, flags['vlocity-job-time']);
            const configPath = this.createPlaywrightConfig(patchedTestFile);
            const args = [cliPath, 'test', '--config', configPath, '--reporter', 'line'];
            if (flags.header) {
                args.push('--headed');
            }
            this.log(`Ejecutando prueba en ${targetOrg} con archivo ${testFile}`);
            const result = await executeCommandLive(process.execPath, args, {
                env: {
                    ...process.env,
                    METADELTA_BASE_URL: baseOrigin,
                    METADELTA_FRONTDOOR_URL: url,
                    METADELTA_VLOCITY_JOB_WAIT_MS: String((flags['vlocity-job-time'] ?? 180) * 1000),
                    NODE_PATH: cacheDir ? path.join(cacheDir, 'node_modules') : process.env.NODE_PATH,
                },
            });
            if (result.status !== 0) {
                const genericMessage = [
                    'La ejecución de Playwright finalizó con errores.',
                    result.error?.message ? `Detalle: ${result.error.message}` : null,
                    typeof result.status === 'number' ? `Código de salida: ${result.status}` : null,
                    result.signal ? `Señal: ${result.signal}` : null,
                ]
                    .filter(Boolean)
                    .join(' ');
                const failure = extractPlaywrightFailureDetails([result.stdout, result.stderr].filter(Boolean).join('\n'), genericMessage);
                const detailedError = new Error(failure.summary || genericMessage);
                detailedError.stack = failure.outputExcerpt || detailedError.stack;
                detailedError.playwrightMatcherText = failure.matcherText;
                detailedError.playwrightSummary = failure.summary;
                detailedError.playwrightExitCode = result.status;
                detailedError.playwrightSignal = result.signal;
                throw detailedError;
            }
            fs.rmSync(configPath, { force: true });
            fs.rmSync(patchedTestFile, { force: true });
        }
        catch (error) {
            const diagnosticMessage = error.playwrightMatcherText || error.message;
            orchestrator.recordError({
                message: diagnosticMessage,
                stack: error.stack,
                context: {
                    org: targetOrg,
                    testFile: flags.tstname,
                    playwrightSummary: error.playwrightSummary || error.message,
                    playwrightExitCode: error.playwrightExitCode ?? null,
                    playwrightSignal: error.playwrightSignal ?? null,
                },
            });
            const solution = orchestrator.findSolution(diagnosticMessage);
            if (solution) {
                this.error(`${error.playwrightSummary || error.message}\nSugerencia: ${solution.solution}`);
            }
            this.error(error.playwrightSummary || error.message);
        }
    }
    extractBaseOrigin(frontdoorUrl) {
        try {
            return new URL(frontdoorUrl).origin;
        }
        catch (error) {
            return frontdoorUrl;
        }
    }
    createPlaywrightConfig(testFile) {
        const configPath = path.resolve(process.cwd(), 'tests', '.metadelta.playwright.config.cjs');
        const testDir = path.dirname(testFile);
        const testBase = path.basename(testFile);
        const contents = `module.exports = {
  testDir: ${JSON.stringify(testDir)},
  testMatch: [${JSON.stringify(testBase)}],
};\n`;
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, contents, 'utf8');
        return configPath;
    }
    applyStructuralStabilizers(source) {
        let stabilized = source;
        stabilized = this.fixSelfReferencingBaseUrl(stabilized);
        stabilized = this.normalizeSetupPopupSequence(stabilized);
        stabilized = this.fixDuplicatePopupPromises(stabilized);
        stabilized = this.rebindClosedPopupPageHandles(stabilized);
        stabilized = this.removeOrphanPopupPromises(stabilized);
        return stabilized;
    }
    fixSelfReferencingBaseUrl(source) {
        return source.replace(/const\s+baseUrl\s*=\s*process\.env\.METADELTA_BASE_URL\s*\?\?\s*baseUrl\s*;/g, "const baseUrl = process.env.METADELTA_BASE_URL ?? 'https://login.salesforce.com';");
    }
    fixDuplicatePopupPromises(source) {
        const promiseCount = new Map();
        return source.replace(/const\s+(page\d*Promise)\s*=\s*([\w$.]+)\.waitForEvent\('popup'\);/g, (match, name, pageRef) => {
            const count = (promiseCount.get(name) ?? 0) + 1;
            promiseCount.set(name, count);
            if (count === 1) {
                return match;
            }
            const renamed = `${name}_${count}`;
            return `const ${renamed} = ${pageRef}.waitForEvent('popup');`;
        });
    }
    normalizeSetupPopupSequence(source) {
        return source.replace(/(\s*)await page\.getByRole\('button', \{ name: 'Setup' \}\)\.click\(\);\n((?:\s*(?:await page\.(?:goto|waitForTimeout)\([^\n]+\);|\/\/[^\n]*)\n)*)\s*const (page\d*Promise) = page\.waitForEvent\('popup'\);\n\s*await page\.getByRole\('menuitem', \{ name: 'Setup Opens in a new tab Setup for current app' \}\)\.click\(\);\n\s*const (page\d+) = await \3;/g, (match, indent, intermediateSteps = '', _promiseVar, pageVar) => {
            const normalizedSteps = intermediateSteps ? intermediateSteps.replace(/\s+$/, '\n') : '';
            return `${indent}${normalizedSteps}${indent}const ${pageVar} = await openSetupPopup(page);\n`;
        });
    }
    removeOrphanPopupPromises(source) {
        const declarationRegex = /const\s+(page\d*Promise(?:_\d+)?)\s*=\s*[\w$.]+\.waitForEvent\('popup'\);\n?/g;
        return source.replace(declarationRegex, (match, promiseVar, offset, fullSource) => {
            const remaining = fullSource.slice(offset + match.length);
            const awaitPattern = new RegExp(`await\\s+${promiseVar}\\b`);
            return awaitPattern.test(remaining) ? match : '';
        });
    }
    rebindClosedPopupPageHandles(source) {
        const closeRegex = /await\s+(page\d*)\.close\(\);/g;
        let updated = source;
        const matches = [...source.matchAll(closeRegex)];
        for (const match of matches) {
            const pageVar = match[1];
            const closeStatement = match[0];
            const closeIndex = match.index ?? -1;
            if (closeIndex < 0) {
                continue;
            }
            const afterClose = updated.slice(closeIndex + closeStatement.length);
            if (!new RegExp(`\\b${pageVar}\\.`).test(afterClose)) {
                continue;
            }
            const reopenedVar = `${pageVar}Reopened`;
            const reopenSnippet = `
  const ${reopenedVar} = await openSetupPopup(page);
`;
            updated = `${updated.slice(0, closeIndex + closeStatement.length)}${reopenSnippet}${updated.slice(closeIndex + closeStatement.length)}`;
            const injectedAt = closeIndex + closeStatement.length + reopenSnippet.length;
            const tail = updated.slice(injectedAt).replace(new RegExp(`\\b${pageVar}\\.`, 'g'), `${reopenedVar}.`);
            updated = `${updated.slice(0, injectedAt)}${tail}`;
        }
        return updated;
    }
    createPatchedTestFile(testFile, vlocityJobTime) {
        const patchedPath = path.resolve(process.cwd(), 'tests', `.metadelta.${path.basename(testFile)}`);
        const original = fs.readFileSync(testFile, 'utf8');
        const stabilizedOriginal = this.applyStructuralStabilizers(original);
        this.ensureRoutesFile();
        const normalizedFrames = this.shouldNormalizeVisualforceFrames()
            ? stabilizedOriginal
                .replace(/vfFrameId_\d+/g, 'vfFrameId_')
                .replace(/iframe\[name="vfFrameId_"\]/g, 'iframe[name^="vfFrameId_"]')
                .replace(/iframe\[name="vfFrameId_\d+"\]/g, 'iframe[name^="vfFrameId_"]')
            : stabilizedOriginal;
        const normalizedButtons = this.shouldNormalizeGenericButtonSelectors()
            ? normalizedFrames.replace(/contentFrame\(\)\.locator\('button:nth-child\(2\)'\)/g, "contentFrame().getByRole('button', { name: /Start/i })")
            : normalizedFrames;
        const normalizedStartRole = this.shouldNormalizeGenericButtonSelectors()
            ? normalizedButtons
                .replace(/contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)/g, "contentFrame().getByRole('button', { name: /Start/i }).first()")
                .replace(/contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\)/g, "contentFrame().getByRole('button', { name: /Start/i }).first().click({force: true})")
                .replace(/contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\)\.toBeVisible\(\)/g, "contentFrame().getByRole('button', { name: /Start/i }).first()).toBeVisible()")
            : normalizedButtons;
        const normalizedAppLauncherSearchClick = normalizedStartRole.replace(/await page\.getByRole\('combobox', \{ name: 'Search apps and items\.\.\.' \}\)\.click\(\);/g, `{
    const launcherSearch = page.getByRole('combobox', {name: 'Search apps and items...'}).first();
    if ((await launcherSearch.count()) === 0) {
      const launcherButton = page.getByRole('button', {name: 'App Launcher'}).first();
      if (await launcherButton.count()) {
        await launcherButton.click({timeout: 15000});
      }
    }
    if ((await launcherSearch.count()) > 0) {
      await launcherSearch.click({timeout: 15000});
    } else {
      const launcherFallback = page.getByPlaceholder('Search apps and items...').first();
      await launcherFallback.waitFor({timeout: 15000});
      await launcherFallback.click({timeout: 15000});
    }
  }`);
        const normalizedAppLauncherSearchFill = normalizedAppLauncherSearchClick.replace(/await page\.getByRole\('combobox', \{ name: 'Search apps and items\.\.\.' \}\)\.fill\('([^']+)'\);/g, `{
    const launcherSearch = page.getByRole('combobox', {name: 'Search apps and items...'}).first();
    if ((await launcherSearch.count()) > 0) {
      await launcherSearch.fill('$1');
    } else {
      const launcherFallback = page.getByPlaceholder('Search apps and items...').first();
      await launcherFallback.waitFor({timeout: 15000});
      await launcherFallback.fill('$1');
    }
  }`);
        const normalizedOptionClick = normalizedAppLauncherSearchFill.replace(/await page\.getByRole\('option', \{ name: 'Vlocity CMT Administration' \}\)\.click\(\);/g, `{
    const option = page.getByRole('option', {name: 'Vlocity CMT Administration'});
    if (await option.count()) {
      await option.first().click({timeout: 15000});
    } else {
      const optionByRole = page.locator('[role="option"]').filter({hasText: 'Vlocity CMT Administration'}).first();
      if (await optionByRole.count()) {
        await optionByRole.click({timeout: 15000, force: true});
      } else {
        await page.getByText('Vlocity CMT Administration').first().click({timeout: 15000, force: true});
      }
    }
  }`);
        const normalizedStatusWaits = normalizedOptionClick
            .replace(/await expect\(([^)]+getByText\('InProgress'\)[^)]*)\)\.toBeVisible\(\{timeout: 120000\}\);/g, `await expect.poll(async () => await $1.count(), {timeout: 300000}).toBeGreaterThan(0);`)
            .replace(/await expect\(([^)]+getByText\('Success'\)[^)]*)\)\.toBeVisible\(\{timeout: 120000\}\);/g, `await expect.poll(async () => await $1.count(), {timeout: 300000}).toBeGreaterThan(0);`)
            .replace(/getByText\('InProgress'\)\)\.toBeVisible\(\)/g, "getByText('InProgress').first()).toBeVisible({timeout: 300000})")
            .replace(/getByText\('Success'\)(?:\.first\(\))?\)\.toBeVisible\(\)/g, "getByText('Success').first()).toBeVisible({timeout: 300000})");
        const normalizedStartClicks = normalizedStatusWaits
            .replace(/await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\{force: true\}\);/g, `await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: /Start/i})
    .first()
    .click({force: true});
  await ensureStartTriggered(page);`)
            .replace(/await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\);/g, `await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: /Start/i})
    .first()
    .click();
  await ensureStartTriggered(page);`);
        const normalizedModalStartClicks = normalizedStartClicks.replace(/await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\{force: true\}\);/g, `await clickModalStartIfPresent(page);
  await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: /Start/i})
    .first()
    .click({force: true});
  await ensureStartTriggered(page);`);
        const normalizedExactStartClicks = normalizedModalStartClicks.replace(/await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: 'Start' \}\)\.first\(\)\.click\(\);/g, `await clickModalStartIfPresent(page);
  await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: 'Start'})
    .first()
    .click({force: true});
  await ensureStartTriggered(page);`);
        const normalizedMaintenanceWaits = normalizedExactStartClicks.replace(/await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.locator\('([^']*job-start[^']*)'\)\.click\(\);\s*\n\s*await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: 'OK' \}\)\.click\(\);/g, `await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .locator('$1')
    .click();
  await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: 'OK'})
    .click();
  await waitForMaintenanceJob();`);
        const normalizedDeliverabilityClick = normalizedMaintenanceWaits.replace(/await (\w+)\.getByRole\('link', \{ name: 'Deliverability', exact: true \}\)\.click\(\);/g, `{
    const deliverabilityLink = $1.getByRole('link', {name: 'Deliverability', exact: true});
    if (await deliverabilityLink.count()) {
      await deliverabilityLink.first().click({timeout: 15000});
    } else {
      await $1.getByText('Deliverability', {exact: true}).first().click({timeout: 15000});
    }
  }`);
        const normalizedUserInterfaceClick = normalizedDeliverabilityClick.replace(/await (\w+)\.getByRole\('link', \{ name: 'User Interface' \}\)\.nth\(1\)\.click\(\);/g, `{
    const uiLinks = $1.getByRole('link', {name: 'User Interface'});
    if (await uiLinks.nth(1).count()) {
      await uiLinks.nth(1).scrollIntoViewIfNeeded();
      await uiLinks.nth(1).click({timeout: 15000, force: true});
    } else {
      await uiLinks.first().scrollIntoViewIfNeeded();
      await uiLinks.first().click({timeout: 15000, force: true});
    }
  }`);
        const normalizedQuickFind = normalizedUserInterfaceClick.replace(/await (\w+)\.getByRole\('searchbox', \{ name: 'Quick Find' \}\)\.fill\('([^']+)'\);/g, `await $1.getByRole('searchbox', {name: 'Quick Find'}).fill('$2');
  await $1.getByRole('searchbox', {name: 'Quick Find'}).press('Enter');`);
        const normalizedAgentforceLink = normalizedQuickFind.replace(/await (\w+)\.getByRole\('link', \{ name: 'Agentforce Agents' \}\)\.click\(\);/g, `{
    const agentforceLink = $1.getByRole('link', {name: 'Agentforce Agents'}).first();
    if ((await agentforceLink.count()) === 0) {
      await $1.waitForLoadState('domcontentloaded');
      await $1.waitForTimeout(3000);
      await $1.reload({waitUntil: 'domcontentloaded'});
      await $1.getByRole('searchbox', {name: 'Quick Find'}).fill('Agentforce Agents');
      await $1.getByRole('searchbox', {name: 'Quick Find'}).press('Enter');
    }
    if ((await agentforceLink.count()) > 0) {
      await agentforceLink.click({timeout: 15000});
    } else {
      await $1.getByText('Agentforce Agents', {exact: true}).first().click({timeout: 15000, force: true});
    }
  }`);
        const normalizedPermissionSetAssignmentsLink = normalizedAgentforceLink.replace(/await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('link', \{ name: 'Permission Set Assignments\[\d+\]' \}\)\.click\(\);/g, `{
    const vf = await $1.locator('iframe[name^="vfFrameId_"]').first().contentFrame();
    if (vf) {
      const assignmentLink = vf.getByRole('link', {name: /Permission Set Assignments\\s*\\[\\d+\\]/i}).first();
      if ((await assignmentLink.count()) > 0) {
        await assignmentLink.click({timeout: 15000});
      } else {
        await vf.getByText(/Permission Set Assignments\\s*\\[\\d+\\]/i).first().click({timeout: 15000, force: true});
      }
    }
  }`);
        const normalizedPermissionSetAssignmentsRow = normalizedPermissionSetAssignmentsLink.replace(/await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('row', \{ name: 'Permission Set Assignments Edit Assignments Permission Set Assignments Help' \}\)\.locator\('input\[name="editPermSetAssignments"\]'\)\.click\(\);/g, `{
    const vf = await $1.locator('iframe[name^="vfFrameId_"]').first().contentFrame();
    if (vf) {
      const editAssignmentsButton = vf
        .getByRole('row', {name: /^Permission Set Assignments/i})
        .locator('input[name="editPermSetAssignments"]')
        .first();
      await editAssignmentsButton.click({timeout: 15000});
    }
  }`);
        const normalizedIframeHtmlClicks = normalizedPermissionSetAssignmentsRow.replace(/await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.locator\('html'\)\.click\(\);/g, `// omit iframe html click in patched tests to avoid timeouts in other orgs`);
        const normalizedBaseUrls = normalizedIframeHtmlClicks
            .replace(/https:\/\/[^'"]+\.my\.salesforce\.com(\/[^'"]*)?/g, 'baseUrl$1')
            .replace(/https:\/\/[^'"]+\.lightning\.force\.com(\/[^'"]*)?/g, 'baseUrl$1')
            .replace(/https:\/\/[^'"]+\.salesforce-setup\.com(\/[^'"]*)?/g, 'baseUrl$1')
            .replace(/https:\/\/[^'"]+\.salesforce\.com(\/[^'"]*)?/g, 'baseUrl$1')
            .replace(/https%3A%2F%2F[^'"]+?(?:my%2Esalesforce%2Ecom|lightning%2Eforce%2Ecom|salesforce-setup%2Ecom|salesforce%2Ecom)%2F/gi, 'baseUrl/');
        const normalizedBaseUrlExpressions = normalizedBaseUrls
            .replace(/'baseUrl(\/[^']*)'/g, "baseUrl + '$1'")
            .replace(/"baseUrl(\/[^"]*)"/g, "baseUrl + '$1'");
        const normalizedGotoCalls = normalizedBaseUrlExpressions.replace(/await (\w+)\.goto\(([^;]+)\);/g, `await gotoWithRetry($1, $2);`);
        const normalizedActionLibraryCheckboxes = normalizedGotoCalls.replace(/await (\w+)\.locator\('#check-button-label-[^']+ > \.slds-checkbox_faux'\)\.click\(\);/g, `await selectActionLibraryCheckboxWithScroll($1);`);
        const normalizedCheckboxes = normalizedActionLibraryCheckboxes.replace(/await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('checkbox', \{ name: '([^']+)' \}\)\.(check|uncheck)\(\);/g, `{
    const checkbox = await ensureSetupCheckbox($1, '$2', 'User Interface');
    if (checkbox) {
      await checkbox.scrollIntoViewIfNeeded();
      await checkbox.$3({timeout: 15000});
    }
  }`);
        const normalizedFinishButtonClick = normalizedCheckboxes.replace(/await (\w+)\.getByRole\('button', \{ name: 'Finish' \}\)\.click\(\);/g, `await clickFinishWhenEnabled($1);`);
        const normalizedSetupSaveClicks = normalizedFinishButtonClick.replace(/await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: 'Save' \}\)\.click\(\);/g, `{
    const saveButton = $1
      .locator('iframe[name^="vfFrameId_"]')
      .contentFrame()
      .getByRole('button', {name: 'Save'});
    if (await saveButton.count()) {
      await saveButton.first().click({timeout: 15000});
    } else {
      console.log('⚠️ Se omite Save porque no existe botón Save visible en el contexto actual.');
    }
  }`);
        const normalizedClickLogs = normalizedSetupSaveClicks.replace(/await (\w+)\.getByRole\('searchbox', \{ name: 'Quick Find' \}\)\.press\('Enter'\);/g, `console.log('➡️ Enter: Quick Find');\n  await $1.getByRole('searchbox', {name: 'Quick Find'}).press('Enter');`);
        const normalizedClickLogsFinal = normalizedClickLogs
            .replace(/\n(\s*)await ([^;\n]+?getByRole\([^;\n]+?name:\s*'([^']+)'[^;\n]*\))\.click\(([^)]*)\);/g, `\n$1console.log('➡️ Click: name: "$3"');\n$1await $2.click($4);`)
            .replace(/\n(\s*)await ([^;\n]+?getByText\('([^']+)'\)[^;\n]*)\.click\(([^)]*)\);/g, `\n$1console.log('➡️ Click: "$3"');\n$1await $2.click($4);`);
        const injectedImports = normalizedClickLogsFinal.replace(/(import\s+\{\s*test[^;]+;)/, `$1\nimport {runTaskOrchestrator} from './metadelta-task-orchestrator-routes.js';`);
        const baseUrlDeclaration = injectedImports.includes('const baseUrl')
            ? ''
            : 'const baseUrl = process.env.METADELTA_BASE_URL;\n';
        const injectedBase = injectedImports.replace(/(import\s+\{\s*test[^;]+;\n)/, `$1${baseUrlDeclaration}`);
        const injected = injectedBase.replace(/(test\(['"][^'"]+['"],\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{\s*\n)/, `$1  test.setTimeout(${Math.max(300000, (vlocityJobTime ?? 180) * 1000 + 120000)});\n  page.setDefaultTimeout(60000);\n  installOrgDomainGuard(page);\n  await gotoWithRetry(page, process.env.METADELTA_FRONTDOOR_URL ?? process.env.METADELTA_BASE_URL);\n  await runTaskOrchestrator(page);\n`);
        const helper = `
async function gotoWithRetry(page, destination, options = {}) {
  const defaultOptions = {waitUntil: 'domcontentloaded', ...options};
  try {
    await page.goto(destination, defaultOptions);
  } catch (error) {
    const message = String(error?.message ?? '');
    if (!/net::ERR_ABORTED/i.test(message)) {
      throw error;
    }
    await page.waitForTimeout(1200);
    await page.goto(destination, defaultOptions);
  }
}

async function openSetupPopup(page, options = {}) {
  const {timeoutMs = 20000, popupTimeoutMs = 60000} = options;
  const setupButton = page.getByRole('button', {name: 'Setup'}).first();
  const setupMenuCandidates = [
    page.getByRole('menuitem', {name: 'Setup Opens in a new tab Setup for current app'}).first(),
    page.getByRole('menuitem', {name: /Setup Opens in a new tab/i}).first(),
    page.getByText(/Setup Opens in a new tab/i).first(),
  ];

  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await setupButton.waitFor({timeout: timeoutMs});
      await setupButton.click({timeout: timeoutMs});

      let setupMenuItem = null;
      for (const candidate of setupMenuCandidates) {
        if ((await candidate.count()) > 0) {
          setupMenuItem = candidate;
          break;
        }
      }

      if (!setupMenuItem) {
        for (const candidate of setupMenuCandidates) {
          try {
            await candidate.waitFor({timeout: Math.max(4000, Math.floor(timeoutMs / 2))});
            setupMenuItem = candidate;
            break;
          } catch (error) {
            lastError = error;
          }
        }
      }

      if (!setupMenuItem) {
        throw lastError ?? new Error('No se encontró el menuitem de Setup para abrir la nueva pestaña.');
      }

      const popupPromise = page.waitForEvent('popup', {timeout: popupTimeoutMs});
      await setupMenuItem.click({timeout: timeoutMs, force: true});
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded', {timeout: 15000}).catch(() => {});
      return popup;
    } catch (error) {
      lastError = error;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(800);
    }
  }

  throw new Error('No se pudo abrir Setup en una nueva pestaña. ' + (lastError?.message ?? 'El menú o popup no estuvo disponible.'));
}

async function waitForActionLibraryReady(page, timeoutMs = 45000) {
  const modalContainer = page.locator('section[role="dialog"], .slds-modal__content').first();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const hasModal = (await modalContainer.count()) > 0;
    const rows = hasModal ? modalContainer.locator('tbody tr') : page.locator('tbody tr');
    const checkboxes = hasModal
      ? modalContainer.locator('[id^="check-button-label-"], tbody tr .slds-checkbox_faux, tbody tr input[type="checkbox"]')
      : page.locator('[id^="check-button-label-"], tbody tr .slds-checkbox_faux, tbody tr input[type="checkbox"]');

    const rowCount = await rows.count();
    const checkboxCount = await checkboxes.count();
    const loadingSpinners = hasModal ? modalContainer.locator('.slds-spinner, [role="progressbar"]') : page.locator('.slds-spinner, [role="progressbar"]');
    const spinnerCount = await loadingSpinners.count();

    if ((rowCount > 0 || checkboxCount > 0) && spinnerCount === 0) {
      return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function selectActionLibraryCheckboxWithScroll(page, options = {}) {
  const {requireFinishEnabled = false} = options;
  const modalContainer = page.locator('section[role="dialog"], .slds-modal__content').first();
  const finishButton = page.getByRole('button', {name: 'Finish'}).first();

  await waitForActionLibraryReady(page, 45000);

  async function isFinishReady() {
    return (await finishButton.count()) > 0 && (await finishButton.isEnabled());
  }

  async function trySelectCheckbox() {
    const selectorAttempts = [
      {type: 'click', locator: modalContainer.locator('[id^="check-button-label-"] .slds-checkbox_faux')},
      {type: 'click', locator: modalContainer.locator('[id^="check-button-label-"]')},
      {type: 'click', locator: modalContainer.locator('tbody tr .slds-checkbox_faux')},
      {type: 'click', locator: modalContainer.locator('tbody tr [role="checkbox"]')},
      {type: 'check', locator: modalContainer.locator('tbody tr input[type="checkbox"]')},
    ];

    for (const attempt of selectorAttempts) {
      const locator = attempt.locator;
      if ((await locator.count()) === 0) {
        continue;
      }
      const target = locator.first();
      await target.scrollIntoViewIfNeeded();
      if (attempt.type === 'check') {
        await target.check({timeout: 15000, force: true});
      } else {
        await target.click({timeout: 15000, force: true});
      }
      return true;
    }

    return false;
  }

  async function scrollActionLibrary(direction = 1) {
    const scrollHost = (await modalContainer.count()) > 0 ? modalContainer : page.locator('body');
    await scrollHost.evaluate((node, dir) => {
      const root = node;
      const candidates = [root, ...root.querySelectorAll('*')];
      for (const element of candidates) {
        const style = window.getComputedStyle(element);
        const canScroll =
          (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') &&
          element.scrollHeight > element.clientHeight;
        if (canScroll) {
          element.scrollBy(0, 320 * dir);
        }
      }
    }, direction);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!requireFinishEnabled && (await isFinishReady())) {
      return true;
    }

    const selected = await trySelectCheckbox();
    if (selected) {
      await page.waitForTimeout(500);
      if (!requireFinishEnabled || (await isFinishReady())) {
        return true;
      }
    }

    if (attempt % 4 === 0) {
      await waitForActionLibraryReady(page, 8000);
    }

    const direction = attempt < 14 ? 1 : -1;
    await scrollActionLibrary(direction);
    await page.waitForTimeout(350);
  }

  if (!requireFinishEnabled) {
    console.log('⚠️ No se pudo seleccionar checkbox de Action Library automáticamente; se continuará con el flujo.');
    return false;
  }

  throw new Error('El botón Finish permanece deshabilitado después de intentar seleccionar acciones con scroll.');
}

async function clickFinishWhenEnabled(page) {
  const finishButton = page.getByRole('button', {name: 'Finish'}).first();
  await waitForActionLibraryReady(page, 45000);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await finishButton.count()) > 0 && (await finishButton.isEnabled())) {
      await finishButton.click({timeout: 15000});
      return;
    }

    await selectActionLibraryCheckboxWithScroll(page, {requireFinishEnabled: true});
    await page.waitForTimeout(350);
  }

  throw new Error('El botón Finish permanece deshabilitado después de intentar seleccionar acciones con scroll.');
}


async function waitForMaintenanceJob() {
  const waitMs = Number(process.env.METADELTA_VLOCITY_JOB_WAIT_MS ?? 180000);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function installOrgDomainGuard(page) {
  const base = process.env.METADELTA_BASE_URL;
  if (!base) {
    return;
  }

  const baseOrigin = new URL(base).origin;
  page.context().on('page', async (popup) => {
    try {
      await popup.waitForLoadState('domcontentloaded', {timeout: 15000});
      const current = popup.url();
      if (!current || current.startsWith(baseOrigin) || current.startsWith('about:blank')) {
        return;
      }
      const target = new URL(current);
      const startURL = target.searchParams.get('startURL');
      if (startURL) {
        const decoded = decodeURIComponent(startURL);
        const normalized = decoded.replace(new RegExp('^https?://[^/]+', 'i'), baseOrigin);
        const nextPath = normalized.startsWith(baseOrigin) ? normalized.slice(baseOrigin.length) : normalized;
        await popup.goto(baseOrigin + (nextPath.startsWith('/') ? nextPath : '/' + nextPath));
      } else {
        await popup.goto(baseOrigin + target.pathname + target.search + target.hash);
      }
    } catch (error) {
      // noop
    }
  });
}

let setupSectionReady = false;

function markSetupSectionReady() {
  setupSectionReady = true;
}

function isSetupSectionReady() {
  return setupSectionReady;
}

async function ensureSetupCheckbox(page, label, sectionName) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let vf = null;
    try {
      await frameLocator.waitFor({timeout: 15000});
      vf = await frameLocator.contentFrame();
    } catch (error) {
      vf = null;
    }
    if (vf) {
      const checkbox = vf.getByRole('checkbox', {name: label});
      if ((await checkbox.count()) > 0) {
        return checkbox;
      }
    }
    const setupSearch = page.getByRole('searchbox', {name: 'Search Setup'});
    if ((await setupSearch.count()) > 0) {
      await setupSearch.fill(sectionName);
      await setupSearch.press('Enter');
    }
    const sectionLinks = page.getByRole('link', {name: sectionName});
    if ((await sectionLinks.count()) > 0) {
      const targetLink = (await sectionLinks.count()) > 1 ? sectionLinks.last() : sectionLinks.first();
      await targetLink.scrollIntoViewIfNeeded();
      await targetLink.click({timeout: 15000, force: true});
    }
    await page.waitForTimeout(1000);
    vf = await frameLocator.contentFrame();
    if (vf) {
      const checkbox = vf.getByRole('checkbox', {name: label});
      if ((await checkbox.count()) > 0) {
        return checkbox;
      }
    }
  }
  console.log(
    '⚠️ No se encontró el checkbox "' +
      label +
      '" en la sección "' +
      sectionName +
      '". Se omite este paso.'
  );
  return null;
}

async function clickModalStartIfPresent(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const modalStart = vf
    .locator('section[role="dialog"]')
    .getByRole('button', {name: /Start/i})
    .first();
  const footerStart = vf
    .locator('.slds-modal__footer')
    .getByRole('button', {name: /Start/i})
    .first();
  if ((await modalStart.count()) > 0) {
    await modalStart.click({force: true});
    await modalStart.evaluate((el) => el.click());
    return;
  }
  if ((await footerStart.count()) > 0) {
    await footerStart.click({force: true});
    await footerStart.evaluate((el) => el.click());
  }
}

async function ensureStartTriggered(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  try {
    await frameLocator.waitFor({timeout: 15000});
    const vf = await frameLocator.contentFrame();
    if (!vf) {
      return;
    }
    const inProgress = vf.getByText('InProgress');
    const success = vf.getByText('Success').first();
    const modalStart = vf
      .locator('section[role="dialog"]')
      .getByRole('button', {name: /Start/i})
      .first();
    const footerStart = vf
      .locator('.slds-modal__footer')
      .getByRole('button', {name: /Start/i})
      .first();
    const startButton = vf.getByRole('button', {name: /Start/i}).first();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const hasStatus =
        (await inProgress.count()) > 0 || (await success.count()) > 0;
      if (hasStatus) {
        return;
      }
      if ((await modalStart.count()) > 0) {
        await modalStart.click({force: true});
        await modalStart.evaluate((el) => el.click());
      } else if ((await footerStart.count()) > 0) {
        await footerStart.click({force: true});
        await footerStart.evaluate((el) => el.click());
      } else if ((await startButton.count()) > 0) {
        await startButton.click({force: true});
        await startButton.evaluate((el) => el.click());
      } else {
        return;
      }
      await vf.page().waitForTimeout(1000);
    }
  } catch (error) {
    // noop: si no se puede validar, dejamos que el flujo continúe.
  }
}
`;
        let withHelper = injected;
        const hasHelper = /async function ensureStartTriggered\(/.test(withHelper);
        if (!hasHelper) {
            withHelper = `${helper}\n${withHelper}`;
        }
        fs.writeFileSync(patchedPath, withHelper, 'utf8');
        return patchedPath;
    }
    shouldNormalizeVisualforceFrames() {
        const routesPath = path.resolve(process.cwd(), 'tests', 'metadelta-task-orchestrator-routes.js');
        if (!fs.existsSync(routesPath)) {
            return true;
        }
        const contents = fs.readFileSync(routesPath, 'utf8');
        const normalizeVisualforce = !/normalizeVisualforceFrame\s*:\s*false/.test(contents);
        const normalizeGeneric = !/normalizeGenericButtonSelector\s*:\s*false/.test(contents);
        return normalizeVisualforce || normalizeGeneric;
    }
    shouldNormalizeGenericButtonSelectors() {
        const routesPath = path.resolve(process.cwd(), 'tests', 'metadelta-task-orchestrator-routes.js');
        if (!fs.existsSync(routesPath)) {
            return true;
        }
        const contents = fs.readFileSync(routesPath, 'utf8');
        return !/normalizeGenericButtonSelector\s*:\s*false/.test(contents);
    }
    ensureRoutesFile() {
        const routesPath = path.resolve(process.cwd(), 'tests', 'metadelta-task-orchestrator-routes.js');
        if (fs.existsSync(routesPath)) {
            return;
        }
        const contents = `export const orchestratorOptions = {
  normalizeVisualforceFrame: true,
  normalizeGenericButtonSelector: true,
};

export async function runTaskOrchestrator(page) {
  const routes = [
    {
      name: 'Lightning App Launcher abierto',
      check: async () => await isAppLauncherOpen(page),
      run: async () => {
        await page.waitForTimeout(250);
      },
    },
    {
      name: 'Abrir App Launcher si está disponible',
      check: async () => await hasAppLauncherButton(page),
      run: async () => {
        const launcherButton = page.getByRole('button', {name: 'App Launcher'});
        await launcherButton.first().click({timeout: 5000});
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'Esperar buscador del App Launcher',
      check: async () => await hasAppLauncherSearch(page),
      run: async () => {
        await page.getByRole('combobox', {name: 'Search apps and items...'}).waitFor({timeout: 10000});
      },
    },
    {
      name: 'Seleccionar opción Vlocity CMT Administration',
      check: async () => await hasAppLauncherOption(page),
      run: async () => {
        await clickAppLauncherOption(page);
      },
    },
    {
      name: 'Esperar Visualforce para Maintenance Jobs',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await waitForMaintenanceJobsLink(page);
      },
    },
    {
      name: 'Click Maintenance Jobs en Visualforce',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await clickMaintenanceJobsLink(page);
      },
    },
    {
      name: 'Cerrar modales en Visualforce',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await closeVisualforceModals(page);
      },
    },
    {
      name: 'Normalizar botón genérico en Visualforce',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await normalizeGenericButtonSelector(page);
      },
    },
    {
      name: 'Click Start seguro en Visualforce',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await clickSafeStartButton(page);
      },
    },
    {
      name: 'Fallback Start con force click',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await forceClickStartButton(page);
      },
    },
  ];

  for (const route of routes) {
    const shouldRun = await route.check();
    if (shouldRun) {
      await route.run();
    }
  }
}

async function hasAppLauncherButton(page) {
  try {
    return (await page.getByRole('button', {name: 'App Launcher'}).count()) > 0;
  } catch (error) {
    return false;
  }
}

async function hasAppLauncherSearch(page) {
  try {
    return (await page.getByRole('combobox', {name: 'Search apps and items...'}).count()) > 0;
  } catch (error) {
    return false;
  }
}

async function hasAppLauncherOption(page) {
  try {
    return (await page.getByRole('option', {name: 'Vlocity CMT Administration'}).count()) > 0;
  } catch (error) {
    return false;
  }
}

async function isAppLauncherOpen(page) {
  try {
    return await page
      .getByRole('combobox', {name: 'Search apps and items...'})
      .isVisible({timeout: 1000});
  } catch (error) {
    return false;
  }
}

async function clickAppLauncherOption(page) {
  const option = page.getByRole('option', {name: 'Vlocity CMT Administration'});
  await option.waitFor({timeout: 15000});
  await option.first().click({timeout: 5000});
  await page.waitForTimeout(500);
}

async function hasVisualforceFrame(page) {
  try {
    return (await page.locator('iframe[name^="vfFrameId_"]').count()) > 0;
  } catch (error) {
    return false;
  }
}

async function waitForMaintenanceJobsLink(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  await vf.getByRole('link', {name: 'Maintenance Jobs'}).waitFor({timeout: 15000});
}

async function clickMaintenanceJobsLink(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const link = vf.getByRole('link', {name: 'Maintenance Jobs'});
  await link.waitFor({timeout: 15000});
  try {
    await link.click({timeout: 5000});
  } catch (error) {
    await vf.page().waitForTimeout(1000);
    await link.click({timeout: 5000});
  }
}

async function closeVisualforceModals(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const backdrop = vf.locator('.slds-backdrop--open');
  const modal = vf.locator('.slds-modal.slds-fade-in-open');
  if ((await backdrop.count()) > 0 || (await modal.count()) > 0) {
    const closeButton = vf.getByRole('button', {name: /Close|Cancel|OK|Done/i});
    if ((await closeButton.count()) > 0) {
      await closeButton.first().click({timeout: 5000});
    }
  }
}

async function normalizeGenericButtonSelector(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const buttons = vf.locator('button:nth-child(2)');
  const count = await buttons.count();
  if (count > 1) {
    const startButton = vf.getByRole('button', {name: /Start/i});
    if ((await startButton.count()) > 0) {
      await startButton.first().click({timeout: 5000});
    }
  }
}

async function clickSafeStartButton(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  await closeVisualforceModals(page);
  const startButton = vf.getByRole('button', {name: /Start/i}).first();
  if ((await startButton.count()) === 0) {
    return;
  }
  try {
    await startButton.click({timeout: 5000});
  } catch (error) {
    await closeVisualforceModals(page);
    await startButton.click({timeout: 5000});
  }
}

async function forceClickStartButton(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const startButton = vf.getByRole('button', {name: /Start/i}).first();
  if ((await startButton.count()) === 0) {
    return;
  }
  await startButton.click({timeout: 5000, force: true});
}
`;
        fs.writeFileSync(routesPath, contents, 'utf8');
    }
}
export default TaskPlay;
