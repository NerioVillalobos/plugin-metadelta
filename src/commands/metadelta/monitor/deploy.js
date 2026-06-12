import {Command, Flags} from '@oclif/core';
import {runProcess} from '../../../utils/monitor/process.js';

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
    org: Flags.string({char: 'o', summary: 'Alias or username of the target org', required: true}),
    once: Flags.boolean({summary: 'Validate command wiring without opening the interactive terminal UI.'}),
  };

  async run() {
    const {flags} = await this.parse(MonitorDeploy);
    const rows = await loadDeployRequests(flags.org);

    if (flags.once || !process.stdout.isTTY) {
      this.log(`STATUS: READY`);
      this.log(`ORG: ${flags.org}`);
      this.log(`RESULTS: ${rows.length}`);
      for (const row of rows) {
        this.log(`${row.deployId}\t${row.status}\t${row.createdBy}`);
      }
      return;
    }

    const ui = new DeployMonitorUi({
      orgAlias: flags.org,
      rows,
      onQuit: () => {
        ui.stop();
        process.exitCode = 0;
      },
    });

    ui.start();
  }
}

class DeployMonitorUi {
  constructor({orgAlias, rows, onQuit}) {
    this.orgAlias = orgAlias;
    this.rows = rows;
    this.onQuit = onQuit;
    this.selected = 0;
    this.commandBuffer = '';
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
    } else {
      this.commandBuffer = '';
    }
    if (buffer.equals(Buffer.from([0x1b, 0x5b, 0x41]))) {
      this.moveSelection(-1);
      this.render();
      return;
    }
    if (buffer.equals(Buffer.from([0x1b, 0x5b, 0x42]))) {
      this.moveSelection(1);
      this.render();
    }
  }

  moveSelection(direction) {
    if (this.rows.length === 0) {
      this.selected = 0;
      return;
    }
    this.selected = Math.max(0, Math.min(this.rows.length - 1, this.selected + direction));
  }

  render() {
    const width = Math.max(80, process.stdout.columns || 100);
    const height = Math.max(24, process.stdout.rows || 30);
    const lines = [];
    lines.push(boxTop(width, color.cyan(color.bold(' METADELTA MONITOR DEPLOY '))));
    lines.push(row(width, labelValue('ORG', this.orgAlias)));
    lines.push(separator(width));
    lines.push(...this.renderDeploymentHeader(width));
    lines.push('');
    lines.push(...this.renderDeploymentTable(width, height - lines.length - 8));
    lines.push('');
    lines.push(...this.renderNavigation(width));
    lines.push(boxBottom(width));
    process.stdout.write(`\x1b[2J\x1b[H${lines.slice(0, height).join('\n')}`);
  }

  renderDeploymentHeader(width) {
    const innerWidth = Math.min(78, width - 2);
    return [
      titledBoxTop(innerWidth, ' DEPLOYMENT MONITOR '),
      boxRow(innerWidth, `Org: ${this.orgAlias}`),
      simpleBoxBottom(innerWidth),
    ];
  }

  renderDeploymentTable(width, available) {
    const tableWidth = Math.min(78, width - 2);
    const columnWidths = [3, 20, 12, 35];
    const lines = [
      tableTop(columnWidths),
      tableLine(columnWidths, ['', 'DEPLOY ID', 'STATUS', 'CREATED BY']),
      tableSeparator(columnWidths),
    ];
    if (this.rows.length === 0) {
      lines.push(tableLine(columnWidths, ['', 'No deploys loaded', '', '']));
    } else {
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
        ]));
      }
    }
    lines.push(tableBottom(columnWidths));
    return lines.map((line) => fitLine(line, tableWidth));
  }

  renderNavigation(width) {
    return [
      fitLine('Navigation:', width),
      '',
      fitLine('Up Arrow', width),
      fitLine('Down Arrow', width),
      fitLine('ENTER', width),
      fitLine('Q', width),
    ];
  }
}

async function loadDeployRequests(orgAlias) {
  const query = [
    'SELECT Id, Status, CreatedBy.Name, CreatedDate, CompletedDate',
    'FROM DeployRequest',
    'ORDER BY CreatedDate DESC',
  ].join(' ');
  const {stdout} = await runProcess('sf', [
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

function titledBoxTop(width, title) {
  const cleanTitle = stripAnsi(title);
  return `${color.dim('┌')}${title}${color.dim('─'.repeat(Math.max(0, width - cleanTitle.length - 2)))}${color.dim('┐')}`;
}

function simpleBoxBottom(width) {
  return `${color.dim('└')}${color.dim('─'.repeat(width - 2))}${color.dim('┘')}`;
}

function boxRow(width, value) {
  return `${color.dim('│')} ${fitCell(value, width - 4)} ${color.dim('│')}`;
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

function tableTop(sizes) {
  return tableBorder('┌', '┬', '┐', sizes);
}

function tableSeparator(sizes) {
  return tableBorder('├', '┼', '┤', sizes);
}

function tableBottom(sizes) {
  return tableBorder('└', '┴', '┘', sizes);
}

function tableBorder(left, join, right, sizes) {
  return `${color.dim(left)}${sizes.map((size) => color.dim('─'.repeat(size + 2))).join(color.dim(join))}${color.dim(right)}`;
}

function tableLine(sizes, values) {
  const cells = sizes.map((size, index) => ` ${fitCell(String(values[index] ?? ''), size)} `);
  return `${color.dim('│')}${cells.join(color.dim('│'))}${color.dim('│')}`;
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
