import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const DEFAULT_ORCHESTRATOR_FILENAME = 'metadelta-task-orchestrator.json';
const DEFAULT_METADELTA_DIRNAME = '.metadelta';
const DEFAULT_SOLUTIONS = [
    {
        pattern: 'No authorization information found',
        description: 'No se encontró autenticación válida para el alias solicitado.',
        solution: 'Ejecuta "sf org login web -a <alias>" o "sf org login web --set-default -a <alias>" antes de grabar/reproducir.',
    },
    {
        pattern: 'Error al obtener URL de la org|No se pudo consultar la org|No pudo encontrar ninguna org|No authorized orgs',
        description: 'No fue posible obtener la URL de login de la org con el alias indicado.',
        solution: 'Ejecuta "sf org display --target-org <alias> --verbose" para validar sesión activa y, si falla, vuelve a autenticar con "sf org login web -a <alias>".',
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
function resolveOrchestratorFilePath(baseDir) {
    const primaryPath = path.resolve(baseDir, DEFAULT_METADELTA_DIRNAME, DEFAULT_ORCHESTRATOR_FILENAME);
    const legacyPath = path.resolve(baseDir, 'tests', DEFAULT_ORCHESTRATOR_FILENAME);
    if (!fs.existsSync(primaryPath) && fs.existsSync(legacyPath)) {
        fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
        fs.copyFileSync(legacyPath, primaryPath);
        return primaryPath;
    }
    return primaryPath;
}
export class TaskOrchestrator {
    constructor({ baseDir = process.cwd(), commandName }) {
        this.commandName = commandName;
        this.filePath = resolveOrchestratorFilePath(baseDir);
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
export function getMetaDeltaDataDirectory(baseDir = process.cwd()) {
    const dataDir = path.resolve(baseDir, DEFAULT_METADELTA_DIRNAME);
    fs.mkdirSync(dataDir, { recursive: true });
    return dataDir;
}
export function extractSfErrorMessage(output, fallback = 'Error al ejecutar comando de Salesforce CLI.') {
    const normalized = String(output ?? '').trim();
    if (!normalized) {
        return fallback;
    }
    try {
        const parsed = JSON.parse(normalized);
        const message = parsed?.message || parsed?.result?.message || parsed?.name;
        if (message) {
            return String(message).trim();
        }
    }
    catch (error) {
        // El output no es JSON; retornamos el texto tal cual.
    }
    return normalized;
}
export function buildFrontdoorUrlFromOrgDisplay(targetOrg) {
    const result = spawnSync('sf', ['org', 'display', '--target-org', targetOrg, '--json'], { encoding: 'utf8' });
    const combinedOutput = result.stderr?.trim() || result.stdout?.trim();
    if (result.status !== 0) {
        const fallback = [
            `No se pudo consultar la org "${targetOrg}" en Salesforce CLI.`,
            'Verifica el alias con "sf org list --all".',
            `Prueba "sf org display --target-org ${targetOrg} --verbose" para ver el error detallado.`,
        ].join(' ');
        const message = extractSfErrorMessage(combinedOutput, fallback);
        throw new Error(message);
    }
    let parsed;
    try {
        parsed = JSON.parse(result.stdout || '{}');
    }
    catch (error) {
        throw new Error(`Salesforce CLI devolvió una respuesta inválida para la org "${targetOrg}".`);
    }
    const instanceUrl = parsed?.result?.instanceUrl ?? '';
    const accessToken = parsed?.result?.accessToken ?? '';
    if (!instanceUrl || !accessToken) {
        throw new Error(`No se pudo resolver la URL de frontdoor para la org "${targetOrg}". Ejecuta "sf org display --target-org ${targetOrg} --verbose" y valida la autenticación.`);
    }
    return `${instanceUrl}/secur/frontdoor.jsp?sid=${encodeURIComponent(accessToken)}`;
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
    if (hasPlaywrightBrowsers()) {
        return;
    }
    const installAttempts = [
        () => spawnPlaywright(['install', 'chromium']),
        () => spawnSync('npx', ['--yes', '@playwright/test', 'install', 'chromium'], { stdio: 'inherit' }),
    ];
    for (const attempt of installAttempts) {
        const result = attempt();
        if (result.status === 0 && hasPlaywrightBrowsers()) {
            return;
        }
    }
    if (!hasPlaywrightBrowsers()) {
        throw new Error('No se pudieron instalar los navegadores de Playwright automáticamente. Ejecuta "npx @playwright/test install chromium" y reintenta.');
    }
}
function spawnPlaywright(args) {
    return spawnSync('npx', ['--yes', 'playwright', ...args], { stdio: 'inherit' });
}
export function ensurePlaywrightTestDependency(baseDir = process.cwd()) {
    const cacheDir = path.resolve(baseDir, 'tests', '.metadelta-playwright');
    const cliPath = path.resolve(cacheDir, 'node_modules', '@playwright', 'test', 'cli.js');
    if (fs.existsSync(cliPath)) {
        ensureTestModuleSymlink(baseDir, cacheDir);
        return { cacheDir, cliPath };
    }
    fs.mkdirSync(cacheDir, { recursive: true });
    const result = spawnSync('npm', ['install', '--no-fund', '--no-audit', '--prefix', cacheDir, '@playwright/test'], { stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error('No se pudo instalar @playwright/test automáticamente.');
    }
    if (!fs.existsSync(cliPath)) {
        throw new Error('No se encontró el CLI de @playwright/test después de la instalación.');
    }
    ensureTestModuleSymlink(baseDir, cacheDir);
    return { cacheDir, cliPath };
}
function ensureTestModuleSymlink(baseDir, cacheDir) {
    const target = path.resolve(cacheDir, 'node_modules', '@playwright', 'test');
    const linkRoot = path.resolve(baseDir, 'tests', 'node_modules', '@playwright');
    const linkPath = path.join(linkRoot, 'test');
    if (fs.existsSync(linkPath)) {
        return;
    }
    fs.mkdirSync(linkRoot, { recursive: true });
    fs.symlinkSync(target, linkPath, 'junction');
}
function hasPlaywrightBrowsers() {
    const customPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const pathsToCheck = [];
    if (customPath && customPath !== '0') {
        pathsToCheck.push(customPath);
    }
    pathsToCheck.push(path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'));
    if (process.env.LOCALAPPDATA) {
        pathsToCheck.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright'));
    }
    for (const browsersPath of pathsToCheck) {
        if (!browsersPath || !fs.existsSync(browsersPath)) {
            continue;
        }
        try {
            const entries = fs.readdirSync(browsersPath);
            if (entries.length > 0) {
                return true;
            }
        }
        catch {
            // noop
        }
    }
    return false;
}
