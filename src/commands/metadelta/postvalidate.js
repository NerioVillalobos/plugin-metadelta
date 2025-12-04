import {Command, Flags} from '@oclif/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

class PostValidate extends Command {
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
    this.packageDirectories = this.loadPackageDirectories(projectRoot);
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
        const retrieveCmd = `sf project retrieve start --manifest ${xmlPath} --target-org ${orgAlias} --output-dir ${tempDir}`;
        await this.runCommandAndCheck(retrieveCmd, 'Retrieve de Salesforce Core');
      }

      if (flags.yaml) {
        if (!orgAlias) {
          this.error('Para procesar el manifest YAML debes indicar el alias del ambiente con --org.');
        }
        const yamlPath = path.resolve(flags.yaml);
        const vlocityCmd = `vlocity --sfdx.username ${orgAlias} -job ${yamlPath} packExport --maxDepth 0`;
        await this.runCommandAndCheck(vlocityCmd, 'Retrieve de Vlocity', tempDir);
      }

      const differences = this.compareFolders({tempDir, projectRoot, vlocityDir});
      this.printTable(differences);
    } finally {
      fs.rmSync(tempDir, {recursive: true, force: true});
      this.log('🗑️ Directorio temporal eliminado.');
    }
  }

  startSpinner(label) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let index = 0;
    process.stdout.write(`${frames[index]} ${label}`);
    const timer = setInterval(() => {
      index = (index + 1) % frames.length;
      process.stdout.write(`\r${frames[index]} ${label}`);
    }, 90);

    return () => {
      clearInterval(timer);
      process.stdout.write('\r\x1b[K');
    };
  }

  runCommandAndCheck(command, label, cwd) {
    return new Promise((resolve, reject) => {
      const stop = this.startSpinner(label);
      const child = spawn(command, {shell: true, cwd, stdio: ['ignore', 'pipe', 'pipe']});
      let stderr = '';
      let stdout = '';

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.stdout.on('data', (data) => {
        // Consumimos stdout para evitar bloqueos por buffer lleno, pero sin mostrarlo.
        stdout += data.toString();
      });

      child.on('error', (error) => {
        stop();
        this.error(`No se pudo iniciar ${label}: ${error.message}`);
      });

      child.on('close', (code) => {
        stop();
        if (code !== 0) {
          const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
          const extra = combined ? ` Detalle: ${combined}` : '';
          this.error(`Error al ejecutar ${label}. Código: ${code ?? 'desconocido'}.${extra}`);
          reject(new Error('command failed'));
          return;
        }

        this.log(`✅ ${label} completado.`);
        resolve();
      });
    });
  }

  compareFolders({tempDir, projectRoot, vlocityDir}) {
    const retrievedFiles = this.collectFiles(tempDir);
    const rows = [];

    for (const filePath of retrievedFiles) {
      const relative = path.relative(tempDir, filePath);
      const component = relative.split(path.sep)[0] || path.basename(relative);
      const name = path.basename(relative);

      const isVlocity = this.isVlocityFile({relative, vlocityDir, baseFile: undefined});
      const baseFile = this.resolveBaseFile({relative, projectRoot, vlocityDir});
      const isVlocityResolved = this.isVlocityFile({relative, vlocityDir, baseFile});

      const retrievedContent = this.readAndNormalize(filePath, {ignoreGlobalKey: isVlocity || isVlocityResolved});
      const baseContent =
        baseFile && fs.existsSync(baseFile)
          ? this.readAndNormalize(baseFile, {ignoreGlobalKey: isVlocity || isVlocityResolved})
          : null;

      const isDifferent = baseContent === null ? true : retrievedContent !== baseContent;
      rows.push({component, name, isDifferent});
    }

    return rows;
  }

  loadPackageDirectories(projectRoot) {
    const sfdxConfigPath = path.join(projectRoot, 'sfdx-project.json');
    try {
      if (!fs.existsSync(sfdxConfigPath)) {
        return [];
      }
      const config = JSON.parse(fs.readFileSync(sfdxConfigPath, 'utf8'));
      if (!Array.isArray(config.packageDirectories)) {
        return [];
      }
      return config.packageDirectories
        .map((pkg) => pkg.path)
        .filter((p) => typeof p === 'string' && p.length > 0);
    } catch (error) {
      this.warn(`No se pudo leer sfdx-project.json para resolver rutas: ${error.message}`);
      return [];
    }
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
    const candidates = [path.join(projectRoot, relative), path.join(vlocityDir, relative)];

    if (parts[0] === path.basename(vlocityDir)) {
      candidates.push(path.join(vlocityDir, ...parts.slice(1)));
    }

    for (const pkgDir of this.packageDirectories || []) {
      const pkgRoot = path.join(projectRoot, pkgDir);
      const relativeWithoutPkg = relative.startsWith(`${pkgDir}${path.sep}`)
        ? relative.slice(pkgDir.length + 1)
        : relative;

      candidates.push(path.join(pkgRoot, relativeWithoutPkg));
      candidates.push(path.join(pkgRoot, 'main', 'default', relativeWithoutPkg));
    }

    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  readAndNormalize(filePath, options = {}) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      this.warn(`No se pudo leer el archivo ${filePath}: ${error.message}`);
      return '';
    }
    return this.normalizeContent(content, options);
  }

  normalizeContent(content, options = {}) {
    const {ignoreGlobalKey = false} = options;
    const withoutXmlComments = content.replace(/<!--[\s\S]*?-->/g, '');
    const withoutBlockComments = withoutXmlComments.replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutLineComments = withoutBlockComments
      .replace(/^\s*#.*$/gm, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    const withoutGlobalKey = ignoreGlobalKey
      ? withoutLineComments
          .split(/\r?\n/)
          .filter((line) => !line.includes('GlobalKey'))
          .join('\n')
      : withoutLineComments;
    return withoutGlobalKey.replace(/\s+/g, '');
  }

  isVlocityFile({relative, vlocityDir, baseFile}) {
    const resolvedVlocityDir = path.resolve(vlocityDir || '');
    if (baseFile) {
      const resolvedBase = path.resolve(baseFile);
      if (resolvedBase.startsWith(resolvedVlocityDir)) {
        return true;
      }
    }

    const firstSegment = relative.split(path.sep)[0] || '';
    if (firstSegment.toLowerCase().includes('vlocity')) {
      return true;
    }

    return false;
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

export default PostValidate;
