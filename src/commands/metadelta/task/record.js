import {Command, Flags} from '@oclif/core';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {
  TaskOrchestrator,
  ensureTestsDirectory,
  ensurePlaywrightReady,
  buildFrontdoorUrlFromOrgDisplay,
  formatTimestampForFilename,
  injectBaseUrlInTest,
  sanitizeAlias,
} from '../../../utils/task/orchestrator.js';

class TaskRecord extends Command {
  static summary = 'Graba un procedimiento manual en Salesforce usando Playwright.';

  static flags = {
    org: Flags.string({
      char: 'o',
      summary: 'Alias de sf-cli para la org en la que se grabará la tarea.',
      required: false,
    }),
    'target-org': Flags.string({
      summary: 'Alias alternativo compatible con la convención de Salesforce CLI.',
      required: false,
    }),
  };

  async run() {
    const {flags} = await this.parse(TaskRecord);
    const orchestrator = new TaskOrchestrator({commandName: 'metadelta task record'});
    if (flags['target-org'] && flags.org && flags['target-org'] !== flags.org) {
      this.error('Los valores de --org y --target-org no pueden diferir.');
    }

    const targetOrg = flags.org || flags['target-org'];
    if (!targetOrg) {
      this.error('Debes indicar la org con --org o --target-org.');
    }

    try {
      ensurePlaywrightReady();
      const url = buildFrontdoorUrlFromOrgDisplay(targetOrg);
      const testsDir = ensureTestsDirectory();
      const safeAlias = sanitizeAlias(targetOrg);
      const timestamp = formatTimestampForFilename();
      const filename = `${safeAlias}-${timestamp}.ts`;
      const outputPath = path.resolve(testsDir, filename);

      this.log(`Iniciando grabación en ${targetOrg}. Archivo: ${outputPath}`);

      const result = spawnSync(
        'npx',
        ['--yes', 'playwright', 'codegen', url, '--target', 'playwright-test', '--output', outputPath],
        {stdio: 'inherit'}
      );

      if (result.status !== 0) {
        const details = [
          result.error?.message ? `Detalle: ${result.error.message}` : null,
          typeof result.status === 'number' ? `Código de salida: ${result.status}` : null,
          result.signal ? `Señal: ${result.signal}` : null,
          'Revisa el output mostrado por Playwright arriba para identificar el paso exacto del fallo.',
        ]
          .filter(Boolean)
          .join(' | ');
        this.error(`Playwright codegen finalizó con errores. ${details}`);
      }

      if (!fs.existsSync(outputPath)) {
        this.error('No se generó el archivo de prueba. Verifica Playwright y la configuración de la org.');
      }

      injectBaseUrlInTest({filePath: outputPath, baseUrl: url});
      this.log(`Grabación completada. Archivo generado en ${outputPath}`);
    } catch (error) {
      orchestrator.recordError({
        message: error.message,
        stack: error.stack,
        context: {org: targetOrg},
      });
      const solution = orchestrator.findSolution(error.message);
      if (solution) {
        this.error(`${error.message}\nSugerencia: ${solution.solution}`);
      }
      this.error(error.message);
    }
  }

}

export default TaskRecord;
