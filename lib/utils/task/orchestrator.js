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
    {
        pattern: 'Playwright codegen finalizó con errores',
        description: 'La sesión de grabación de Playwright terminó con error.',
        solution: 'Reejecuta con consola visible y prueba manualmente: "npx playwright codegen <url> --target playwright-test --output tests/<archivo>.ts". Si falla por binarios, ejecuta "node tests/.metadelta-playwright/node_modules/@playwright/test/cli.js install chromium".',
    },
    {
        pattern: 'El botón Finish permanece deshabilitado después de intentar seleccionar acciones con scroll|No se pudo seleccionar checkbox de Action Library automáticamente',
        description: 'La lista de Action Library tardó en cargar o no se pudo seleccionar una acción antes de Finish.',
        solution: 'Reejecuta con "--header" para confirmar el elemento objetivo y verifica que el modal "Add from Asset Library" termine de cargar (sin spinner). Si el botón Finish sigue deshabilitado, valida permisos/visibilidad de acciones en la org destino.',
    },
    {
        pattern: 'Search apps and items\.\.\.|App Launcher',
        description: 'El buscador del App Launcher no estuvo disponible a tiempo en el flujo automático.',
        solution: 'Reintenta la ejecución; el parcheador ya abre App Launcher y aplica fallback por placeholder. Si persiste, valida que la app objetivo sea visible para el usuario autenticado.',
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
            const existingPatterns = new Set(parsed.solutions.map((solution) => solution.pattern));
            for (const defaultSolution of DEFAULT_SOLUTIONS) {
                if (!existingPatterns.has(defaultSolution.pattern)) {
                    parsed.solutions.push({
                        ...defaultSolution,
                        addedAt: new Date().toISOString(),
                        lastUsedAt: null,
                    });
                }
            }
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
function getNpxCommandCandidates() {
    const candidates = [];
    if (process.env.NPX_BINPATH) {
        candidates.push(process.env.NPX_BINPATH);
    }
    candidates.push('npx');
    if (process.platform === 'win32') {
        candidates.push('npx.cmd');
    }
    return [...new Set(candidates.filter(Boolean))];
}
export function executeNpxCommand(args, options = {}) {
    const candidates = getNpxCommandCandidates();
    let lastResult = null;
    for (const command of candidates) {
        const result = spawnSync(command, args, {
            shell: process.platform === 'win32',
            ...options,
        });
        lastResult = result;
        if (!result.error) {
            return result;
        }
    }
    return lastResult ?? { status: 1, stdout: '', stderr: '', error: new Error('No se pudo ejecutar npx.') };
}
function getSfCommandCandidates() {
    const candidates = [];
    if (process.env.SF_BINPATH) {
        candidates.push(process.env.SF_BINPATH);
    }
    candidates.push('sf');
    if (process.platform === 'win32') {
        candidates.push('sf.cmd');
    }
    return [...new Set(candidates.filter(Boolean))];
}
function executeSfCommand(args) {
    const candidates = getSfCommandCandidates();
    let lastResult = null;
    for (const command of candidates) {
        const result = spawnSync(command, args, {
            encoding: 'utf8',
            shell: process.platform === 'win32',
        });
        lastResult = result;
        if (!result.error) {
            return result;
        }
    }
    return lastResult ?? { status: 1, stdout: '', stderr: '' };
}
function runSfJsonCommand(args) {
    const result = executeSfCommand([...args, '--json']);
    const commandError = result.error?.message ? String(result.error.message).trim() : '';
    const combinedOutput = commandError || result.stderr?.trim() || result.stdout?.trim();
    let parsed = null;
    if (result.stdout?.trim()) {
        try {
            parsed = JSON.parse(result.stdout);
        }
        catch (error) {
            parsed = null;
        }
    }
    return { result, parsed, combinedOutput };
}
function buildFallbackOrgLookupMessage(targetOrg) {
    return [
        `No se pudo consultar la org "${targetOrg}" en Salesforce CLI.`,
        'Verifica el alias con "sf org list --all".',
        `Prueba "sf org display --target-org ${targetOrg} --verbose" para ver el error detallado.`,
    ].join(' ');
}
export function buildFrontdoorUrlFromOrgDisplay(targetOrg) {
    const fallbackMessage = buildFallbackOrgLookupMessage(targetOrg);
    const displayVerbose = runSfJsonCommand(['org', 'display', '--target-org', targetOrg, '--verbose']);
    if (displayVerbose.result.status === 0) {
        const instanceUrl = displayVerbose.parsed?.result?.instanceUrl ?? '';
        const accessToken = displayVerbose.parsed?.result?.accessToken ?? '';
        if (instanceUrl && accessToken) {
            return `${instanceUrl}/secur/frontdoor.jsp?sid=${encodeURIComponent(accessToken)}`;
        }
    }
    const openUrlOnly = runSfJsonCommand(['org', 'open', '--target-org', targetOrg, '--url-only']);
    if (openUrlOnly.result.status === 0) {
        const frontdoorUrl = openUrlOnly.parsed?.result?.url ?? '';
        if (frontdoorUrl) {
            return frontdoorUrl;
        }
    }
    const displayStandard = runSfJsonCommand(['org', 'display', '--target-org', targetOrg]);
    if (displayStandard.result.status === 0) {
        const instanceUrl = displayStandard.parsed?.result?.instanceUrl ?? '';
        const accessToken = displayStandard.parsed?.result?.accessToken ?? '';
        if (instanceUrl && accessToken) {
            return `${instanceUrl}/secur/frontdoor.jsp?sid=${encodeURIComponent(accessToken)}`;
        }
    }
    const combinedError = [
        displayVerbose.combinedOutput,
        openUrlOnly.combinedOutput,
        displayStandard.combinedOutput,
    ]
        .filter(Boolean)
        .join('\n');
    throw new Error(extractSfErrorMessage(combinedError, fallbackMessage));
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
function extractBaseOriginFromFrontdoor(urlValue) {
    try {
        return new URL(urlValue).origin;
    }
    catch (error) {
        return urlValue;
    }
}
export function injectBaseUrlInTest({ filePath, baseUrl }) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.includes('METADELTA_BASE_URL')) {
        return;
    }
    const normalizedBaseUrl = extractBaseOriginFromFrontdoor(baseUrl);
    const baseUrlLiteral = JSON.stringify(normalizedBaseUrl);
    const baseUrlPlaceholder = '__METADELTA_BASE_URL_LITERAL__';
    const updated = raw
        .replace(/(import[^;]+;\n)/, `$1\nconst baseUrl = process.env.METADELTA_BASE_URL ?? ${baseUrlPlaceholder};\n`)
        .replaceAll(`'${baseUrl}'`, 'baseUrl')
        .replaceAll(`\"${baseUrl}\"`, 'baseUrl')
        .replaceAll(`'${normalizedBaseUrl}'`, 'baseUrl')
        .replaceAll(`\"${normalizedBaseUrl}\"`, 'baseUrl')
        .replace(baseUrlPlaceholder, baseUrlLiteral);
    fs.writeFileSync(filePath, updated, 'utf8');
}
export function ensurePlaywrightReady({ baseDir = process.cwd(), playwrightCliPath } = {}) {
    const runtime = playwrightCliPath
        ? { cliPath: playwrightCliPath, cacheDir: path.resolve(baseDir, 'tests', '.metadelta-playwright') }
        : ensurePlaywrightTestDependency(baseDir);
    if (hasPlaywrightBrowsers(runtime.cacheDir)) {
        return;
    }
    const installAttempts = [
        () => spawnSync(process.execPath, [runtime.cliPath, 'install', 'chromium'], {
            stdio: 'inherit',
            cwd: runtime.cacheDir,
            env: {
                ...process.env,
                NODE_PATH: path.join(runtime.cacheDir, 'node_modules'),
            },
        }),
        () => spawnSync(process.execPath, [runtime.cliPath, 'install'], {
            stdio: 'inherit',
            cwd: runtime.cacheDir,
            env: {
                ...process.env,
                NODE_PATH: path.join(runtime.cacheDir, 'node_modules'),
            },
        }),
    ];
    let lastErrorDetail = 'sin ejecutable de Chromium detectado';
    for (const attempt of installAttempts) {
        const result = attempt();
        if (result.status === 0 || hasPlaywrightBrowsers(runtime.cacheDir)) {
            return;
        }
        const rawDetail = result.error?.message || result.stderr?.trim() || result.stdout?.trim();
        lastErrorDetail = rawDetail ? String(rawDetail).slice(0, 240) : `código=${result.status ?? 'desconocido'}`;
    }
    if (!hasPlaywrightBrowsers(runtime.cacheDir)) {
        throw new Error(`No se pudieron instalar o validar los navegadores de Playwright automáticamente (${lastErrorDetail}). Ejecuta "npm install --prefix tests/.metadelta-playwright @playwright/test" y luego "node tests/.metadelta-playwright/node_modules/@playwright/test/cli.js install chromium".`);
    }
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
function hasPlaywrightBrowsers(cacheDir) {
    const customPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const pathsToCheck = [];
    if (customPath && customPath !== '0') {
        pathsToCheck.push(customPath);
    }
    if (cacheDir) {
        pathsToCheck.push(path.resolve(cacheDir, 'node_modules', 'playwright-core', '.local-browsers'));
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
            const chromiumDirs = entries.filter((entry) => entry.startsWith('chromium-'));
            for (const chromiumDir of chromiumDirs) {
                const base = path.join(browsersPath, chromiumDir);
                const executableCandidates = [
                    path.join(base, 'chrome-win', 'chrome.exe'),
                    path.join(base, 'chrome-win64', 'chrome.exe'),
                    path.join(base, 'chrome-linux', 'chrome'),
                    path.join(base, 'chrome-linux64', 'chrome'),
                    path.join(base, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
                    path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
                ];
                if (executableCandidates.some((candidate) => fs.existsSync(candidate))) {
                    return true;
                }
            }
        }
        catch {
            // noop
        }
    }
    return false;
}
