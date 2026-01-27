import { Command, Flags } from '@oclif/core';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { TaskOrchestrator, ensureTestsDirectory, ensurePlaywrightReady, formatTimestampForFilename, injectBaseUrlInTest, sanitizeAlias, } from '../../../utils/task/orchestrator.js';
class TaskRecord extends Command {
    static summary = 'Graba un procedimiento manual en Salesforce usando Playwright.';
    static flags = {
        org: Flags.string({
            char: 'o',
            summary: 'Alias de sf-cli para la org en la que se grabará la tarea.',
            required: true,
        }),
    };
    async run() {
        const { flags } = await this.parse(TaskRecord);
        const orchestrator = new TaskOrchestrator({ commandName: 'metadelta task record' });
        const targetOrg = flags.org;
        try {
            ensurePlaywrightReady();
            const url = this.fetchOrgFrontdoorUrl(targetOrg);
            const testsDir = ensureTestsDirectory();
            const safeAlias = sanitizeAlias(targetOrg);
            const timestamp = formatTimestampForFilename();
            const filename = `${safeAlias}-${timestamp}.ts`;
            const outputPath = path.resolve(testsDir, filename);
            this.log(`Iniciando grabación en ${targetOrg}. Archivo: ${outputPath}`);
            const result = spawnSync('npx', ['--yes', 'playwright', 'codegen', url, '--target', 'playwright-test', '--output', outputPath], { stdio: 'inherit' });
            if (result.status !== 0) {
                this.error('Playwright codegen finalizó con errores.');
            }
            if (!fs.existsSync(outputPath)) {
                this.error('No se generó el archivo de prueba. Verifica Playwright y la configuración de la org.');
            }
            injectBaseUrlInTest({ filePath: outputPath, baseUrl: url });
            this.log(`Grabación completada. Archivo generado en ${outputPath}`);
        }
        catch (error) {
            orchestrator.recordError({
                message: error.message,
                stack: error.stack,
                context: { org: targetOrg },
            });
            const solution = orchestrator.findSolution(error.message);
            if (solution) {
                this.error(`${error.message}\nSugerencia: ${solution.solution}`);
            }
            this.error(error.message);
        }
    }
    fetchOrgFrontdoorUrl(targetOrg) {
        const result = spawnSync('sf', ['org', 'display', '--target-org', targetOrg, '--json'], { encoding: 'utf8' });
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
        }
        catch (error) {
            url = result.stdout.trim();
        }
        if (!url) {
            throw new Error('No se pudo resolver la URL de la org.');
        }
        return url;
    }
}
export default TaskRecord;
