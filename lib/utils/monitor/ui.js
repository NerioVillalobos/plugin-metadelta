export class MonitorUi {
    constructor({ orgAlias, intervalMs, onRefresh, onQuit, onScope }) {
        this.orgAlias = orgAlias;
        this.intervalMs = intervalMs;
        this.onRefresh = onRefresh;
        this.onQuit = onQuit;
        this.onScope = onScope;
        this.rows = [];
        this.status = 'INITIALIZING';
        this.scope = 'all';
        this.selected = 0;
        this.detailMode = false;
        this.message = '';
        this.errorDetail = '';
        this.noticeDetail = '';
        this.renderPaused = false;
        this.autoPausedForDetail = false;
        this.lastRefreshAt = null;
        this.nextRefreshAt = null;
        this.commandBuffer = '';
        this.keyHandler = this.handleKey.bind(this);
        this.countdownTimer = undefined;
    }
    start() {
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('data', this.keyHandler);
        }
        process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H');
        this.countdownTimer = setInterval(() => {
            if (!this.renderPaused && !this.hasVisibleDetail()) {
                this.render();
            }
        }, 5000);
        this.render();
    }
    stop() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = undefined;
        }
        if (process.stdin.isTTY) {
            process.stdin.off('data', this.keyHandler);
            process.stdin.setRawMode(false);
        }
        process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?25h\x1b[2J\x1b[H\x1b[?1049l');
    }
    update(state) {
        Object.assign(this, state);
        this.selected = Math.max(0, Math.min(this.selected, Math.max(0, this.rows.length - 1)));
        if (this.hasVisibleDetail()) {
            this.renderPaused = true;
            this.autoPausedForDetail = true;
            this.forceRenderOnce = true;
        }
        else if (this.autoPausedForDetail) {
            this.renderPaused = false;
            this.autoPausedForDetail = false;
        }
        this.render();
    }
    handleKey(buffer) {
        const key = buffer.toString();
        if (isMouseSequence(buffer)) {
            return;
        }
        if (key === 'q' || key === 'x' || key === '\u0003' || buffer.equals(Buffer.from([0x1b]))) {
            this.onQuit();
            return;
        }
        if (/^[a-z]$/i.test(key)) {
            this.commandBuffer = `${this.commandBuffer}${key.toLowerCase()}`.slice(-8);
            if (this.commandBuffer.endsWith('exit')) {
                this.onQuit();
                return;
            }
        }
        else {
            this.commandBuffer = '';
        }
        if (key === 'r') {
            this.renderPaused = false;
            this.autoPausedForDetail = false;
            this.onRefresh();
            return;
        }
        if (key === 'p') {
            this.renderPaused = !this.renderPaused;
            this.autoPausedForDetail = false;
            this.forceRenderOnce = true;
            this.render();
            return;
        }
        if (key === 'd' || key === '\r') {
            this.detailMode = !this.detailMode;
            this.render();
            return;
        }
        if (key === 'a' || key === 's' || key === 'v') {
            const scope = { a: 'all', s: 'salesforce', v: 'vlocity' }[key];
            this.scope = scope;
            this.onScope(scope);
            return;
        }
        if (buffer.equals(Buffer.from([0x1b, 0x5b, 0x41]))) {
            this.selected = Math.max(0, this.selected - 1);
            this.render();
        }
        if (buffer.equals(Buffer.from([0x1b, 0x5b, 0x42]))) {
            this.selected = Math.min(Math.max(0, this.rows.length - 1), this.selected + 1);
            this.render();
        }
    }
    render() {
        if (this.renderPaused && !this.forceRenderOnce) {
            return;
        }
        this.forceRenderOnce = false;
        const width = Math.max(80, process.stdout.columns || 100);
        const height = Math.max(24, process.stdout.rows || 30);
        const lines = [];
        const title = color.cyan(color.bold(` METADELTA MONITOR `));
        lines.push(boxTop(width, title));
        lines.push(row(width, labelValue('ORG', this.orgAlias), labelValue('STATUS', colorStatus(this.status)), labelValue('SCOPE', colorScope(this.scope))));
        lines.push(row(width, labelValue('INTERVAL', `${Math.round(this.intervalMs / 60000)} min`), labelValue('NEXT', colorCountdown(formatCountdown(this.nextRefreshAt), this.nextRefreshAt)), labelValue('LAST', formatTime(this.lastRefreshAt))));
        lines.push(row(width, colorMessage(this.message || 'q/x/exit quit | r refresh | p pause | d detail | s/v/a scope', this.status), this.renderPaused ? color.yellow(color.bold('UI PAUSED')) : ''));
        lines.push(separator(width));
        if (this.detailMode && this.rows[this.selected]) {
            lines.push(...this.renderDetail(width, height - lines.length - 1));
        }
        else {
            lines.push(...this.renderMain(width, height - lines.length - 1));
        }
        lines.push(boxBottom(width));
        process.stdout.write(`\x1b[2J\x1b[H${lines.slice(0, height).join('\n')}`);
    }
    renderMain(width, available) {
        const lines = [];
        const detail = this.errorDetail || this.noticeDetail;
        const detailLines = detail ? renderDetailBlock(width, this.errorDetail ? 'ERROR DETAILS' : 'NOTICE DETAILS', detail) : [];
        const grouped = groupByType(this.rows);
        lines.push(section(width, 'SALESFORCE CORE / VLOCITY', 'cyan'));
        lines.push(tableHeader(width, ['TYPE', 'COUNT', 'LAST CHANGE', 'LAST MODIFIED BY'], [24, 8, 20]));
        const groupLimit = Math.max(2, Math.floor((available - detailLines.length) / 2) - 4);
        for (const item of grouped.slice(0, groupLimit)) {
            lines.push(tableRow(width, [colorType(item.type), color.bold(String(item.count)), formatDate(item.lastModifiedDate), color.dim(item.user)], [24, 8, 20]));
        }
        lines.push(separator(width));
        lines.push(section(width, 'RECENT CHANGES (SESSION CUMULATIVE)', 'cyan'));
        const maxRows = Math.max(1, available - lines.length - detailLines.length - 2);
        for (const [index, item] of this.rows.slice(0, maxRows).entries()) {
            const marker = index === this.selected ? '>' : ' ';
            lines.push(tableRow(width, [
                colorSelected(`${marker} ${item.type}`, index === this.selected),
                colorAction(item.action),
                color.dim(item.user),
                colorFile(item.file, item.action),
            ], [24, 12, 22]));
        }
        if (this.rows.length === 0) {
            lines.push(row(width, color.dim(this.status === 'BASELINE CREATED' ? 'Baseline creada. Los cambios aparecerán en el siguiente refresh.' : 'Sin cambios detectados.')));
            lines.push(row(width, color.dim('Salir: presiona q, x, ESC, CTRL+C o escribe exit.')));
        }
        if (detailLines.length > 0) {
            lines.push(separator(width));
            lines.push(...detailLines.slice(0, Math.max(1, available - lines.length)));
        }
        return lines;
    }
    renderDetail(width, available) {
        const item = this.rows[this.selected];
        const lines = [section(width, 'CHANGE DETAILS', 'cyan')];
        const detail = [
            `FILE: ${item.file}`,
            `TYPE: ${item.type}`,
            `ACTION: ${item.action}`,
            '',
            `LAST MODIFIED BY: ${item.user}`,
            `LAST MODIFIED DATE: ${item.lastModifiedDate ?? 'Unknown'}`,
            `DETECTED BY MONITOR: ${item.detectedAt ?? 'Unknown'}`,
            '',
            'QUERY:',
            item.query ?? 'N/A',
            '',
            'GIT DIFF SUMMARY:',
            ...(item.diffSummary?.length ? item.diffSummary : ['No textual summary available.']),
        ];
        for (const line of detail.slice(0, available - 1)) {
            lines.push(row(width, line));
        }
        return lines;
    }
    hasVisibleDetail() {
        return Boolean(this.errorDetail || this.noticeDetail);
    }
}
const ansi = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
};
const color = {
    bold: (value) => `${ansi.bold}${value}${ansi.reset}`,
    dim: (value) => `${ansi.dim}${value}${ansi.reset}`,
    red: (value) => `${ansi.red}${value}${ansi.reset}`,
    green: (value) => `${ansi.green}${value}${ansi.reset}`,
    yellow: (value) => `${ansi.yellow}${value}${ansi.reset}`,
    blue: (value) => `${ansi.blue}${value}${ansi.reset}`,
    magenta: (value) => `${ansi.magenta}${value}${ansi.reset}`,
    cyan: (value) => `${ansi.cyan}${value}${ansi.reset}`,
    white: (value) => `${ansi.white}${value}${ansi.reset}`,
};
function groupByType(rows) {
    const grouped = new Map();
    for (const rowItem of rows) {
        const current = grouped.get(rowItem.type) ?? { type: rowItem.type, count: 0, lastModifiedDate: null, user: 'Unknown' };
        current.count += 1;
        if (!current.lastModifiedDate || (rowItem.lastModifiedDate && rowItem.lastModifiedDate > current.lastModifiedDate)) {
            current.lastModifiedDate = rowItem.lastModifiedDate;
            current.user = rowItem.user;
        }
        grouped.set(rowItem.type, current);
    }
    return [...grouped.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}
function labelValue(label, value) {
    return `${color.dim(`${label}:`)} ${value}`;
}
function colorStatus(status) {
    const normalized = String(status ?? '').toUpperCase();
    if (normalized === 'ERROR') {
        return color.red(color.bold(normalized));
    }
    if (normalized === 'REFRESHING') {
        return color.yellow(color.bold(normalized));
    }
    if (normalized === 'BASELINE CREATED') {
        return color.green(color.bold(normalized));
    }
    if (normalized === 'WATCHING') {
        return color.cyan(color.bold(normalized));
    }
    return color.white(normalized);
}
function colorScope(scope) {
    const normalized = String(scope ?? '').toUpperCase();
    if (normalized === 'SALESFORCE') {
        return color.blue(color.bold(normalized));
    }
    if (normalized === 'VLOCITY') {
        return color.magenta(color.bold(normalized));
    }
    return color.cyan(color.bold(normalized));
}
function colorCountdown(value, nextRefreshAt) {
    if (!nextRefreshAt) {
        return color.yellow(value);
    }
    const remainingMs = Math.max(0, Number(nextRefreshAt) - Date.now());
    if (remainingMs <= 30_000) {
        return color.yellow(color.bold(value));
    }
    return color.green(value);
}
function colorMessage(message, status) {
    if (String(status ?? '').toUpperCase() === 'ERROR') {
        return color.red(message);
    }
    if (/omitido|warning|aviso/i.test(message)) {
        return color.yellow(message);
    }
    return color.dim(message);
}
function colorAction(action) {
    const normalized = String(action ?? '').toUpperCase();
    if (normalized === 'ADDED') {
        return color.green(color.bold(normalized));
    }
    if (normalized === 'MODIFIED') {
        return color.yellow(color.bold(normalized));
    }
    if (normalized === 'DELETED') {
        return color.red(color.bold(normalized));
    }
    if (normalized === 'RENAMED') {
        return color.magenta(color.bold(normalized));
    }
    return color.white(normalized);
}
function colorType(type) {
    return color.cyan(type);
}
function colorSelected(value, selected) {
    return selected ? color.bold(color.white(value)) : color.dim(value);
}
function colorFile(file, action) {
    const normalized = String(action ?? '').toUpperCase();
    if (normalized === 'ADDED') {
        return color.green(file);
    }
    if (normalized === 'DELETED') {
        return color.red(file);
    }
    if (normalized === 'RENAMED') {
        return color.magenta(file);
    }
    return color.white(file);
}
function boxTop(width, title) {
    return `┌${title}${'─'.repeat(Math.max(0, width - visibleLength(title) - 2))}┐`;
}
function boxBottom(width) {
    return `└${'─'.repeat(width - 2)}┘`;
}
function separator(width) {
    return `├${'─'.repeat(width - 2)}┤`;
}
function section(width, text, tone = 'base') {
    const styled = tone === 'cyan' ? color.cyan(color.bold(text)) : text;
    return row(width, styled);
}
function row(width, ...parts) {
    const content = parts.filter(Boolean).join('    ');
    return `│ ${padVisible(truncate(content, width - 4), width - 4)} │`;
}
function tableHeader(width, labels, fixed) {
    return tableRow(width, labels.map((label) => color.bold(color.cyan(label))), fixed);
}
function tableRow(width, cells, fixed) {
    const used = fixed.reduce((sum, value) => sum + value, 0);
    const lastWidth = Math.max(10, width - used - cells.length * 3 - 4);
    const widths = [...fixed, lastWidth];
    const content = cells.map((cell, index) => padVisible(truncate(String(cell ?? ''), widths[index]), widths[index])).join(color.dim(' │ '));
    return `│ ${padVisible(truncate(content, width - 4), width - 4)} │`;
}
function truncate(text, length) {
    if (visibleLength(text) <= length) {
        return text;
    }
    const plain = stripAnsi(text);
    return `${plain.slice(0, Math.max(0, length - 1))}…`;
}
function visibleLength(value) {
    return stripAnsi(String(value ?? '')).length;
}
function padVisible(value, length) {
    const text = String(value ?? '');
    return `${text}${' '.repeat(Math.max(0, length - visibleLength(text)))}`;
}
function formatDate(value) {
    if (!value) {
        return 'Unknown';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toISOString().replace('T', ' ').slice(0, 19);
}
function formatCountdown(value) {
    if (!value) {
        return 'refreshing';
    }
    const remainingMs = Math.max(0, Number(value) - Date.now());
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
function formatTime(value) {
    if (!value) {
        return 'never';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'unknown';
    }
    return date.toTimeString().slice(0, 8);
}
function isMouseSequence(buffer) {
    const value = buffer.toString();
    return /^\x1b\[M/.test(value) || /^\x1b\[<\d+;\d+;\d+[mM]$/.test(value);
}
function renderDetailBlock(width, title, detail) {
    const isError = /error/i.test(title);
    const lines = [section(width, isError ? color.red(color.bold(title)) : color.yellow(color.bold(title)))];
    for (const rawLine of stripAnsi(String(detail ?? '')).split(/\r?\n/)) {
        const wrapped = wrapText(rawLine, width - 4);
        for (const line of wrapped) {
            lines.push(row(width, isError ? color.red(line) : color.yellow(line)));
        }
    }
    return lines;
}
function wrapText(text, width) {
    if (!text) {
        return [''];
    }
    const words = text.split(/\s+/);
    const lines = [];
    let current = '';
    for (const word of words) {
        if (word.length > width) {
            if (current) {
                lines.push(current);
                current = '';
            }
            for (let index = 0; index < word.length; index += width) {
                lines.push(word.slice(index, index + width));
            }
            continue;
        }
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > width) {
            lines.push(current);
            current = word;
        }
        else {
            current = candidate;
        }
    }
    if (current) {
        lines.push(current);
    }
    return lines;
}
function stripAnsi(value) {
    return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}
