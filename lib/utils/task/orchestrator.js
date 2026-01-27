import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const DEFAULT_ORCHESTRATOR_FILENAME = 'metadelta-task-orchestrator.json';
const DEFAULT_SOLUTIONS = [
    {
        pattern: 'No authorization information found',
        description: 'No se encontró autenticación válida para el alias solicitado.',
        solution: 'Ejecuta "sf org login web -a <alias>" o "sf org login web --set-default -a <alias>" antes de grabar/reproducir.',
    },
    {
        pattern: 'browserType\\.launch: Executable doesn\\\'t exist',
        description: 'Playwright no tiene instalados los navegadores.',
        solution: 'Ejecuta "npx playwright install --with-deps" para descargar los binarios.',
    },
    {
        pattern: 'Target page, context or browser has been closed',
        description: 'El navegador se cerró antes de completar el flujo.',
        solution: 'Reintenta la ejecución y valida que el login o MFA no cierre la ventana; usa --header para inspeccionar.',
    },
    {
        pattern: 'net::ERR_NAME_NOT_RESOLVED',
        description: 'No se pudo resolver el host de la org.',
        solution: 'Valida la conectividad de red y que el alias resuelva a un org válido.',
    },
];
export class TaskOrchestrator {
    constructor({ baseDir = process.cwd(), commandName }) {
        this.commandName = commandName;
        this.filePath = path.resolve(baseDir, 'tests', DEFAULT_ORCHESTRATOR_FILENAME);
        this.data = this.loadOrInitialize();
    }
    loadOrInitialize() {
        const initialData = {
            solutions: DEFAULT_SOLUTIONS.map((solution) => ({
                ...solution,
                addedAt: new Date().toISOString(),
                lastUsedAt: null,
            })),
            errors: [],
        };
        if (!fs.existsSync(this.filePath)) {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(initialData, null, 2));
            return initialData;
        }
        try {
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            parsed.solutions ??= [];
            parsed.errors ??= [];
            return parsed;
        }
        catch (error) {
            fs.writeFileSync(this.filePath, JSON.stringify(initialData, null, 2));
            return initialData;
        }
    }
    save() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    }
    findSolution(message) {
        const solutions = this.data.solutions ?? [];
        for (const solution of solutions) {
            if (!solution.pattern) {
                continue;
            }
            const regex = new RegExp(solution.pattern, 'i');
            if (regex.test(message)) {
                solution.lastUsedAt = new Date().toISOString();
                this.save();
                return solution;
            }
        }
        return null;
    }
    recordError({ message, stack, context }) {
        const entry = {
            command: this.commandName,
            message,
            stack,
            context,
            occurredAt: new Date().toISOString(),
        };
        this.data.errors.push(entry);
        this.save();
    }
}
export function ensureTestsDirectory(baseDir = process.cwd()) {
    const testsDir = path.resolve(baseDir, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    return testsDir;
}
export function formatTimestampForFilename(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${day}${month}${year}-${hours}-${minutes}`;
}
export function sanitizeAlias(alias) {
    return alias.replace(/[^a-zA-Z0-9-_]/g, '_');
}
export function resolveTestFilePath({ baseDir = process.cwd(), name }) {
    if (!name) {
        return null;
    }
    const hasPath = name.includes(path.sep) || name.startsWith('.');
    const target = hasPath ? name : path.join('tests', name);
    return path.resolve(baseDir, target);
}
export function injectBaseUrlInTest({ filePath, baseUrl }) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.includes('METADELTA_BASE_URL')) {
        return;
    }
    const baseUrlLine = `const baseUrl = process.env.METADELTA_BASE_URL ?? '${baseUrl}';\n`;
    const updated = raw
        .replace(/(import[^;]+;\n)/, `$1\n${baseUrlLine}`)
        .replaceAll(`'${baseUrl}'`, 'baseUrl')
        .replaceAll(`"${baseUrl}"`, 'baseUrl');
    fs.writeFileSync(filePath, updated, 'utf8');
}
export function ensurePlaywrightReady() {
    const installResult = spawnPlaywright(['install', '--with-deps']);
    if (installResult.status !== 0) {
        const fallbackResult = spawnPlaywright(['install']);
        if (fallbackResult.status !== 0) {
            throw new Error('No se pudieron instalar los navegadores de Playwright automáticamente.');
        }
    }
}
function spawnPlaywright(args) {
    return spawnSync('npx', ['--yes', 'playwright', ...args], { stdio: 'inherit' });
}
