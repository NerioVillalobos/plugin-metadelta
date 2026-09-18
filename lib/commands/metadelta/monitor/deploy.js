import { Command, Flags } from '../../../utils/oclif.js';
import { runProcess } from '../../../utils/monitor/process.js';
class MonitorDeploy extends Command {
    static id = 'metadelta:monitor:deploy';
    static summary = 'Review monitor deploy results in an interactive terminal screen.';
    static description = `
  Opens an interactive terminal screen for reviewing deploy results with keyboard navigation.
  This first version only provides the screen shell; deploy result collection will be added next.
  `;
    static examples = [
        'sf metadelta monitor deploy --org DEV',
        'sf metadelta monitor deploy --org DEV --once',
    ];
    static flags = {
        org: Flags.string({ char: 'o', summary: 'Alias or username of the target org', required: true }),
        once: Flags.boolean({ summary: 'Validate command wiring without opening the interactive terminal UI.' }),
    };
    async run() {
        const { flags } = await this.parse(MonitorDeploy);
        const interactive = !flags.once && process.stdout.isTTY;
        const loading = interactive ? new DeployLoadingUi({ orgAlias: flags.org }) : null;
        let rows;
        let metrics;
        try {
            loading?.start();
            loading?.update({ stage: 'Consultando historial de despliegues...', detail: 'Leyendo DeployRequest desde Tooling API.' });
            rows = await loadDeployRequests(flags.org);
            loading?.update({
                stage: 'Calculando métricas...',
                detail: `${rows.length} despliegue(s) encontrados. Leyendo reportes exitosos.`,
            });
            metrics = await loadDeployMetrics(flags.org, rows, (progress) => {
                loading?.update(progress);
            });
            loading?.update({ stage: 'Preparando pantalla interactiva...', detail: 'Renderizando resultados.' });
            loading?.stop();
        }
        catch (error) {
            loading?.stop();
            throw error;
        }
        if (flags.once || !process.stdout.isTTY) {
            this.log(`STATUS: READY`);
            this.log(`ORG: ${flags.org}`);
            this.log(`RESULTS: ${rows.length}`);
            this.log(`SUCCESS RATE: ${metrics.successRate.toFixed(1)}%`);
            this.log(`COMPONENTS: ${metrics.components}`);
            for (const row of rows) {
                this.log(`${row.deployId}\t${row.status}\t${row.createdBy}`);
            }
            return;
        }
        const ui = new DeployMonitorUi({
            orgAlias: flags.org,
            rows,
            metrics,
            onQuit: () => {
                ui.stop();
                process.exitCode = 0;
            },
        });
        ui.start();
    }
}
class DeployLoadingUi {
    constructor({ orgAlias }) {
        this.orgAlias = orgAlias;
        this.stage = 'Inicializando monitor de despliegues...';
        this.detail = '';
        this.completed = 0;
        this.total = 0;
        this.frame = 0;
        this.timer = undefined;
        this.frames = ['◐', '◓', '◑', '◒'];
    }
    start() {
        process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H');
        this.render();
        this.timer = setInterval(() => {
            this.frame = (this.frame + 1) % this.frames.length;
            this.render();
        }, 120);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        process.stdout.write('\x1b[?25h\x1b[2J\x1b[H\x1b[?1049l');
    }
    update(state) {
        Object.assign(this, state);
        this.render();
    }
    render() {
        const width = Math.max(80, process.stdout.columns || 100);
        const height = Math.max(24, process.stdout.rows || 30);
        const progress = this.total > 0 ? `${this.completed}/${this.total}` : 'preparando';
        const percent = this.total > 0 ? Math.round((this.completed / this.total) * 100) : 0;
        const lines = [
            boxTop(width, color.cyan(color.bold(' METADELTA MONITOR DEPLOY '))),
            row(width, labelValue('ORG', this.orgAlias)),
            separator(width),
            row(width, `${color.cyan(this.frames[this.frame])} ${color.bold('Cargando información de despliegues')}`),
            row(width, this.stage),
            row(width, color.dim(this.detail)),
            row(width, renderProgressBar(width - 16, percent), this.total > 0 ? `${percent}% (${progress})` : progress),
            row(width, color.dim('Esto puede tardar si hay muchos despliegues exitosos con reportes grandes.')),
            boxBottom(width),
        ];
        process.stdout.write(`\x1b[2J\x1b[H${lines.slice(0, height).join('\n')}`);
    }
}
class DeployMonitorUi {
    constructor({ orgAlias, rows, metrics, onQuit }) {
        this.orgAlias = orgAlias;
        this.rows = rows;
        this.metrics = metrics;
        this.onQuit = onQuit;
        this.selected = 0;
        this.detailMode = false;
        this.keyHandler = this.handleKey.bind(this);
    }
    start() {
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('data', this.keyHandler);
        }
        process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H');
        this.render();
    }
    stop() {
        if (process.stdin.isTTY) {
            process.stdin.off('data', this.keyHandler);
            process.stdin.setRawMode(false);
        }
        process.stdout.write('\x1b[?25h\x1b[2J\x1b[H\x1b[?1049l');
    }
    handleKey(buffer) {
        const key = buffer.toString();
        if (key === '\u0003') {
            this.onQuit();
            return;
        }
        if (buffer.equals(Buffer.from([0x1b, 0x5b, 0x41]))) {
            this.moveSelection(-1);
            this.render();
            return;
        }
        if (buffer.equals(Buffer.from([0x1b, 0x5b, 0x42]))) {
            this.moveSelection(1);
            this.render();
            return;
        }
        if (key === '\r' || key === '\n') {
            if (this.rows[this.selected]) {
                this.detailMode = !this.detailMode;
                this.render();
            }
        }
    }
    moveSelection(direction) {
        if (this.rows.length === 0) {
            this.selected = 0;
            return;
        }
        this.selected = Math.max(0, Math.min(this.rows.length - 1, this.selected + direction));
        this.detailMode = false;
    }
    render() {
        const width = Math.max(80, process.stdout.columns || 100);
        const height = Math.max(24, process.stdout.rows || 30);
        const lines = [];
        lines.push(boxTop(width, color.cyan(color.bold(' METADELTA MONITOR DEPLOY '))));
        lines.push(row(width, labelValue('ORG', this.orgAlias)));
        lines.push(...this.renderDeploymentTable(width, height - lines.length - 8));
        lines.push(...this.renderNavigation(width));
        lines.push(boxBottom(width));
        process.stdout.write(`\x1b[2J\x1b[H${lines.slice(0, height).join('\n')}`);
    }
    renderDeploymentTable(width, available) {
        const columnWidths = buildDeployTableColumnWidths(width, this.rows);
        const metricsRows = buildMetricsRows(this.metrics, this.rows[this.selected], this.detailMode);
        const lines = [
            tableConnector(columnWidths),
            tableLine(columnWidths, ['', 'DEPLOY ID', 'STATUS', 'CREATED BY', 'METRICS']),
            tableSeparator(columnWidths),
        ];
        if (this.rows.length === 0) {
            lines.push(tableLine(columnWidths, ['', 'No deploys loaded', '', '', metricsRows[0] ?? '']));
        }
        else {
            const availableRows = Math.max(1, available - lines.length - 1);
            const start = visibleWindowStart(this.selected, availableRows, this.rows.length);
            const visibleRows = this.rows.slice(start, start + availableRows);
            for (const [offset, item] of visibleRows.entries()) {
                const index = start + offset;
                const selected = index === this.selected;
                const marker = selected ? '>' : ' ';
                lines.push(tableLine(columnWidths, [
                    colorSelected(marker, selected),
                    colorSelected(item.deployId ?? 'N/A', selected),
                    colorSelected(item.status ?? 'Unknown', selected),
                    colorSelected(item.createdBy ?? 'Unknown', selected),
                    metricsRows[offset] ?? '',
                ]));
            }
        }
        lines.push(tableFooterConnector(columnWidths));
        return lines.map((line) => fitTableLine(line, width));
    }
    renderNavigation(width) {
        return [
            row(width, 'Navigation: Up Arrow | Down Arrow | ENTER | CTRL+C'),
        ];
    }
}
async function loadDeployRequests(orgAlias) {
    const query = [
        'SELECT Id, Status, CreatedBy.Name, CreatedDate, CompletedDate',
        'FROM DeployRequest',
        'ORDER BY CreatedDate DESC',
    ].join(' ');
    const { stdout } = await runProcess('sf', [
        'data',
        'query',
        '--use-tooling-api',
        '--query',
        query,
        '--target-org',
        orgAlias,
        '--json',
    ]);
    const parsed = JSON.parse(stdout);
    const records = parsed.result?.records;
    if (!Array.isArray(records)) {
        return [];
    }
    return records.map((record) => ({
        deployId: record.Id,
        status: record.Status,
        createdBy: record.CreatedBy?.Name ?? 'Unknown',
        createdDate: record.CreatedDate,
        completedDate: record.CompletedDate,
    }));
}
async function loadDeployMetrics(orgAlias, rows, onProgress) {
    const total = rows.length;
    const succeededRows = rows.filter((row) => isSucceededStatus(row.status));
    const successRate = total === 0 ? 0 : (succeededRows.length / total) * 100;
    let completed = 0;
    onProgress?.({
        stage: 'Leyendo reportes de despliegues exitosos...',
        detail: `${succeededRows.length} reporte(s) por consultar para contar componentes.`,
        completed,
        total: succeededRows.length,
    });
    const reports = await mapWithConcurrency(succeededRows, 3, async (row) => {
        onProgress?.({
            stage: 'Leyendo reportes de despliegues exitosos...',
            detail: `Consultando deploy ${row.deployId}.`,
            completed,
            total: succeededRows.length,
        });
        const report = await loadDeployReport(orgAlias, row.deployId);
        completed += 1;
        onProgress?.({
            stage: 'Leyendo reportes de despliegues exitosos...',
            detail: `Procesado deploy ${row.deployId}.`,
            completed,
            total: succeededRows.length,
        });
        return report;
    });
    let components = 0;
    for (const [index, report] of reports.entries()) {
        const deployComponents = listDeployedComponents(report);
        succeededRows[index].components = deployComponents;
        succeededRows[index].componentCount = deployComponents.length;
        components += deployComponents.length;
    }
    return {
        successRate,
        components,
    };
}
async function loadDeployReport(orgAlias, deployId) {
    try {
        const { stdout } = await runProcess('sf', [
            'project',
            'deploy',
            'report',
            '--job-id',
            deployId,
            '--target-org',
            orgAlias,
            '--json',
        ]);
        return JSON.parse(stdout);
    }
    catch {
        return null;
    }
}
async function mapWithConcurrency(items, limit, iteratee) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await iteratee(items[currentIndex]);
        }
    });
    await Promise.all(workers);
    return results;
}
function listDeployedComponents(report) {
    if (!report) {
        return [];
    }
    const componentEntries = collectComponentSuccesses(report);
    const uniqueComponents = new Set();
    const components = [];
    for (const component of componentEntries) {
        const type = component.componentType ?? component.type ?? component.metadataType ?? '';
        const name = component.fullName ?? component.name ?? component.fileName ?? component.filePath ?? '';
        if (!type && !name) {
            continue;
        }
        if (/package\.xml$/i.test(name)) {
            continue;
        }
        const key = `${type}:${name}`;
        if (uniqueComponents.has(key)) {
            continue;
        }
        uniqueComponents.add(key);
        components.push(formatComponentName(type, name));
    }
    return components.sort((left, right) => left.localeCompare(right));
}
function collectComponentSuccesses(value) {
    if (!value || typeof value !== 'object') {
        return [];
    }
    if (Array.isArray(value)) {
        return value.flatMap((item) => collectComponentSuccesses(item));
    }
    const direct = value.componentSuccesses;
    if (Array.isArray(direct)) {
        return direct;
    }
    const nested = [];
    for (const nestedValue of Object.values(value)) {
        nested.push(...collectComponentSuccesses(nestedValue));
    }
    return nested;
}
function renderProgressBar(width, percent) {
    const barWidth = Math.max(12, Math.min(40, width));
    const normalizedPercent = Math.max(0, Math.min(100, percent));
    const filled = Math.round((normalizedPercent / 100) * barWidth);
    return `${color.cyan('█'.repeat(filled))}${color.dim('░'.repeat(barWidth - filled))}`;
}
function visibleWindowStart(selected, limit, total) {
    if (total <= limit) {
        return 0;
    }
    const half = Math.floor(limit / 2);
    return Math.max(0, Math.min(total - limit, selected - half));
}
function boxTop(width, title) {
    const cleanTitle = stripAnsi(title);
    return `${color.dim('┌')}${title}${color.dim('─'.repeat(Math.max(0, width - cleanTitle.length - 2)))}${color.dim('┐')}`;
}
function boxBottom(width) {
    return `${color.dim('└')}${color.dim('─'.repeat(width - 2))}${color.dim('┘')}`;
}
function separator(width) {
    return `${color.dim('├')}${color.dim('─'.repeat(width - 2))}${color.dim('┤')}`;
}
function row(width, ...segments) {
    return fitLine(`│ ${segments.filter(Boolean).join('  ')} `, width - 1) + color.dim('│');
}
function section(width, text, tone) {
    return row(width, color[tone](color.bold(text)));
}
function labelValue(label, value) {
    return `${color.dim(`${label}:`)} ${value}`;
}
function tableHeader(width, labels, sizes) {
    return tableRow(width, labels.map((label) => color.bold(label)), sizes);
}
function tableRow(width, values, sizes) {
    const cells = values.map((value, index) => fitCell(String(value ?? ''), sizes[index] ?? 20));
    return row(width, cells.join(' '));
}
function tableConnector(sizes) {
    return tableBorder('├', '┬', '┤', sizes);
}
function tableSeparator(sizes) {
    return tableBorder('├', '┼', '┤', sizes);
}
function tableFooterConnector(sizes) {
    return tableBorder('├', '┴', '┤', sizes);
}
function tableBorder(left, join, right, sizes) {
    return `${color.dim(left)}${sizes.map((size) => color.dim('─'.repeat(size + 2))).join(color.dim(join))}${color.dim(right)}`;
}
function tableLine(sizes, values) {
    const cells = sizes.map((size, index) => ` ${fitCell(String(values[index] ?? ''), size)} `);
    return `${color.dim('│')}${cells.join(color.dim('│'))}${color.dim('│')}`;
}
function buildDeployTableColumnWidths(width, rows) {
    const fixedWidth = 3 + 20 + 12;
    const borderAndPaddingWidth = 1 + (5 * 2) + 4 + 1;
    const maxCreatedByLength = Math.max('CREATED BY'.length, ...rows.map((row) => stripAnsi(row.createdBy ?? 'Unknown').length));
    const minimumMetricsWidth = 'METRICS'.length;
    const maxCreatedByWidth = Math.max('CREATED BY'.length, width - fixedWidth - borderAndPaddingWidth - minimumMetricsWidth);
    const createdByWidth = Math.min(maxCreatedByWidth, Math.max('CREATED BY'.length, maxCreatedByLength));
    const metricsWidth = Math.max(minimumMetricsWidth, width - fixedWidth - createdByWidth - borderAndPaddingWidth);
    return [3, 20, 12, createdByWidth, metricsWidth];
}
function buildMetricsRows(metrics, selectedRow, detailMode) {
    if (detailMode && selectedRow) {
        const components = selectedRow.components ?? [];
        return [
            `Deploy: ${selectedRow.deployId}`,
            `Status: ${selectedRow.status ?? 'Unknown'}`,
            `Created By: ${selectedRow.createdBy ?? 'Unknown'}`,
            `Components: ${selectedRow.componentCount ?? components.length ?? 0}`,
            ...components.map((component) => `- ${component}`),
        ];
    }
    return [
        `Success Rate: ${metrics.successRate.toFixed(1)}%`,
        `Components: ${metrics.components}`,
    ];
}
function formatComponentName(type, name) {
    if (type && name) {
        return `${type}: ${name}`;
    }
    return type || name || 'Unknown component';
}
function isSucceededStatus(status) {
    return /^(success|succeeded)$/i.test(String(status ?? '').trim());
}
function fitCell(value, size) {
    const cleanLength = stripAnsi(value).length;
    if (cleanLength <= size) {
        return `${value}${' '.repeat(size - cleanLength)}`;
    }
    return `${stripAnsi(value).slice(0, Math.max(0, size - 1))}…`;
}
function fitLine(value, width) {
    const cleanLength = stripAnsi(value).length;
    if (cleanLength <= width) {
        return `${value}${' '.repeat(width - cleanLength)}`;
    }
    return `${stripAnsi(value).slice(0, Math.max(0, width - 1))}…`;
}
function fitTableLine(value, width) {
    const cleanLength = stripAnsi(value).length;
    if (cleanLength >= width) {
        return fitLine(value, width);
    }
    return `${value}${' '.repeat(width - cleanLength)}`;
}
function colorSelected(value, selected) {
    return selected ? color.inverse(value) : value;
}
function stripAnsi(value) {
    return String(value).replace(/\x1b\[[0-9;]*m/g, '');
}
const color = {
    bold: (value) => `\x1b[1m${value}\x1b[22m`,
    cyan: (value) => `\x1b[36m${value}\x1b[39m`,
    dim: (value) => `\x1b[2m${value}\x1b[22m`,
    green: (value) => `\x1b[32m${value}\x1b[39m`,
    inverse: (value) => `\x1b[7m${value}\x1b[27m`,
};
export default MonitorDeploy;
