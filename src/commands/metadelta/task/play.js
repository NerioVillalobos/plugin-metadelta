import {Command, Flags} from '@oclif/core';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  TaskOrchestrator,
  ensureTestsDirectory,
  ensurePlaywrightReady,
  ensurePlaywrightTestDependency,
  resolveTestFilePath,
} from '../../../utils/task/orchestrator.js';

class TaskPlay extends Command {
  static summary = 'Reproduce una grabación de Playwright en una org de Salesforce.';

  static flags = {
    org: Flags.string({
      char: 'o',
      summary: 'Alias de sf-cli para la org en la que se ejecutará la tarea.',
      required: true,
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
    const {flags} = await this.parse(TaskPlay);
    const orchestrator = new TaskOrchestrator({commandName: 'metadelta task play'});
    const targetOrg = flags.org;
    const testFile = resolveTestFilePath({name: flags.tstname});

    try {
      ensureTestsDirectory();
      if (!testFile || !fs.existsSync(testFile)) {
        this.error(`No se encontró el archivo de prueba: ${flags.tstname}`);
      }

      ensurePlaywrightReady();
      const {cacheDir, cliPath} = ensurePlaywrightTestDependency(process.cwd());
      const url = this.fetchOrgFrontdoorUrl(targetOrg);
      const patchedTestFile = this.createPatchedTestFile(testFile, flags['vlocity-job-time']);
      const configPath = this.createPlaywrightConfig(patchedTestFile);
      const args = [cliPath, 'test', '--config', configPath, '--reporter', 'line'];
      if (flags.header) {
        args.push('--headed');
      }

      this.log(`Ejecutando prueba en ${targetOrg} con archivo ${testFile}`);

      const result = spawnSync(process.execPath, args, {
        stdio: 'inherit',
        env: {
          ...process.env,
          METADELTA_BASE_URL: url,
          METADELTA_VLOCITY_JOB_WAIT_MS: String((flags['vlocity-job-time'] ?? 180) * 1000),
          NODE_PATH: cacheDir ? path.join(cacheDir, 'node_modules') : process.env.NODE_PATH,
        },
      });

      if (result.status !== 0) {
        this.error('La ejecución de Playwright finalizó con errores.');
      }

      fs.rmSync(configPath, {force: true});
      fs.rmSync(patchedTestFile, {force: true});
    } catch (error) {
      orchestrator.recordError({
        message: error.message,
        stack: error.stack,
        context: {org: targetOrg, testFile: flags.tstname},
      });
      const solution = orchestrator.findSolution(error.message);
      if (solution) {
        this.error(`${error.message}\nSugerencia: ${solution.solution}`);
      }
      this.error(error.message);
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
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, contents, 'utf8');
    return configPath;
  }

  createPatchedTestFile(testFile, vlocityJobTime) {
    const patchedPath = path.resolve(process.cwd(), 'tests', `.metadelta.${path.basename(testFile)}`);
    const original = fs.readFileSync(testFile, 'utf8');
    this.ensureRoutesFile();
    const normalizedFrames = this.shouldNormalizeVisualforceFrames()
      ? original
          .replace(/vfFrameId_\d+/g, 'vfFrameId_')
          .replace(/iframe\[name="vfFrameId_"\]/g, 'iframe[name^="vfFrameId_"]')
          .replace(/iframe\[name="vfFrameId_\d+"\]/g, 'iframe[name^="vfFrameId_"]')
      : original;
    const normalizedButtons = this.shouldNormalizeGenericButtonSelectors()
      ? normalizedFrames.replace(
          /contentFrame\(\)\.locator\('button:nth-child\(2\)'\)/g,
          "contentFrame().getByRole('button', { name: /Start/i })"
        )
      : normalizedFrames;
    const normalizedStartRole = this.shouldNormalizeGenericButtonSelectors()
      ? normalizedButtons
          .replace(
            /contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)/g,
            "contentFrame().getByRole('button', { name: /Start/i }).first()"
          )
          .replace(
            /contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\)/g,
            "contentFrame().getByRole('button', { name: /Start/i }).first().click({force: true})"
          )
          .replace(
            /contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\)\.toBeVisible\(\)/g,
            "contentFrame().getByRole('button', { name: /Start/i }).first()).toBeVisible()"
          )
      : normalizedButtons;
    const normalizedOptionClick = normalizedStartRole.replace(
      /await page\.getByRole\('option', \{ name: 'Vlocity CMT Administration' \}\)\.click\(\);/g,
      `{
    const option = page.getByRole('option', {name: 'Vlocity CMT Administration'});
    if (await option.count()) {
      await option.first().click({timeout: 15000});
    } else {
      await page.getByText('Vlocity CMT Administration').first().click({timeout: 15000});
    }
  }`
    );
    const normalizedStatusWaits = normalizedOptionClick
      .replace(
        /await expect\(([^)]+getByText\('InProgress'\)[^)]*)\)\.toBeVisible\(\{timeout: 120000\}\);/g,
        `await expect.poll(async () => await $1.count(), {timeout: 300000}).toBeGreaterThan(0);`
      )
      .replace(
        /await expect\(([^)]+getByText\('Success'\)[^)]*)\)\.toBeVisible\(\{timeout: 120000\}\);/g,
        `await expect.poll(async () => await $1.count(), {timeout: 300000}).toBeGreaterThan(0);`
      )
      .replace(
        /getByText\('InProgress'\)\)\.toBeVisible\(\)/g,
        "getByText('InProgress').first()).toBeVisible({timeout: 300000})"
      )
      .replace(
        /getByText\('Success'\)(?:\.first\(\))?\)\.toBeVisible\(\)/g,
        "getByText('Success').first()).toBeVisible({timeout: 300000})"
      );
    const normalizedStartClicks = normalizedStatusWaits
      .replace(
        /await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\{force: true\}\);/g,
        `await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: /Start/i})
    .first()
    .click({force: true});
  await ensureStartTriggered(page);`
      )
      .replace(
        /await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\);/g,
        `await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: /Start/i})
    .first()
    .click();
  await ensureStartTriggered(page);`
      );
    const normalizedModalStartClicks = normalizedStartClicks.replace(
      /await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\{force: true\}\);/g,
      `await clickModalStartIfPresent(page);
  await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: /Start/i})
    .first()
    .click({force: true});
  await ensureStartTriggered(page);`
    );
    const normalizedExactStartClicks = normalizedModalStartClicks.replace(
      /await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: 'Start' \}\)\.first\(\)\.click\(\);/g,
      `await clickModalStartIfPresent(page);
  await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: 'Start'})
    .first()
    .click({force: true});
  await ensureStartTriggered(page);`
    );
    const normalizedMaintenanceWaits = normalizedExactStartClicks.replace(
      /await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.locator\('([^']*job-start[^']*)'\)\.click\(\);\s*\n\s*await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: 'OK' \}\)\.click\(\);/g,
      `await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .locator('$1')
    .click();
  await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: 'OK'})
    .click();
  await waitForMaintenanceJob();`
    );
    const normalizedDeliverabilityClick = normalizedMaintenanceWaits.replace(
      /await (\w+)\.getByRole\('link', \{ name: 'Deliverability', exact: true \}\)\.click\(\);/g,
      `{
    const deliverabilityLink = $1.getByRole('link', {name: 'Deliverability', exact: true});
    if (await deliverabilityLink.count()) {
      await deliverabilityLink.first().click({timeout: 15000});
    } else {
      await $1.getByText('Deliverability', {exact: true}).first().click({timeout: 15000});
    }
  }`
    );
    const normalizedUserInterfaceClick = normalizedDeliverabilityClick.replace(
      /await (\w+)\.getByRole\('link', \{ name: 'User Interface' \}\)\.nth\(1\)\.click\(\);/g,
      `{
    const uiLinks = $1.getByRole('link', {name: 'User Interface'});
    if (await uiLinks.nth(1).count()) {
      await uiLinks.nth(1).scrollIntoViewIfNeeded();
      await uiLinks.nth(1).click({timeout: 15000, force: true});
    } else {
      await uiLinks.first().scrollIntoViewIfNeeded();
      await uiLinks.first().click({timeout: 15000, force: true});
    }
  }`
    );
    const normalizedQuickFind = normalizedUserInterfaceClick.replace(
      /await (\w+)\.getByRole\('searchbox', \{ name: 'Quick Find' \}\)\.fill\('([^']+)'\);/g,
      `await $1.getByRole('searchbox', {name: 'Quick Find'}).fill('$2');
  await $1.getByRole('searchbox', {name: 'Quick Find'}).press('Enter');`
    );
    const normalizedCheckboxes = normalizedQuickFind.replace(
      /await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('checkbox', \{ name: '([^']+)' \}\)\.(check|uncheck)\(\);/g,
      `{
    const checkbox = await ensureSetupCheckbox($1, '$2', 'User Interface');
    if (checkbox) {
      await checkbox.scrollIntoViewIfNeeded();
      await checkbox.$3({timeout: 15000});
      await markSetupSectionReady();
    }
  }`
    );
    const normalizedSetupSaveClicks = normalizedCheckboxes.replace(
      /await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: 'Save' \}\)\.click\(\);/g,
      `if (isSetupSectionReady()) {
    await $1
      .locator('iframe[name^="vfFrameId_"]')
      .contentFrame()
      .getByRole('button', {name: 'Save'})
      .click({timeout: 15000});
  } else {
    console.log('⚠️ Se omite Save porque no se encontró el checkbox en la sección Setup.');
  }`
    );
    const normalizedClickLogs = normalizedSetupSaveClicks.replace(
      /await (\w+)\.getByRole\('searchbox', \{ name: 'Quick Find' \}\)\.press\('Enter'\);/g,
      `console.log('➡️ Enter: Quick Find');\n  await $1.getByRole('searchbox', {name: 'Quick Find'}).press('Enter');`
    );
    const normalizedClickLogsFinal = normalizedClickLogs
      .replace(
        /\n(\s*)await ([^;\n]+?getByRole\([^;\n]+?name:\s*'([^']+)'[^;\n]*\))\.click\(([^)]*)\);/g,
        `\n$1console.log('➡️ Click: name: "$3"');\n$1await $2.click($4);`
      )
      .replace(
        /\n(\s*)await ([^;\n]+?getByText\('([^']+)'\)[^;\n]*)\.click\(([^)]*)\);/g,
        `\n$1console.log('➡️ Click: "$3"');\n$1await $2.click($4);`
      );
    const injectedImports = normalizedClickLogsFinal.replace(
      /(import\s+\{\s*test[^;]+;)/,
      `$1\nimport {runTaskOrchestrator} from './metadelta-task-orchestrator-routes.js';`
    );
    const injected = injectedImports.replace(
      /(test\(['"][^'"]+['"],\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{\s*\n)/,
      `$1  test.setTimeout(${Math.max(300000, (vlocityJobTime ?? 180) * 1000 + 120000)});\n  page.setDefaultTimeout(60000);\n  await page.goto(process.env.METADELTA_BASE_URL);\n  await runTaskOrchestrator(page);\n`
    );
    const helper = `
async function waitForMaintenanceJob() {
  const waitMs = Number(process.env.METADELTA_VLOCITY_JOB_WAIT_MS ?? 180000);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
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

  fetchOrgFrontdoorUrl(targetOrg) {
    const result = spawnSync(
      'sf',
      ['org', 'display', '--target-org', targetOrg, '--json'],
      {encoding: 'utf8'}
    );

    if (result.status !== 0) {
      const message = result.stderr?.trim() || result.stdout?.trim() || 'Error al obtener URL de la org.';
      throw new Error(message);
    }

    let url = '';
    try {
      const parsed = JSON.parse(result.stdout);
      const instanceUrl = parsed?.result?.instanceUrl ?? '';
      const accessToken = parsed?.result?.accessToken ?? '';
      if (instanceUrl && accessToken) {
        url = `${instanceUrl}/secur/frontdoor.jsp?sid=${encodeURIComponent(accessToken)}`;
      }
    } catch (error) {
      url = result.stdout.trim();
    }
    if (!url) {
      throw new Error('No se pudo resolver la URL de la org.');
    }

    return url;
  }
}

export default TaskPlay;
