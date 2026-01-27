import { Command, Flags } from '@oclif/core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TaskOrchestrator, ensureTestsDirectory, ensurePlaywrightReady, ensurePlaywrightTestDependency, resolveTestFilePath, } from '../../../utils/task/orchestrator.js';
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
        const { flags } = await this.parse(TaskPlay);
        const orchestrator = new TaskOrchestrator({ commandName: 'metadelta task play' });
        const targetOrg = flags.org;
        const testFile = resolveTestFilePath({ name: flags.tstname });
        try {
            ensureTestsDirectory();
            if (!testFile || !fs.existsSync(testFile)) {
                this.error(`No se encontró el archivo de prueba: ${flags.tstname}`);
            }
            ensurePlaywrightReady();
            ensurePlaywrightTestDependency();
            const url = this.fetchOrgUrl(targetOrg);
            const configPath = this.createPlaywrightConfig(testFile);
            const args = ['--yes', 'playwright', 'test', '--config', configPath, '--reporter', 'line'];
            if (flags.header) {
                args.push('--headed');
            }
            this.log(`Ejecutando prueba en ${targetOrg} con archivo ${testFile}`);
            const result = spawnSync('npx', args, {
                stdio: 'inherit',
                env: { ...process.env, METADELTA_BASE_URL: url },
            });
            if (result.status !== 0) {
                this.error('La ejecución de Playwright finalizó con errores.');
            }
            fs.rmSync(configPath, { force: true });
        }
        catch (error) {
            orchestrator.recordError({
                message: error.message,
                stack: error.stack,
                context: { org: targetOrg, testFile: flags.tstname },
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
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, contents, 'utf8');
        return configPath;
    }
    fetchOrgUrl(targetOrg) {
        const result = spawnSync('sf', ['org', 'open', '--url-only', '--target-org', targetOrg, '--json'], { encoding: 'utf8' });
        if (result.status !== 0) {
            const message = result.stderr?.trim() || result.stdout?.trim() || 'Error al obtener URL de la org.';
            throw new Error(message);
        }
        let url = '';
        try {
            const parsed = JSON.parse(result.stdout);
            url = parsed?.result?.url ?? '';
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
export default TaskPlay;
