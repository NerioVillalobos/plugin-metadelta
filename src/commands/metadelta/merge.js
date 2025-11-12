const {SfCommand, Flags} = require('@salesforce/sf-plugins-core');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {XMLParser, XMLBuilder} = require('fast-xml-parser');

class Merge extends SfCommand {
  static id = 'metadelta:merge';
  static summary = 'Combina archivos de manifiesto en un paquete global sin duplicados.';
  static description = 'Busca archivos XML dentro del directorio manifest cuyo nombre contenga el valor proporcionado y genera un globalpackage.xml con la unión de sus metadatos.';

  static flags = {
    'xml-name': Flags.string({
      char: 'x',
      summary: 'Cadena que deben contener los archivos XML a combinar',
      required: true
    }),
    directory: Flags.string({
      char: 'd',
      summary: 'Directorio donde se encuentran los archivos manifest',
      default: 'manifest'
    }),
    output: Flags.string({
      char: 'o',
      summary: 'Nombre del archivo XML resultante',
      default: 'globalpackage.xml'
    }),
    partial: Flags.boolean({
      summary: 'Combina únicamente los manifests pendientes de merge entre la rama base y la rama del sprint.',
      default: false
    }),
    'sprint-branch': Flags.string({
      summary: 'Rama del sprint que contiene los manifests recientes (requerida junto con --partial).'
    }),
    'base-branch': Flags.string({
      summary: 'Rama base que ya llegó a producción.',
      default: 'master'
    })
  };

  async run() {
    const {flags} = await this.parse(Merge);
    const xmlName = flags['xml-name'];
    const manifestDir = path.resolve(flags.directory);
    const manifestRelativeForGit = toGitPath(path.relative(process.cwd(), manifestDir) || '.');

    this.ensureDirectory(manifestDir);

    if (flags.partial && !flags['sprint-branch']) {
      this.error('Para usar --partial debes indicar --sprint-branch <rama-del-sprint>.');
    }

    const manifests = flags.partial
      ? this.getManifestFilesFromSprint({
          manifestDir,
          manifestRelativeForGit,
          xmlName,
          baseBranch: flags['base-branch'],
          sprintBranch: flags['sprint-branch']
        })
      : this.getAllMatchingManifestFiles({manifestDir, xmlName});

    if (manifests.length === 0) {
      if (flags.partial) {
        this.error(
          `No se encontraron manifests pendientes para ${xmlName} en el rango ${flags['base-branch']}..${flags['sprint-branch']}.`
        );
      }
      this.error(`No se encontraron archivos XML en ${manifestDir} que contengan '${xmlName}'.`);
    }

    const xmlFiles = manifests.map((entry) => entry.absolutePath);

    const parser = new XMLParser({ignoreAttributes: false, processEntities: true});
    const typeMembersMap = new Map();
    let maxVersion = null;

    for (const filePath of xmlFiles) {
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (error) {
        this.warn(`No se pudo leer el archivo ${filePath}: ${error.message}`);
        continue;
      }

      let parsed;
      try {
        parsed = parser.parse(content);
      } catch (error) {
        this.warn(`No se pudo parsear el archivo ${filePath}: ${error.message}`);
        continue;
      }

      const pkg = parsed?.Package;
      if (!pkg) {
        this.warn(`El archivo ${filePath} no contiene un nodo Package válido.`);
        continue;
      }

      const types = pkg.types ? (Array.isArray(pkg.types) ? pkg.types : [pkg.types]) : [];
      for (const type of types) {
        const typeName = type?.name;
        if (!typeName) {
          continue;
        }
        const members = type.members;
        const membersArray = Array.isArray(members) ? members : [members];
        if (!typeMembersMap.has(typeName)) {
          typeMembersMap.set(typeName, new Set());
        }
        const membersSet = typeMembersMap.get(typeName);
        for (const member of membersArray) {
          if (member) {
            membersSet.add(member);
          }
        }
      }

      const version = pkg.version;
      if (version !== undefined && version !== null) {
        const versionNumber = Number(version);
        if (!Number.isNaN(versionNumber)) {
          if (maxVersion === null || versionNumber > maxVersion) {
            maxVersion = versionNumber;
          }
        } else if (typeof version === 'string') {
          if (maxVersion === null || version.localeCompare(String(maxVersion), undefined, {numeric: true}) > 0) {
            maxVersion = version;
          }
        }
      }
    }

    if (typeMembersMap.size === 0) {
      this.error('No se encontraron tipos de metadatos válidos para combinar.');
    }

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressEmptyNode: true,
      declaration: {
        encoding: 'UTF-8'
      }
    });

    const typesArray = Array.from(typeMembersMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([typeName, membersSet]) => ({
        members: Array.from(membersSet).sort((a, b) => a.localeCompare(b)),
        name: typeName
      }));

    const versionValue =
      maxVersion === null
        ? undefined
        : typeof maxVersion === 'number'
        ? maxVersion.toFixed(1)
        : String(maxVersion);

    const packageObject = {
      Package: {
        '@_xmlns': 'http://soap.sforce.com/2006/04/metadata',
        types: typesArray,
        ...(versionValue ? {version: versionValue} : {})
      }
    };

    const xmlOutput = builder.build(packageObject);
    const outputPath = path.join(manifestDir, flags.output);

    try {
      fs.writeFileSync(outputPath, xmlOutput, 'utf8');
    } catch (error) {
      this.error(`No se pudo escribir el archivo de salida ${outputPath}: ${error.message}`);
    }

    this.log(`Archivo combinado generado en: ${outputPath}`);
  }

  ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      this.error(`El directorio ${dirPath} no existe o no es un directorio válido.`);
    }
  }

  getAllMatchingManifestFiles({manifestDir, xmlName}) {
    return fs
      .readdirSync(manifestDir)
      .filter((file) => file.endsWith('.xml') && file.includes(xmlName))
      .map((file) => ({
        relativePath: file,
        absolutePath: path.join(manifestDir, file)
      }));
  }

  getManifestFilesFromSprint({manifestDir, manifestRelativeForGit, xmlName, baseBranch, sprintBranch}) {
    try {
      runGit(['merge-base', baseBranch, sprintBranch]).trim();
    } catch (error) {
      this.error(`No se pudo calcular el merge-base entre ${baseBranch} y ${sprintBranch}.`);
    }

    let diffOutput;
    const compareRange = `${baseBranch}..${sprintBranch}`;
    try {
      diffOutput = runGit(['diff', '--name-only', compareRange, '--', manifestRelativeForGit], false);
    } catch (error) {
      this.error(`No se pudo obtener los cambios de git para ${manifestRelativeForGit}.`);
    }

    const trimmedPath = manifestRelativeForGit.replace(/\/+$/, '');
    const normalizedPrefix = trimmedPath === '' || trimmedPath === '.' ? '' : `${trimmedPath}/`;
    const manifestEntries = [];
    const seen = new Set();

    for (const rawLine of diffOutput.split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      let relative;
      if (normalizedPrefix) {
        if (!line.startsWith(normalizedPrefix)) {
          continue;
        }
        relative = line.slice(normalizedPrefix.length);
      } else {
        relative = line;
      }
      const baseName = path.basename(relative);
      if (!baseName.endsWith('.xml') || !baseName.includes(xmlName)) {
        continue;
      }

      const normalizedRelative = normalizePathForFs(relative);
      if (seen.has(normalizedRelative)) {
        continue;
      }
      seen.add(normalizedRelative);
      manifestEntries.push({
        relativePath: normalizedRelative,
        absolutePath: path.join(manifestDir, normalizedRelative)
      });
    }

    return manifestEntries;
  }
}

module.exports = Merge;

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
