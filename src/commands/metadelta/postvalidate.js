const {SfCommand, Flags} = require('@salesforce/sf-plugins-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

class PostValidate extends SfCommand {
  static id = 'metadelta:postvalidate';
  static summary = 'Compara componentes desplegados contra el código fuente local usando manifests XML/YAML.';
  static description = `
  Ejecuta un retrieve temporal usando los manifests proporcionados (Salesforce Core y/o Vlocity) y
  compara los archivos obtenidos contra el proyecto local, ignorando espacios en blanco, saltos de
  línea y comentarios. Al finalizar muestra una tabla con los componentes que difieren y elimina el
  directorio temporal utilizado.
  `;

  static examples = [
    'sf metadelta:postvalidate --xml manifest/package.xml --org my-core-org',
    'sf metadelta:postvalidate --yaml manifest/vlocity.yaml --org my-vlocity-org --vlocity-dir Vlocity',
    'sf metadelta:postvalidate --xml manifest/package.xml --yaml manifest/vlocity.yaml --org my-env --vlocity-dir Vlocity',
  ];

  static flags = {
    org: Flags.string({char: 'o', summary: 'Alias o username del ambiente (Salesforce Core o Vlocity)', required: false}),
    xml: Flags.string({summary: 'Ruta al manifest XML (package.xml) usado en el despliegue'}),
    yaml: Flags.string({summary: 'Ruta al manifest YAML usado en el despliegue Vlocity'}),
    'vlocity-dir': Flags.string({summary: 'Directorio base donde se encuentran los componentes Vlocity locales', default: 'Vlocity'}),
  };

  async run() {
    const {flags} = await this.parse(PostValidate);

    if (!flags.xml && !flags.yaml) {
      this.error('Debes proporcionar al menos un archivo manifest: --xml <ruta> o --yaml <ruta>.');
    }

    const projectRoot = process.cwd();
    const vlocityDir = path.resolve(flags['vlocity-dir']);
    const orgAlias = flags.org;

    const tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'metadelta-postvalidate-'));
    this.log(`📂 Directorio temporal creado: ${tempDir}`);

    try {
      if (flags.xml) {
        if (!orgAlias) {
          this.error('Para procesar el manifest XML debes indicar el alias del ambiente con --org.');
        }
        const xmlPath = path.resolve(flags.xml);
        this.log('🔄 Ejecutando retrieve de Salesforce Core...');
        const retrieveCmd = `sf project retrieve start --manifest ${xmlPath} --target-org ${orgAlias} --output-dir ${tempDir}`;
        this.runCommandAndCheck(retrieveCmd, 'retrieve de Salesforce Core');
      }

      if (flags.yaml) {
        if (!orgAlias) {
          this.error('Para procesar el manifest YAML debes indicar el alias del ambiente con --org.');
        }
        const yamlPath = path.resolve(flags.yaml);
        this.log('🔄 Ejecutando retrieve de Vlocity...');
        const vlocityCmd = `vlocity --sfdx.username ${orgAlias} -job ${yamlPath} packExport --maxDepth 0`;
        this.runCommandAndCheck(vlocityCmd, 'retrieve de Vlocity', tempDir);
      }

      const differences = this.compareFolders({tempDir, projectRoot, vlocityDir});
      this.printTable(differences);
    } finally {
      fs.rmSync(tempDir, {recursive: true, force: true});
      this.log('🗑️ Directorio temporal eliminado.');
    }
  }

  runCommandAndCheck(command, label, cwd) {
    const result = spawnSync(command, {shell: true, cwd, stdio: 'inherit'});
    if (result.status !== 0) {
      this.error(`Error al ejecutar ${label}. Código: ${result.status ?? 'desconocido'}`);
    }
  }

  compareFolders({tempDir, projectRoot, vlocityDir}) {
    const retrievedFiles = this.collectFiles(tempDir);
    const rows = [];

    for (const filePath of retrievedFiles) {
      const relative = path.relative(tempDir, filePath);
      const component = relative.split(path.sep)[0] || path.basename(relative);
      const name = path.basename(relative);

      const retrievedContent = this.readAndNormalize(filePath);
      const baseFile = this.resolveBaseFile({relative, projectRoot, vlocityDir});
      const baseContent = baseFile && fs.existsSync(baseFile) ? this.readAndNormalize(baseFile) : null;

      const isDifferent = baseContent === null ? true : retrievedContent !== baseContent;
      rows.push({component, name, isDifferent});
    }

    return rows;
  }

  collectFiles(dir) {
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    const files = [];
    for (const entry of entries) {
      if (this.shouldIgnoreEntry(entry)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.collectFiles(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  }

  shouldIgnoreEntry(entry) {
    if (entry.name === 'vlocity-temp') {
      return true;
    }
    return ['VlocityBuildErrors.log', 'VlocityBuildLog.yaml'].includes(entry.name);
  }

  resolveBaseFile({relative, projectRoot, vlocityDir}) {
    const parts = relative.split(path.sep);
    const candidates = [
      path.join(projectRoot, relative),
      path.join(vlocityDir, relative),
    ];

    if (parts[0] === path.basename(vlocityDir)) {
      candidates.push(path.join(vlocityDir, ...parts.slice(1)));
    }

    return candidates.find((candidate) => fs.existsSync(candidate));
  }

  readAndNormalize(filePath) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      this.warn(`No se pudo leer el archivo ${filePath}: ${error.message}`);
      return '';
    }
    return this.normalizeContent(content);
  }

  normalizeContent(content) {
    const withoutXmlComments = content.replace(/<!--[\s\S]*?-->/g, '');
    const withoutBlockComments = withoutXmlComments.replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutLineComments = withoutBlockComments
      .replace(/^\s*#.*$/gm, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    return withoutLineComments.replace(/\s+/g, '');
  }

  printTable(rows) {
    if (rows.length === 0) {
      this.log('No se encontraron archivos para comparar.');
      return;
    }

    const headers = ['Component', 'Name', 'Diff'];
    const widths = [
      Math.max(headers[0].length, ...rows.map((r) => r.component.length)),
      Math.max(headers[1].length, ...rows.map((r) => r.name.length)),
      headers[2].length,
    ];

    const color = {
      header: (text) => `\x1b[36m\x1b[1m${text}\x1b[0m`,
      ok: (text) => `\x1b[32m${text}\x1b[0m`,
      error: (text) => `\x1b[31m${text}\x1b[0m`,
    };

    const divider = (left, middle, right) =>
      `${left}${'─'.repeat(widths[0] + 2)}${middle}${'─'.repeat(widths[1] + 2)}${middle}${'─'.repeat(widths[2] + 2)}${right}`;

    const formatRow = (cells) => {
      const padded = cells.map(({text, colorFn}, index) => {
        const base = String(text).padEnd(widths[index]);
        return colorFn ? colorFn(base) : base;
      });
      return `│ ${padded[0]} │ ${padded[1]} │ ${padded[2]} │`;
    };

    const headerCells = headers.map((h) => ({text: h, colorFn: color.header}));
    this.log(divider('┌', '┬', '┐'));
    this.log(formatRow(headerCells));
    this.log(divider('├', '┼', '┤'));

    for (const row of rows) {
      const diffSymbol = row.isDifferent ? '✗' : '✓';
      const diffColor = row.isDifferent ? color.error : color.ok;
      this.log(formatRow([
        {text: row.component},
        {text: row.name},
        {text: diffSymbol, colorFn: diffColor},
      ]));
    }

    this.log(divider('└', '┴', '┘'));
  }
}

module.exports = PostValidate;
