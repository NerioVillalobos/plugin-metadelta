import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { addWatchTarget, buildMonitorRunArgs, ensureWatchdogConfig, getDefaultWatchdogConfigPath, listWatchTargets, removeWatchTarget, runWatchdogOnce, updateControlLanguage, updateWatchTarget, } from './watchdog.js';
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
            context.language = ensureWatchdogConfig(configPath).controlLanguage || 'es';
            context.t = getText(context.language);
            ui.pauseText = context.t.pauseText;
            const actions = buildMainActions(context);
            const selected = await ui.navigate(context.t.title, actions.map((action) => action.label), {
                hint: context.t.mainHint,
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
function buildMainActions(context) {
    const { t } = context;
    const actions = [
        { id: 'watchdog-once', label: t.watchdogOnce },
        { id: 'list', label: t.list },
        { id: 'add', label: t.add },
        { id: 'remove', label: t.remove },
        { id: 'scope', label: t.scope },
        { id: 'interval', label: t.interval },
        { id: 'language', label: t.language },
        { id: 'start-one', label: t.startOne },
        { id: 'start-all-bg', label: t.startAllBg },
        { id: 'stop-bg', label: t.stopBg },
    ];
    if (isTmuxAvailable()) {
        actions.splice(8, 0, { id: 'start-all-tmux', label: t.startAllTmux });
    }
    if (isWindowsTerminalAvailable()) {
        actions.splice(8, 0, { id: 'start-all-wt', label: t.startAllWindowsTerminal });
    }
    actions.push({ id: 'automation-help', label: t.automationHelp });
    actions.push({ id: 'exit', label: t.exit });
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
        case 'interval':
            await doChangeInterval(context);
            return;
        case 'language':
            await doChangeLanguage(context);
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
        case 'start-all-wt':
            await doStartAllWindowsTerminal(context);
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
async function doWatchdogOnce({ configPath, webhookUrl, ui, t }) {
    ui.clear();
    try {
        const result = await runWatchdogOnce(configPath, { webhookUrl });
        ui.writeLine(t.watchdogDone(result.alerts, result.errors));
        ui.writeLine(`State file: ${result.stateFile}`);
    }
    catch (error) {
        ui.writeLine(t.watchdogError(error.message));
    }
    await ui.pause();
}
async function doListTargets({ configPath, ui, t }) {
    const targets = listWatchTargets(configPath);
    ui.clear();
    ui.writeLine(t.configuredMonitors);
    ui.writeLine('');
    if (targets.length === 0) {
        ui.writeLine(t.noMonitors);
    }
    else {
        for (const target of targets) {
            ui.writeLine(`- ${target.org}`);
            ui.writeLine(`  log: ${target.logPath}`);
            ui.writeLine(`  interval: ${target.interval || t.defaultValue}`);
            ui.writeLine(`  scopeXml: ${target.scopeXml || '-'}`);
            ui.writeLine(`  scopeYaml: ${target.scopeYaml || '-'}`);
            ui.writeLine(`  exportCsv: ${target.exportCsv || '-'}`);
            ui.writeLine('');
        }
    }
    await ui.pause();
}
async function doAddTarget({ configPath, interval, ui, t }) {
    ui.clear();
    const org = await ui.prompt(t.aliasPrompt);
    if (!org) {
        return;
    }
    const result = addWatchTarget(configPath, org, { interval });
    ui.writeLine(result.status === 'exists' ? t.alreadyExists(org) : t.added(org));
    ui.writeLine(`Log: ${result.target.logPath}`);
    await ui.pause();
}
async function doRemoveTarget({ configPath, ui, t }) {
    const target = await chooseTarget(configPath, ui, t.removeTitle, t);
    if (!target) {
        return;
    }
    const result = removeWatchTarget(configPath, target.org);
    ui.clear();
    ui.writeLine(result.removed > 0 ? t.removed(target.org) : t.notRemoved(target.org));
    await ui.pause();
}
async function doConfigureScope({ configPath, ui, t }) {
    const target = await chooseTarget(configPath, ui, t.scopeTitle, t);
    if (!target) {
        return;
    }
    for (;;) {
        const selected = await ui.navigate(`Scope - ${target.org}`, [
            `${t.currentXml}: ${target.scopeXml || '-'}`,
            `${t.currentYaml}: ${target.scopeYaml || '-'}`,
            t.setXml,
            t.setYaml,
            t.clearXml,
            t.clearYaml,
            t.back,
        ], { hint: t.backHint });
        if (selected === -1 || selected === 6) {
            return;
        }
        if (selected === 2) {
            const nextXml = await promptManifestPath(ui, t.xmlPathPrompt, '.xml', t);
            if (nextXml !== undefined) {
                target.scopeXml = nextXml;
                updateWatchTarget(configPath, target.org, { scopeXml: nextXml });
            }
        }
        if (selected === 3) {
            const nextYaml = await promptManifestPath(ui, t.yamlPathPrompt, ['.yaml', '.yml'], t);
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
async function doChangeInterval({ configPath, ui, t }) {
    const target = await chooseTarget(configPath, ui, t.intervalTitle, t);
    if (!target) {
        return;
    }
    ui.clear();
    ui.writeLine(t.currentInterval(target.interval || t.defaultValue));
    const input = await ui.prompt(t.intervalPrompt);
    if (!input) {
        return;
    }
    const interval = Number(input);
    if (!Number.isInteger(interval) || interval < 1) {
        ui.writeLine(t.invalidInterval);
        await ui.pause();
        return;
    }
    updateWatchTarget(configPath, target.org, { interval });
    ui.writeLine(t.intervalUpdated(target.org, interval));
    await ui.pause();
}
async function doChangeLanguage({ configPath, ui, t }) {
    const selected = await ui.navigate(t.languageTitle, ['Español', 'English'], { hint: t.backHint });
    if (selected === -1) {
        return;
    }
    const language = selected === 1 ? 'en' : 'es';
    updateControlLanguage(configPath, language);
    ui.clear();
    ui.writeLine(language === 'en' ? 'Language changed to English.' : 'Idioma cambiado a Español.');
    await ui.pause();
}
async function doStartOne(context) {
    const target = await chooseTarget(context.configPath, context.ui, context.t.startOne, context.t);
    if (!target) {
        return;
    }
    startBackgroundMonitor(target, context);
    context.ui.clear();
    context.ui.writeLine(context.t.monitorStartedBg(target.org));
    await context.ui.pause();
}
async function doStartAllBackground(context) {
    const targets = listWatchTargets(context.configPath);
    context.ui.clear();
    if (targets.length === 0) {
        context.ui.writeLine(context.t.noMonitors);
        await context.ui.pause();
        return;
    }
    for (const target of targets) {
        startBackgroundMonitor(target, context);
        context.ui.writeLine(context.t.monitorStartedBg(target.org));
    }
    await context.ui.pause();
}
async function doStartAllTmux(context) {
    const targets = listWatchTargets(context.configPath);
    context.ui.clear();
    if (targets.length === 0) {
        context.ui.writeLine(context.t.noMonitors);
        await context.ui.pause();
        return;
    }
    if (!isTmuxAvailable()) {
        context.ui.writeLine(context.t.tmuxUnavailable);
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
async function doStartAllWindowsTerminal(context) {
    const targets = listWatchTargets(context.configPath);
    context.ui.clear();
    if (targets.length === 0) {
        context.ui.writeLine(context.t.noMonitors);
        await context.ui.pause();
        return;
    }
    if (!isWindowsTerminalAvailable()) {
        context.ui.writeLine(context.t.windowsTerminalUnavailable);
        await context.ui.pause();
        return;
    }
    const args = [];
    targets.forEach((target, index) => {
        if (index > 0) {
            args.push(';');
        }
        args.push('new-tab', '--title', windowNameForOrg(target.org), 'powershell.exe', '-NoExit', '-Command', buildWindowsMonitorCommand(target, context));
    });
    const result = spawnSync('wt.exe', args, {
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: false,
    });
    if (result.error || result.status) {
        context.ui.writeLine(context.t.windowsTerminalLaunchFailed(result.error?.message || result.status));
    }
    else {
        context.ui.writeLine(context.t.windowsTerminalStarted(targets.length));
    }
    await context.ui.pause();
}
async function doStopBackground({ ui, t }) {
    const state = loadProcessState();
    ui.clear();
    if (state.processes.length === 0) {
        ui.writeLine(t.noRegisteredProcesses);
        await ui.pause();
        return;
    }
    const remaining = [];
    for (const processInfo of state.processes) {
        try {
            process.kill(processInfo.pid);
            ui.writeLine(t.stopped(processInfo.org, processInfo.pid));
        }
        catch {
            remaining.push(processInfo);
        }
    }
    saveProcessState({ processes: remaining });
    await ui.pause();
}
async function doAutomationHelp({ ui, t }) {
    ui.clear();
    if (process.platform === 'win32') {
        ui.writeLine(t.windowsScheduler);
        ui.writeLine('sf metadelta monitor run --watchdog-once --watchdog-config <ruta>');
    }
    else {
        ui.writeLine(t.unixCron);
        ui.writeLine('*/5 * * * * sf metadelta monitor run --watchdog-once --watchdog-config <ruta>');
        ui.writeLine('');
        ui.writeLine(t.tmuxHelp);
    }
    await ui.pause();
}
async function chooseTarget(configPath, ui, title, t) {
    const targets = listWatchTargets(configPath);
    if (targets.length === 0) {
        ui.clear();
        ui.writeLine(t.noMonitors);
        await ui.pause();
        return null;
    }
    const selected = await ui.navigate(title, targets.map((target) => target.org), {
        hint: t.cancelHint,
    });
    return selected === -1 ? null : targets[selected];
}
async function promptManifestPath(ui, label, extensions, t) {
    ui.clear();
    const input = await ui.prompt(`${label} (${t.emptyToCancel})`);
    if (!input) {
        return undefined;
    }
    const resolved = path.resolve(input.replace(/^~(?=$|[\\/])/, os.homedir()));
    const allowed = Array.isArray(extensions) ? extensions : [extensions];
    if (!allowed.some((extension) => resolved.toLowerCase().endsWith(extension))) {
        ui.writeLine(t.invalidExtension(allowed));
        await ui.pause();
        return undefined;
    }
    if (!fs.existsSync(resolved)) {
        ui.writeLine(t.fileNotFound(resolved));
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
function isWindowsTerminalAvailable() {
    if (process.platform !== 'win32') {
        return false;
    }
    return spawnSync('where.exe', ['wt.exe'], { stdio: 'ignore' }).status === 0;
}
function setupTmuxStyle() {
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status', 'on'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-position', 'top'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-style', 'bg=colour235,fg=colour250'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-justify', 'centre'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-left', '#[fg=colour240]  ← →  │  '], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-right', '  │  Ctrl+X salir  '], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-left-length', '20'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'status-right-length', '20'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'window-status-format', '#[fg=colour240]  ○  #W  '], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'window-status-current-format', '#[bold,fg=colour214]  ●  #W  #[default]'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'window-status-separator', '#[fg=colour240]│'], { stdio: 'ignore' });
    spawnSync('tmux', ['set', '-t', TMUX_SESSION, 'visual-activity', 'off'], { stdio: 'ignore' });
    applyTmuxWindowStyleToAllWindows();
    spawnSync('tmux', ['bind-key', '-n', 'Right', 'next-window'], { stdio: 'ignore' });
    spawnSync('tmux', ['bind-key', '-n', 'Left', 'previous-window'], { stdio: 'ignore' });
    spawnSync('tmux', ['bind-key', '-n', 'C-x', 'run-shell', `tmux unbind-key -n Right 2>/dev/null; tmux unbind-key -n Left 2>/dev/null; tmux unbind-key -n C-x 2>/dev/null; tmux kill-session -t ${TMUX_SESSION} 2>/dev/null`], { stdio: 'ignore' });
}
function applyTmuxWindowStyleToAllWindows() {
    const result = spawnSync('tmux', ['list-windows', '-t', TMUX_SESSION, '-F', '#{window_index}'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    const indexes = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    for (const index of indexes) {
        const target = `${TMUX_SESSION}:${index}`;
        spawnSync('tmux', ['setw', '-t', target, 'window-status-format', '#[fg=colour240]  ○  #W  '], { stdio: 'ignore' });
        spawnSync('tmux', ['setw', '-t', target, 'window-status-current-format', '#[bold,fg=colour214]  ●  #W  #[default]'], { stdio: 'ignore' });
        spawnSync('tmux', ['setw', '-t', target, 'allow-rename', 'off'], { stdio: 'ignore' });
        spawnSync('tmux', ['setw', '-t', target, 'automatic-rename', 'off'], { stdio: 'ignore' });
        spawnSync('tmux', ['setw', '-t', target, 'monitor-activity', 'off'], { stdio: 'ignore' });
    }
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
export function buildWindowsMonitorCommand(target, context) {
    return powershellJoin([context.command, ...buildMonitorRunArgs(target, { interval: context.interval })]);
}
function powershellJoin(parts) {
    return parts.map((part) => {
        const text = String(part);
        if (/^[a-zA-Z0-9_./:=@-]+$/.test(text)) {
            return text;
        }
        return `'${text.replace(/'/g, "''")}'`;
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
        process.stdout.write(`\n  ${this.pauseText || 'Presiona cualquier tecla para continuar...'} `);
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
function getText(language) {
    if (language === 'en') {
        return {
            title: 'Metadelta Monitor - Control',
            mainHint: 'Up/Down navigate   Enter select   Ctrl+C exit',
            cancelHint: 'Up/Down navigate   Enter select   Ctrl+C cancel',
            backHint: 'Up/Down navigate   Enter select   Ctrl+C back',
            watchdogOnce: 'Run one watchdog cycle',
            list: 'List configured monitors',
            add: 'Add a monitor to watchdog',
            remove: 'Remove a monitor from watchdog',
            scope: 'Add/modify/remove XML/YAML scope',
            interval: 'Change monitor interval',
            language: 'Change language',
            startOne: 'Start one monitor',
            startAllTmux: 'Start all monitors - TUI tmux',
            startAllWindowsTerminal: 'Start all monitors - Windows Terminal tabs',
            startAllBg: 'Start all monitors - Background',
            stopBg: 'Stop monitors started by Metadelta',
            automationHelp: 'View automation help',
            exit: 'Exit',
            configuredMonitors: 'Configured monitors:',
            noMonitors: 'No monitors configured.',
            defaultValue: 'default',
            aliasPrompt: 'sf-cli alias for the environment',
            alreadyExists: (org) => `'${org}' already exists.`,
            added: (org) => `'${org}' added.`,
            removeTitle: 'Remove a monitor from watchdog',
            removed: (org) => `'${org}' removed.`,
            notRemoved: (org) => `'${org}' was not removed.`,
            scopeTitle: 'Configure XML/YAML scope',
            currentXml: 'Current XML',
            currentYaml: 'Current YAML',
            setXml: 'Add/modify XML',
            setYaml: 'Add/modify YAML',
            clearXml: 'Remove XML',
            clearYaml: 'Remove YAML',
            back: 'Back',
            xmlPathPrompt: 'XML file path',
            yamlPathPrompt: 'YAML file path',
            emptyToCancel: 'empty to cancel',
            invalidExtension: (allowed) => `The path must end in ${allowed.join(' or ')}.`,
            fileNotFound: (filePath) => `File not found: ${filePath}`,
            intervalTitle: 'Change monitor interval',
            currentInterval: (value) => `Current interval: ${value}`,
            intervalPrompt: 'New interval in minutes',
            invalidInterval: 'The interval must be an integer greater than or equal to 1.',
            intervalUpdated: (org, interval) => `'${org}' interval changed to ${interval} minute(s).`,
            languageTitle: 'Language',
            watchdogDone: (alerts, errors) => `Watchdog completed: ${alerts} alert(s), ${errors} error(s).`,
            watchdogError: (message) => `Watchdog error: ${message}`,
            monitorStartedBg: (org) => `Monitor ${org} started in background.`,
            tmuxUnavailable: 'tmux is not available in this environment.',
            windowsTerminalUnavailable: 'Windows Terminal wt.exe is not available in this environment.',
            windowsTerminalStarted: (count) => `${count} monitor tab(s) opened in Windows Terminal.`,
            windowsTerminalLaunchFailed: (detail) => `Windows Terminal could not be opened: ${detail}`,
            noRegisteredProcesses: 'No processes registered by Metadelta.',
            stopped: (org, pid) => `Stopped ${org} (PID ${pid}).`,
            windowsScheduler: 'Windows: use Task Scheduler to run periodically:',
            unixCron: 'Linux/WSL/macOS: you can schedule cron with:',
            tmuxHelp: 'If tmux is installed, the menu can open all monitors in one TUI session.',
            pauseText: 'Press any key to continue...',
        };
    }
    return {
        title: 'Metadelta Monitor - Control',
        mainHint: 'Up/Down navegar   Enter seleccionar   Ctrl+C salir',
        cancelHint: 'Up/Down navegar   Enter seleccionar   Ctrl+C cancelar',
        backHint: 'Up/Down navegar   Enter seleccionar   Ctrl+C volver',
        watchdogOnce: 'Ejecutar una pasada del watchdog',
        list: 'Listar monitores configurados',
        add: 'Agregar un monitor al watchdog',
        remove: 'Quitar un monitor del watchdog',
        scope: 'Agregar/modificar/eliminar scope XML/YAML',
        interval: 'Cambiar intervalo de un monitor',
        language: 'Cambiar idioma',
        startOne: 'Iniciar un monitor',
        startAllTmux: 'Iniciar todos los monitores - TUI tmux',
        startAllWindowsTerminal: 'Iniciar todos los monitores - Windows Terminal tabs',
        startAllBg: 'Iniciar todos los monitores - Background',
        stopBg: 'Detener monitores iniciados por Metadelta',
        automationHelp: 'Ver ayuda de automatizacion',
        exit: 'Salir',
        configuredMonitors: 'Monitores configurados:',
        noMonitors: 'No hay monitores configurados.',
        defaultValue: 'default',
        aliasPrompt: 'Alias sf-cli del ambiente',
        alreadyExists: (org) => `'${org}' ya existe.`,
        added: (org) => `'${org}' agregado.`,
        removeTitle: 'Quitar un monitor del watchdog',
        removed: (org) => `'${org}' quitado.`,
        notRemoved: (org) => `No se quito '${org}'.`,
        scopeTitle: 'Configurar scope XML/YAML',
        currentXml: 'XML actual',
        currentYaml: 'YAML actual',
        setXml: 'Agregar/modificar XML',
        setYaml: 'Agregar/modificar YAML',
        clearXml: 'Eliminar XML',
        clearYaml: 'Eliminar YAML',
        back: 'Volver',
        xmlPathPrompt: 'Ruta archivo XML',
        yamlPathPrompt: 'Ruta archivo YAML',
        emptyToCancel: 'vacio para cancelar',
        invalidExtension: (allowed) => `La ruta debe terminar en ${allowed.join(' o ')}.`,
        fileNotFound: (filePath) => `No se encontro el archivo: ${filePath}`,
        intervalTitle: 'Cambiar intervalo de un monitor',
        currentInterval: (value) => `Intervalo actual: ${value}`,
        intervalPrompt: 'Nuevo intervalo en minutos',
        invalidInterval: 'El intervalo debe ser un numero entero mayor o igual a 1.',
        intervalUpdated: (org, interval) => `'${org}' cambio a intervalo de ${interval} minuto(s).`,
        languageTitle: 'Idioma',
        watchdogDone: (alerts, errors) => `Watchdog completado: ${alerts} alerta(s), ${errors} error(es).`,
        watchdogError: (message) => `Error ejecutando watchdog: ${message}`,
        monitorStartedBg: (org) => `Monitor ${org} iniciado en background.`,
        tmuxUnavailable: 'tmux no esta disponible en este ambiente.',
        windowsTerminalUnavailable: 'Windows Terminal wt.exe no esta disponible en este ambiente.',
        windowsTerminalStarted: (count) => `${count} pestana(s) de monitor abiertas en Windows Terminal.`,
        windowsTerminalLaunchFailed: (detail) => `No se pudo abrir Windows Terminal: ${detail}`,
        noRegisteredProcesses: 'No hay procesos registrados por Metadelta.',
        stopped: (org, pid) => `Detenido ${org} (PID ${pid}).`,
        windowsScheduler: 'Windows: usa Task Scheduler para ejecutar periodicamente:',
        unixCron: 'Linux/WSL/macOS: puedes programar cron con:',
        tmuxHelp: 'Si tmux esta instalado, el menu puede abrir todos los monitores en una sesion TUI.',
        pauseText: 'Presiona cualquier tecla para continuar...',
    };
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
