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

  static flags = {
    org: Flags.string({char: 'o', summary: 'Alias o username del ambiente para Salesforce Core', required: false}),
    'vlocity-org': Flags.string({summary: 'Alias o username del ambiente para Vlocity (si es distinto al org principal)'}),
    xml: Flags.string({summary: 'Ruta al manifest XML (package.xml) usado en el despliegue'}),
    yaml: Flags.string({summary: 'Ruta al manifest YAML usado en el despliegue Vlocity'}),
    'base-dir': Flags.string({summary: 'Directorio base del proyecto que contiene los componentes', default: '.'}),
  };

  async run() {
    const {flags} = await this.parse(PostValidate);

    if (!flags.xml && !flags.yaml) {
      this.error('Debes proporcionar al menos un archivo manifest: --xml <ruta> o --yaml <ruta>.');
    }

    const baseDir = path.resolve(flags['base-dir']);
    const orgAlias = flags.org;
    const vlocityOrg = flags['vlocity-org'] || orgAlias;

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
        if (!vlocityOrg) {
          this.error('Para procesar el manifest YAML debes indicar el alias del ambiente con --vlocity-org o --org.');
        }
        const yamlPath = path.resolve(flags.yaml);
        this.log('🔄 Ejecutando retrieve de Vlocity...');
        const vlocityCmd = `vlocity --sfdx.username ${vlocityOrg} -job ${yamlPath} packExport --maxDepth 0`;
        this.runCommandAndCheck(vlocityCmd, 'retrieve de Vlocity', tempDir);
      }

      const differences = this.compareFolders(baseDir, tempDir);
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

  compareFolders(baseDir, tempDir) {
    const retrievedFiles = this.collectFiles(tempDir);
    const rows = [];

    for (const filePath of retrievedFiles) {
      const relative = path.relative(tempDir, filePath);
      const baseFile = path.join(baseDir, relative);
      const component = relative.split(path.sep)[0] || path.basename(relative);
      const name = path.basename(relative);

      const retrievedContent = this.readAndNormalize(filePath);
      const baseContent = fs.existsSync(baseFile) ? this.readAndNormalize(baseFile) : null;

      const isDifferent = baseContent === null ? true : retrievedContent !== baseContent;
      rows.push({component, name, isDifferent});
    }

    return rows;
  }

  collectFiles(dir) {
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.collectFiles(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
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
      headers[2].length
    ];

    const line = (values) =>
      values
        .map((val, index) => String(val).padEnd(widths[index]))
        .join(' | ');

    this.log(line(headers));
    this.log(`${'-'.repeat(widths[0])}-+-${'-'.repeat(widths[1])}-+-${'-'.repeat(widths[2])}`);

    for (const row of rows) {
      const diffSymbol = row.isDifferent ? '✗' : '✓';
      this.log(line([row.component, row.name, diffSymbol]));
    }
  }
}

module.exports = PostValidate;
