import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { addWatchTarget, buildMonitorRunArgs, ensureWatchdogConfig, getDefaultWatchdogConfigPath, listWatchTargets, removeWatchTarget, runWatchdogOnce, updateWatchTarget, } from './watchdog.js';
const PROCESS_STATE_PATH = path.join(os.homedir(), '.metadelta', 'monitor', 'control-processes.json');
const TMUX_SESSION = 'metadelta';
const CONTROL_EXIT = Symbol('CONTROL_EXIT');
const pendingKeys = [];
export async function runMonitorControl(options = {}) {
    const configPath = options.configPath || getDefaultWatchdogConfigPath();
    ensureWatchdogConfig(configPath);
    const ui = new ControlTerminal();
    const context = {
        configPath,
        interval: options.interval,
        webhookUrl: options.webhookUrl,
        command: options.command || 'sf',
        ui,
    };
    try {
        for (;;) {
            const actions = buildMainActions();
            const selected = await ui.navigate('Metadelta Monitor - Control', actions.map((action) => action.label), {
                hint: 'Up/Down navegar   Enter seleccionar   Ctrl+C salir',
            });
            if (selected === -1 || actions[selected]?.id === 'exit') {
                ui.clear();
                return;
            }
            await runAction(actions[selected].id, context);
        }
    }
    catch (error) {
        if (error === CONTROL_EXIT) {
            ui.clear();
            return;
        }
        throw error;
    }
    finally {
        ui.close();
    }
}
function buildMainActions() {
    const actions = [
        { id: 'watchdog-once', label: 'Ejecutar una pasada del watchdog' },
        { id: 'list', label: 'Listar monitores configurados' },
        { id: 'add', label: 'Agregar un monitor al watchdog' },
        { id: 'remove', label: 'Quitar un monitor del watchdog' },
        { id: 'scope', label: 'Agregar/modificar/eliminar scope XML/YAML' },
        { id: 'start-one', label: 'Iniciar un monitor' },
        { id: 'start-all-bg', label: 'Iniciar todos los monitores - Background' },
        { id: 'stop-bg', label: 'Detener monitores iniciados por Metadelta' },
    ];
    if (isTmuxAvailable()) {
        actions.splice(6, 0, { id: 'start-all-tmux', label: 'Iniciar todos los monitores - TUI tmux' });
    }
    actions.push({ id: 'automation-help', label: 'Ver ayuda de automatizacion' });
    actions.push({ id: 'exit', label: 'Salir' });
    return actions;
}
async function runAction(actionId, context) {
    switch (actionId) {
        case 'watchdog-once':
            await doWatchdogOnce(context);
            return;
        case 'list':
            await doListTargets(context);
            return;
        case 'add':
            await doAddTarget(context);
            return;
        case 'remove':
            await doRemoveTarget(context);
            return;
        case 'scope':
            await doConfigureScope(context);
            return;
        case 'start-one':
            await doStartOne(context);
            return;
        case 'start-all-bg':
            await doStartAllBackground(context);
            return;
        case 'start-all-tmux':
            await doStartAllTmux(context);
            return;
        case 'stop-bg':
            await doStopBackground(context);
            return;
        case 'automation-help':
            await doAutomationHelp(context);
            return;
        default:
            return;
    }
}
async function doWatchdogOnce({ configPath, webhookUrl, ui }) {
    ui.clear();
    try {
        const result = await runWatchdogOnce(configPath, { webhookUrl });
        ui.writeLine(`Watchdog completado: ${result.alerts} alerta(s), ${result.errors} error(es).`);
        ui.writeLine(`State file: ${result.stateFile}`);
    }
    catch (error) {
        ui.writeLine(`Error ejecutando watchdog: ${error.message}`);
    }
    await ui.pause();
}
async function doListTargets({ configPath, ui }) {
    const targets = listWatchTargets(configPath);
    ui.clear();
    ui.writeLine('Monitores configurados:');
    ui.writeLine('');
    if (targets.length === 0) {
        ui.writeLine('No hay monitores configurados.');
    }
    else {
        for (const target of targets) {
            ui.writeLine(`- ${target.org}`);
            ui.writeLine(`  log: ${target.logPath}`);
            ui.writeLine(`  interval: ${target.interval || 'default'}`);
            ui.writeLine(`  scopeXml: ${target.scopeXml || '-'}`);
            ui.writeLine(`  scopeYaml: ${target.scopeYaml || '-'}`);
            ui.writeLine(`  exportCsv: ${target.exportCsv || '-'}`);
            ui.writeLine('');
        }
    }
    await ui.pause();
}
async function doAddTarget({ configPath, interval, ui }) {
    ui.clear();
    const org = await ui.prompt('Alias sf-cli del ambiente');
    if (!org) {
        return;
    }
    const result = addWatchTarget(configPath, org, { interval });
    ui.writeLine(result.status === 'exists' ? `'${org}' ya existe.` : `'${org}' agregado.`);
    ui.writeLine(`Log: ${result.target.logPath}`);
    await ui.pause();
}
async function doRemoveTarget({ configPath, ui }) {
    const target = await chooseTarget(configPath, ui, 'Quitar un monitor del watchdog');
    if (!target) {
        return;
    }
    const result = removeWatchTarget(configPath, target.org);
    ui.clear();
    ui.writeLine(result.removed > 0 ? `'${target.org}' quitado.` : `No se quito '${target.org}'.`);
    await ui.pause();
}
async function doConfigureScope({ configPath, ui }) {
    const target = await chooseTarget(configPath, ui, 'Configurar scope XML/YAML');
    if (!target) {
        return;
    }
    for (;;) {
        const selected = await ui.navigate(`Scope - ${target.org}`, [
            `XML actual: ${target.scopeXml || '-'}`,
            `YAML actual: ${target.scopeYaml || '-'}`,
            'Agregar/modificar XML',
            'Agregar/modificar YAML',
            'Eliminar XML',
            'Eliminar YAML',
            'Volver',
        ], { hint: 'Up/Down navegar   Enter seleccionar   Ctrl+C volver' });
        if (selected === -1 || selected === 6) {
            return;
        }
        if (selected === 2) {
            const nextXml = await promptManifestPath(ui, 'Ruta archivo XML', '.xml');
            if (nextXml !== undefined) {
                target.scopeXml = nextXml;
                updateWatchTarget(configPath, target.org, { scopeXml: nextXml });
            }
        }
        if (selected === 3) {
            const nextYaml = await promptManifestPath(ui, 'Ruta archivo YAML', ['.yaml', '.yml']);
            if (nextYaml !== undefined) {
                target.scopeYaml = nextYaml;
                updateWatchTarget(configPath, target.org, { scopeYaml: nextYaml });
            }
        }
        if (selected === 4) {
            delete target.scopeXml;
            updateWatchTarget(configPath, target.org, { scopeXml: undefined });
        }
        if (selected === 5) {
            delete target.scopeYaml;
            updateWatchTarget(configPath, target.org, { scopeYaml: undefined });
        }
    }
}
async function doStartOne(context) {
    const target = await chooseTarget(context.configPath, context.ui, 'Iniciar un monitor');
    if (!target) {
        return;
    }
    startBackgroundMonitor(target, context);
    context.ui.clear();
    context.ui.writeLine(`Monitor ${target.org} iniciado en background.`);
    await context.ui.pause();
}
async function doStartAllBackground(context) {
    const targets = listWatchTargets(context.configPath);
    context.ui.clear();
    if (targets.length === 0) {
        context.ui.writeLine('No hay monitores configurados.');
        await context.ui.pause();
        return;
    }
    for (const target of targets) {
        startBackgroundMonitor(target, context);
        context.ui.writeLine(`Monitor ${target.org} iniciado en background.`);
    }
    await context.ui.pause();
}
async function doStartAllTmux(context) {
    const targets = listWatchTargets(context.configPath);
    context.ui.clear();
    if (targets.length === 0) {
        context.ui.writeLine('No hay monitores configurados.');
        await context.ui.pause();
        return;
    }
    if (!isTmuxAvailable()) {
        context.ui.writeLine('tmux no esta disponible en este ambiente.');
        await context.ui.pause();
        return;
    }
    spawnSync('tmux', ['kill-session', '-t', TMUX_SESSION], { stdio: 'ignore' });
    targets.forEach((target, index) => {
        const command = shellJoin([context.command, ...buildMonitorRunArgs(target, { interval: context.interval })]);
        const windowName = windowNameForOrg(target.org);
        if (index === 0) {
            spawnSync('tmux', ['new-session', '-d', '-s', TMUX_SESSION, '-n', windowName, command], { stdio: 'ignore' });
        }
        else {
            spawnSync('tmux', ['new-window', '-t', TMUX_SESSION, '-n', windowName, command], { stdio: 'ignore' });
        }
    });
    setupTmuxStyle();
    context.ui.showCursor();
    spawnSync('tmux', ['attach', '-t', TMUX_SESSION], { stdio: 'inherit' });
}
async function doStopBackground({ ui }) {
    const state = loadProcessState();
    ui.clear();
    if (state.processes.length === 0) {
        ui.writeLine('No hay procesos registrados por Metadelta.');
        await ui.pause();
        return;
    }
    const remaining = [];
    for (const processInfo of state.processes) {
        try {
            process.kill(processInfo.pid);
            ui.writeLine(`Detenido ${processInfo.org} (PID ${processInfo.pid}).`);
        }
        catch {
            remaining.push(processInfo);
        }
    }
    saveProcessState({ processes: remaining });
    await ui.pause();
}
async function doAutomationHelp({ ui }) {
    ui.clear();
    if (process.platform === 'win32') {
        ui.writeLine('Windows: usa Task Scheduler para ejecutar periodicamente:');
        ui.writeLine('sf metadelta monitor run --watchdog-once --watchdog-config <ruta>');
    }
    else {
        ui.writeLine('Linux/WSL/macOS: puedes programar cron con:');
        ui.writeLine('*/5 * * * * sf metadelta monitor run --watchdog-once --watchdog-config <ruta>');
        ui.writeLine('');
        ui.writeLine('Si tmux esta instalado, el menu puede abrir todos los monitores en una sesion TUI.');
    }
    await ui.pause();
}
async function chooseTarget(configPath, ui, title) {
    const targets = listWatchTargets(configPath);
    if (targets.length === 0) {
        ui.clear();
        ui.writeLine('No hay monitores configurados.');
        await ui.pause();
        return null;
    }
    const selected = await ui.navigate(title, targets.map((target) => target.org), {
        hint: 'Up/Down navegar   Enter seleccionar   Ctrl+C cancelar',
    });
    return selected === -1 ? null : targets[selected];
}
async function promptManifestPath(ui, label, extensions) {
    ui.clear();
    const input = await ui.prompt(`${label} (vacio para cancelar)`);
    if (!input) {
        return undefined;
    }
    const resolved = path.resolve(input.replace(/^~(?=$|[\\/])/, os.homedir()));
    const allowed = Array.isArray(extensions) ? extensions : [extensions];
    if (!allowed.some((extension) => resolved.toLowerCase().endsWith(extension))) {
        ui.writeLine(`La ruta debe terminar en ${allowed.join(' o ')}.`);
        await ui.pause();
        return undefined;
    }
    if (!fs.existsSync(resolved)) {
        ui.writeLine(`No se encontro el archivo: ${resolved}`);
        await ui.pause();
        return undefined;
    }
    return resolved;
}
function startBackgroundMonitor(target, context) {
    const args = buildMonitorRunArgs(target, { interval: context.interval });
    const logPath = path.join(os.homedir(), '.metadelta', `monitor-${target.org}.log`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logFd = fs.openSync(logPath, 'a');
    const child = spawn(context.command, args, {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        shell: process.platform === 'win32',
    });
    child.unref();
    const state = loadProcessState();
    state.processes = state.processes.filter((processInfo) => processInfo.org !== target.org);
    state.processes.push({ org: target.org, pid: child.pid, startedAt: new Date().toISOString(), logPath });
    saveProcessState(state);
}
function isTmuxAvailable() {
    if (process.platform === 'win32') {
        return false;
    }
    return spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0;
}
function setupTmuxStyle() {
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status', 'on'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-position', 'top'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-style', 'bg=colour235,fg=colour250'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-left', '#[fg=colour240]  <- ->  |  '], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-right', '  |  Ctrl+B d salir  '], { stdio: 'ignore' });
    spawnSync('tmux', ['setw', '-g', 'allow-rename', 'off'], { stdio: 'ignore' });
    spawnSync('tmux', ['setw', '-g', 'automatic-rename', 'off'], { stdio: 'ignore' });
    spawnSync('tmux', ['bind-key', '-n', 'Right', 'next-window'], { stdio: 'ignore' });
    spawnSync('tmux', ['bind-key', '-n', 'Left', 'previous-window'], { stdio: 'ignore' });
}
function windowNameForOrg(org) {
    return String(org).split('-').pop().toUpperCase();
}
function shellJoin(parts) {
    return parts.map((part) => {
        const text = String(part);
        if (/^[a-zA-Z0-9_./:=@-]+$/.test(text)) {
            return text;
        }
        return `'${text.replace(/'/g, "'\\''")}'`;
    }).join(' ');
}
function loadProcessState() {
    try {
        const parsed = JSON.parse(fs.readFileSync(PROCESS_STATE_PATH, 'utf8'));
        return { processes: Array.isArray(parsed.processes) ? parsed.processes : [] };
    }
    catch {
        return { processes: [] };
    }
}
function saveProcessState(state) {
    fs.mkdirSync(path.dirname(PROCESS_STATE_PATH), { recursive: true });
    fs.writeFileSync(PROCESS_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}
class ControlTerminal {
    close() {
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        this.showCursor();
    }
    clear() {
        process.stdout.write('\x1b[2J\x1b[H');
    }
    hideCursor() {
        process.stdout.write('\x1b[?25l');
    }
    showCursor() {
        process.stdout.write('\x1b[?25h');
    }
    writeLine(text = '') {
        process.stdout.write(`  ${text}\n`);
    }
    async navigate(title, items, options = {}) {
        if (!process.stdin.isTTY) {
            throw new Error('El menu de control requiere una terminal interactiva.');
        }
        let selected = 0;
        this.hideCursor();
        process.stdin.setRawMode(true);
        process.stdin.resume();
        try {
            for (;;) {
                this.drawBox(title, items, selected, options.hint);
                const key = await readKey();
                if (key === '\u0003') {
                    return -1;
                }
                if (key === '\r' || key === '\n') {
                    return selected;
                }
                if (key === '\x1B[A') {
                    selected = selected === 0 ? items.length - 1 : selected - 1;
                }
                if (key === '\x1B[B') {
                    selected = selected === items.length - 1 ? 0 : selected + 1;
                }
            }
        }
        finally {
            process.stdin.setRawMode(false);
            this.showCursor();
        }
    }
    drawBox(title, items, selected, hint) {
        this.clear();
        const width = Math.max(50, ...items.map((item) => visibleLength(item) + 6), visibleLength(title) + 4);
        process.stdout.write(`\n  ${'='.repeat(width)}\n`);
        process.stdout.write(`  ${padRight(` ${title}`, width)}\n`);
        process.stdout.write(`  ${'='.repeat(width)}\n\n`);
        items.forEach((item, index) => {
            process.stdout.write(`  ${index === selected ? '>' : ' '}  ${item}\n`);
        });
        process.stdout.write(`\n  ${hint || 'Up/Down navegar   Enter seleccionar'}\n`);
    }
    async prompt(label) {
        this.showCursor();
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        process.stdout.write(`  ${label}: `);
        return new Promise((resolve) => {
            let buffer = '';
            const drainPendingKeys = () => {
                while (pendingKeys.length > 0) {
                    const key = pendingKeys.shift();
                    if (key === '\u0003') {
                        return CONTROL_EXIT;
                    }
                    if (key === '\n' || key === '\r') {
                        return buffer.trim();
                    }
                    buffer += key;
                }
                return undefined;
            };
            const pendingValue = drainPendingKeys();
            if (pendingValue !== undefined) {
                resolve(pendingValue);
                return;
            }
            const onData = (chunk) => {
                const text = chunk.toString();
                if (text.includes('\u0003')) {
                    process.stdin.off('data', onData);
                    resolve(CONTROL_EXIT);
                    return;
                }
                const newlineIndex = findNewlineIndex(text);
                if (newlineIndex !== -1) {
                    buffer += text.slice(0, newlineIndex);
                    process.stdin.off('data', onData);
                    resolve(buffer.trim());
                    return;
                }
                buffer += text;
            };
            process.stdin.on('data', onData);
            process.stdin.resume();
        }).then((value) => {
            if (value === CONTROL_EXIT) {
                throw CONTROL_EXIT;
            }
            return value;
        });
    }
    async pause() {
        process.stdout.write('\n  Presiona cualquier tecla para continuar...');
        if (!process.stdin.isTTY) {
            process.stdout.write('\n');
            return;
        }
        process.stdin.setRawMode(true);
        process.stdin.resume();
        const key = await readKey();
        process.stdin.setRawMode(false);
        if (key === '\u0003') {
            throw CONTROL_EXIT;
        }
    }
}
function readKey() {
    if (pendingKeys.length > 0) {
        return Promise.resolve(pendingKeys.shift());
    }
    return new Promise((resolve) => {
        const onData = (chunk) => {
            process.stdin.off('data', onData);
            const keys = splitKeyChunk(chunk.toString());
            pendingKeys.push(...keys.slice(1));
            const key = keys[0] ?? '';
            resolve(key);
        };
        process.stdin.on('data', onData);
    });
}
function visibleLength(text) {
    return String(text).length;
}
function padRight(text, width) {
    return `${text}${' '.repeat(Math.max(0, width - visibleLength(text)))}`;
}
function findNewlineIndex(text) {
    const lineFeed = text.indexOf('\n');
    const carriageReturn = text.indexOf('\r');
    if (lineFeed === -1) {
        return carriageReturn;
    }
    if (carriageReturn === -1) {
        return lineFeed;
    }
    return Math.min(lineFeed, carriageReturn);
}
function splitKeyChunk(text) {
    const keys = [];
    for (let index = 0; index < text.length;) {
        if (text.startsWith('\x1B[A', index) || text.startsWith('\x1B[B', index)) {
            keys.push(text.slice(index, index + 3));
            index += 3;
            continue;
        }
        keys.push(text[index]);
        index += 1;
    }
    return keys;
}
