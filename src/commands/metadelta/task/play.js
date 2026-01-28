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
      const patchedTestFile = this.createPatchedTestFile(testFile);
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

  createPatchedTestFile(testFile) {
    const patchedPath = path.resolve(process.cwd(), 'tests', `.metadelta.${path.basename(testFile)}`);
    const original = fs.readFileSync(testFile, 'utf8');
    const injectedImports = original.replace(
      /(import\s+\{\s*test[^;]+;)/,
      `$1\nimport {runTaskOrchestrator} from './metadelta-task-orchestrator-routes.js';`
    );
    const injected = injectedImports.replace(
      /(test\(['"][^'"]+['"],\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{\s*\n)/,
      `$1  await page.goto(process.env.METADELTA_BASE_URL);\n  await runTaskOrchestrator(page);\n`
    );
    fs.writeFileSync(patchedPath, injected, 'utf8');
    return patchedPath;
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
