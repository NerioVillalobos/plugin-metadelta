const {SfCommand, Flags} = require('@salesforce/sf-plugins-core');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const {readdir, readFile, stat, mkdir, writeFile} = fs.promises;

const MANUAL_FILE_REGEX = /^OSS-?FSL-(Base|\d+)-(PRE|POST)\.md$/i;
const BANNER_LINE = '===============================';

class ManualCollect extends SfCommand {
  static summary = 'Genera un consolidado de pasos manuales en formato markdown.';

  static flags = {
    docs: Flags.string({
      char: 'd',
      summary: 'Directorio que contiene los archivos markdown de pasos manuales.',
      required: true,
    }),
    output: Flags.string({
      char: 'o',
      summary: 'Ruta del archivo markdown generado.',
      required: true,
    }),
    partial: Flags.boolean({
      summary: 'Procesa solo los archivos tocados en un sprint específico.',
      default: false,
    }),
    all: Flags.boolean({
      summary: 'Procesa todos los archivos del directorio.',
      default: false,
    }),
    'sprint-branch': Flags.string({
      summary: 'Rama del sprint a analizar (requerida para --partial).',
    }),
    'sprint-name': Flags.string({
      summary: 'Nombre del sprint para mostrar en el markdown.',
    }),
    'base-branch': Flags.string({
      summary: 'Rama base desde la cual se creó el sprint.',
      default: 'master',
    }),
    'order-by': Flags.string({
      summary: 'Origen de la fecha usada para ordenar (mtime o git).',
      options: ['mtime', 'git'],
      default: 'mtime',
    }),
  };

  async run() {
    const {flags} = await this.parse(ManualCollect);

    const docsDir = path.resolve(flags.docs);
    const outputFile = path.resolve(flags.output);
    const docsRelativeForGit = toGitPath(path.relative(process.cwd(), docsDir) || '.');

    await this.ensureDirectory(docsDir);

    if (flags.partial && flags.all) {
      this.error('No puedes combinar --partial con --all.');
    }

    const mode = flags.partial ? 'partial' : 'all';

    if (flags.partial && !flags['sprint-branch']) {
      this.error('Para usar --partial debes indicar --sprint-branch <rama-del-sprint>.');
    }

    let relativeFiles;
    if (flags.partial) {
      relativeFiles = await this.getFilesFromSprint({
        docsRelativeForGit,
        sprintBranch: flags['sprint-branch'],
        baseBranch: flags['base-branch'],
      });
    } else {
      relativeFiles = await this.getAllManualFiles(docsDir);
    }

    if (relativeFiles.length === 0) {
      const rangeDescription = flags.partial
        ? `${flags['base-branch']}..${flags['sprint-branch']}`
        : docsRelativeForGit;
      this.error(
        flags.partial
          ? `No se encontraron documentos de pasos manuales en ${flags.docs} para el rango ${rangeDescription}. Verifica que el sprint haya mergeado archivos .md en ${flags.docs}.`
          : `No se encontraron documentos de pasos manuales en ${flags.docs}.`
      );
    }

    const entries = await this.buildManualStepMetadata({
      docsDir,
      relativeFiles,
      orderBy: flags['order-by'] || 'mtime',
    });

    const markdown = renderManualSteps({
      entries,
      mode,
      sprintBranch: flags['sprint-branch'],
      sprintName: flags['sprint-name'],
    });

    await mkdir(path.dirname(outputFile), {recursive: true});
    await writeFile(outputFile, markdown, 'utf8');

    this.log(`Manual steps written to ${outputFile}`);
  }

  async ensureDirectory(dirPath) {
    try {
      const stats = await stat(dirPath);
      if (!stats.isDirectory()) {
        this.error(`La ruta ${dirPath} no es un directorio válido.`);
      }
    } catch (error) {
      this.error(`No se pudo acceder al directorio ${dirPath}.`);
    }
  }

  async getAllManualFiles(docsDir) {
    const entries = await readdir(docsDir, {withFileTypes: true});
    return entries
      .filter((entry) => entry.isFile() && isManualStepFile(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  async getFilesFromSprint({docsRelativeForGit, sprintBranch, baseBranch}) {
    let mergeBase;
    try {
      mergeBase = runGit(['merge-base', baseBranch, sprintBranch]).trim();
    } catch (error) {
      this.error(`No se pudo calcular el merge-base entre ${baseBranch} y ${sprintBranch}.`);
    }

    let logOutput;
    try {
      logOutput = runGit(['log', '--name-only', `${mergeBase}..${sprintBranch}`, '--', docsRelativeForGit], false);
    } catch (error) {
      this.error(`No se pudo obtener el log de git para ${docsRelativeForGit}.`);
    }

    const manualFiles = new Set();
    const trimmedDocsPath = docsRelativeForGit.replace(/\/+$/, '');
    const normalizedPrefix = trimmedDocsPath === '' || trimmedDocsPath === '.' ? '' : `${trimmedDocsPath}/`;

    for (const rawLine of logOutput.split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      if (line.startsWith(normalizedPrefix)) {
        const relativePath = line.slice(normalizedPrefix.length);
        const baseName = path.basename(relativePath);
        if (isManualStepFile(baseName)) {
          manualFiles.add(relativePath);
        }
      }
    }

    return Array.from(manualFiles).sort();
  }

  async buildManualStepMetadata({docsDir, relativeFiles, orderBy}) {
    const results = [];

    for (const relativePath of relativeFiles) {
      const normalizedRelativePath = normalizePathForFs(relativePath);
      const absolutePath = path.resolve(docsDir, normalizedRelativePath);
      const baseName = path.basename(normalizedRelativePath);

      if (!isManualStepFile(baseName)) {
        continue;
      }

      const normalizedName = normalizeManualStepName(baseName);
      const parsed = parseManualStepName(normalizedName);

      let fileStat;
      try {
        fileStat = await stat(absolutePath);
      } catch (error) {
        continue;
      }

      if (!fileStat.isFile()) {
        continue;
      }

      const gitDate = orderBy === 'git' ? getGitDate(absolutePath) : undefined;
      const dateIso = (gitDate ?? fileStat.mtime.toISOString()).trim();
      const displayDate = dateIso ? dateIso.slice(0, 10) : '';
      const content = await readFile(absolutePath, 'utf8');

      results.push({
        project: parsed.project,
        story: parsed.story,
        phase: parsed.phase,
        dateIso,
        displayDate,
        relativePath: normalizedRelativePath,
        absolutePath,
        content,
      });
    }

    const phaseOrder = {PRE: 0, POST: 1};
    results.sort((a, b) => {
      const phaseDiff = phaseOrder[a.phase] - phaseOrder[b.phase];
      if (phaseDiff !== 0) {
        return phaseDiff;
      }

      const dateDiff = new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime();
      if (dateDiff !== 0) {
        return dateDiff;
      }

      return a.story.localeCompare(b.story);
    });

    return results;
  }
}

function isManualStepFile(fileName) {
  return MANUAL_FILE_REGEX.test(fileName);
}

function normalizeManualStepName(fileName) {
  return fileName.replace(/^OSSFSL/i, 'OSS-FSL');
}

function parseManualStepName(fileName) {
  const withoutExtension = fileName.replace(/\.md$/i, '');
  const parts = withoutExtension.split('-');
  if (parts.length < 4) {
    throw new Error(`Nombre de archivo inválido: ${fileName}`);
  }

  const project = `${parts[0]}-${parts[1]}`.toUpperCase();
  const story = parts[2].toUpperCase();
  const phase = parts[3].toUpperCase();

  return {project, story, phase};
}

function renderManualSteps({entries, mode, sprintBranch, sprintName}) {
  const lines = [];

  lines.push('# Manual Steps');
  if (sprintName) {
    lines.push(`> Sprint: ${sprintName}`);
  }
  if (sprintBranch) {
    lines.push(`> Sprint branch: ${sprintBranch}`);
  }
  lines.push(`> Mode: ${mode}`);
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Índice');

  for (const entry of entries) {
    const anchor = `${entry.story.toLowerCase()}--${entry.phase.toLowerCase()}`;
    lines.push(`- [${entry.story} / ${entry.phase}](#${anchor})`);
  }

  for (const entry of entries) {
    lines.push('');
    lines.push(`## ${entry.story} / ${entry.phase}`);
    lines.push('');
    lines.push('<!-- metadelta:manual-step -->');
    lines.push(BANNER_LINE);

    const metadataParts = [
      `Fecha: ${entry.displayDate}`,
      `Historia: ${entry.project}-${entry.story}`,
      `Paso: ${entry.phase}`,
    ];

    if (sprintName) {
      metadataParts.push(`Sprint: ${sprintName}`);
    }

    lines.push(`| ${metadataParts.join(' | ')} |`);
    lines.push(BANNER_LINE);
    lines.push('');
    lines.push(entry.content);
    if (!entry.content.endsWith('\n')) {
      lines.push('');
    }
    lines.push('');
  }

  return lines.join('\n');
}

function getGitDate(absolutePath) {
  const gitPath = toGitPath(path.relative(process.cwd(), absolutePath));
  try {
    return runGit(['log', '-1', '--format=%ci', '--', gitPath]).trim();
  } catch (error) {
    return undefined;
  }
}

function runGit(args, trim = true) {
  const output = execFileSync('git', args, {encoding: 'utf8'});
  return trim ? output.trim() : output;
}

function toGitPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function normalizePathForFs(relativePath) {
  return relativePath.split('/').join(path.sep);
}

module.exports = ManualCollect;
module.exports.default = ManualCollect;

