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
        process.stdout.write('\x1b[?25l');
        this.countdownTimer = setInterval(() => {
            this.render();
        }, 1000);
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
        process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
    }
    update(state) {
        Object.assign(this, state);
        this.selected = Math.max(0, Math.min(this.selected, Math.max(0, this.rows.length - 1)));
        this.render();
    }
    handleKey(buffer) {
        const key = buffer.toString();
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
            this.onRefresh();
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
        const width = Math.max(80, process.stdout.columns || 100);
        const height = Math.max(24, process.stdout.rows || 30);
        const lines = [];
        const title = ` METADELTA MONITOR `;
        lines.push(boxTop(width, title));
        lines.push(row(width, `ORG: ${this.orgAlias}`, `STATUS: ${this.status}`, `SCOPE: ${this.scope.toUpperCase()}`));
        lines.push(row(width, `INTERVAL: ${Math.round(this.intervalMs / 60000)} min`, `NEXT: ${formatCountdown(this.nextRefreshAt)}`, `LAST: ${formatTime(this.lastRefreshAt)}`));
        lines.push(row(width, this.message || 'q/x/exit quit | r refresh | d detail | s/v/a scope'));
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
        const grouped = groupByType(this.rows);
        lines.push(section(width, 'SALESFORCE CORE / VLOCITY'));
        lines.push(tableHeader(width, ['TYPE', 'COUNT', 'LAST CHANGE', 'LAST MODIFIED BY'], [24, 8, 20]));
        for (const item of grouped.slice(0, Math.max(2, Math.floor(available / 2) - 4))) {
            lines.push(tableRow(width, [item.type, String(item.count), formatDate(item.lastModifiedDate), item.user], [24, 8, 20]));
        }
        lines.push(separator(width));
        lines.push(section(width, 'RECENT CHANGES'));
        const maxRows = Math.max(1, available - lines.length - 2);
        for (const [index, item] of this.rows.slice(0, maxRows).entries()) {
            const marker = index === this.selected ? '>' : ' ';
            lines.push(tableRow(width, [`${marker} ${item.type}`, item.action, item.user, item.file], [24, 12, 22]));
        }
        if (this.rows.length === 0) {
            lines.push(row(width, this.status === 'BASELINE CREATED' ? 'Baseline creada. Los cambios aparecerán en el siguiente refresh.' : 'Sin cambios detectados.'));
            lines.push(row(width, 'Salir: presiona q, x, ESC, CTRL+C o escribe exit.'));
        }
        return lines;
    }
    renderDetail(width, available) {
        const item = this.rows[this.selected];
        const lines = [section(width, 'CHANGE DETAILS')];
        const detail = [
            `FILE: ${item.file}`,
            `TYPE: ${item.type}`,
            `ACTION: ${item.action}`,
            '',
            `LAST MODIFIED BY: ${item.user}`,
            `LAST MODIFIED DATE: ${item.lastModifiedDate ?? 'Unknown'}`,
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
}
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
function boxTop(width, title) {
    return `┌${title}${'─'.repeat(Math.max(0, width - title.length - 2))}┐`;
}
function boxBottom(width) {
    return `└${'─'.repeat(width - 2)}┘`;
}
function separator(width) {
    return `├${'─'.repeat(width - 2)}┤`;
}
function section(width, text) {
    return row(width, text);
}
function row(width, ...parts) {
    const content = parts.filter(Boolean).join('    ');
    return `│ ${truncate(content, width - 4).padEnd(width - 4)} │`;
}
function tableHeader(width, labels, fixed) {
    return tableRow(width, labels, fixed);
}
function tableRow(width, cells, fixed) {
    const used = fixed.reduce((sum, value) => sum + value, 0);
    const lastWidth = Math.max(10, width - used - cells.length * 3 - 4);
    const widths = [...fixed, lastWidth];
    const content = cells.map((cell, index) => truncate(String(cell ?? ''), widths[index]).padEnd(widths[index])).join(' │ ');
    return `│ ${truncate(content, width - 4).padEnd(width - 4)} │`;
}
function truncate(text, length) {
    if (text.length <= length) {
        return text;
    }
    return `${text.slice(0, Math.max(0, length - 1))}…`;
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
