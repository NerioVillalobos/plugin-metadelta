const {SfCommand, Flags} = require('@salesforce/sf-plugins-core');
const fs = require('fs');
const path = require('path');
const {XMLParser, XMLBuilder} = require('fast-xml-parser');

const METADATA_NAMESPACE = 'http://soap.sforce.com/2006/04/metadata';

const toArray = (value) => {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const findProjectRoot = (startDir) => {
  let currentDir = path.resolve(startDir);
  const {root} = path.parse(currentDir);

  while (currentDir && currentDir !== root) {
    if (fs.existsSync(path.join(currentDir, 'sfdx-project.json'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return fs.existsSync(path.join(startDir, 'sfdx-project.json')) ? startDir : null;
};

const readProjectConfig = (projectRoot) => {
  const configPath = path.join(projectRoot, 'sfdx-project.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`No se pudo leer sfdx-project.json (${error.message}).`);
  }
};

const resolvePackageDirectory = (config) => {
  const directories = Array.isArray(config?.packageDirectories) ? config.packageDirectories : [];
  if (directories.length === 0) {
    throw new Error('El archivo sfdx-project.json no contiene la propiedad "packageDirectories".');
  }

  const defaultDir = directories.find((dir) => dir.default);
  const candidate = defaultDir || directories[0];

  if (!candidate?.path) {
    throw new Error('No se encontró un directorio de paquete válido en sfdx-project.json.');
  }

  return candidate.path;
};

const loadExcludeSet = (excludePath) => {
  if (!excludePath) {
    return new Set();
  }

  let content;
  try {
    content = fs.readFileSync(excludePath, 'utf8');
  } catch (error) {
    throw new Error(`No se pudo leer el archivo de exclusiones (${excludePath}): ${error.message}`);
  }

  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );
};

const buildOutputObject = (permissionSet, keepers) => {
  const {fieldPermissions, objectPermissions, classAccesses, pageAccesses} = keepers;
  const base = {};

  if (permissionSet['@_xmlns']) {
    base['@_xmlns'] = permissionSet['@_xmlns'];
  } else {
    base['@_xmlns'] = METADATA_NAMESPACE;
  }

  for (const tag of ['description', 'label', 'hasActivationRequired']) {
    if (permissionSet[tag] !== undefined) {
      base[tag] = permissionSet[tag];
    }
  }

  if (fieldPermissions.length > 0) {
    base.fieldPermissions = fieldPermissions;
  }
  if (objectPermissions.length > 0) {
    base.objectPermissions = objectPermissions;
  }
  if (classAccesses.length > 0) {
    base.classAccesses = classAccesses;
  }
  if (pageAccesses.length > 0) {
    base.pageAccesses = pageAccesses;
  }

  return {PermissionSet: base};
};

class CleanPs extends SfCommand {
  static id = 'metadelta:cleanps';
  static summary = 'Genera una versión depurada de un Permission Set filtrando por prefijo y exclusiones.';
  static description =
    'Lee un Permission Set desde la carpeta permissionsets del proyecto y crea una versión filtrada en la carpeta cleanps del proyecto.';

  static flags = {
    prefix: Flags.string({
      char: 'f',
      summary: 'Prefijo que deben tener los miembros para ser conservados.',
      required: true
    }),
    permissionset: Flags.string({
      char: 'p',
      summary: 'Nombre del Permission Set a filtrar (sin extensión o nombre de archivo).',
      required: true
    }),
    exclude: Flags.string({
      char: 'e',
      summary: 'Ruta al archivo de exclusiones (uno por línea).'
    }),
    output: Flags.string({
      char: 'o',
      summary: 'Nombre del archivo XML de salida que se creará dentro de la carpeta cleanps.'
    }),
    'project-dir': Flags.string({
      summary: 'Ruta al directorio raíz del proyecto (contiene sfdx-project.json).'
    })
  };

  async run() {
    const {flags} = await this.parse(CleanPs);
    const prefix = flags.prefix;
    const permissionSetName = flags.permissionset;
    const outputNameFlag = flags.output;

    let projectRoot;
    if (flags['project-dir']) {
      projectRoot = path.resolve(flags['project-dir']);
      if (!fs.existsSync(path.join(projectRoot, 'sfdx-project.json'))) {
        this.error('El directorio proporcionado en --project-dir no contiene un archivo sfdx-project.json.');
      }
    } else {
      projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
        this.error('No se encontró "sfdx-project.json" en el directorio actual ni en sus padres.');
      }
    }

    let projectConfig;
    try {
      projectConfig = readProjectConfig(projectRoot);
    } catch (error) {
      this.error(error.message);
    }

    let packagePath;
    try {
      packagePath = resolvePackageDirectory(projectConfig);
    } catch (error) {
      this.error(error.message);
    }

    const permissionSetDir = path.join(projectRoot, packagePath, 'main', 'default', 'permissionsets');
    if (!fs.existsSync(permissionSetDir) || !fs.statSync(permissionSetDir).isDirectory()) {
      this.error(`No se encontró el directorio de Permission Sets: ${permissionSetDir}`);
    }

    const normalizedName = permissionSetName.endsWith('.permissionset-meta.xml')
      ? permissionSetName
      : `${permissionSetName}.permissionset-meta.xml`;
    const inputPath = path.join(permissionSetDir, normalizedName);

    if (!fs.existsSync(inputPath)) {
      this.error(`No se encontró el archivo de Permission Set: ${inputPath}`);
    }

    const excludePath = flags.exclude
      ? path.isAbsolute(flags.exclude)
        ? flags.exclude
        : path.join(projectRoot, flags.exclude)
      : null;

    let excludeSet;
    try {
      excludeSet = loadExcludeSet(excludePath);
    } catch (error) {
      this.error(error.message);
    }

    let xmlContent;
    try {
      xmlContent = fs.readFileSync(inputPath, 'utf8');
    } catch (error) {
      this.error(`No se pudo leer el Permission Set (${inputPath}): ${error.message}`);
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      preserveOrder: false
    });

    let parsed;
    try {
      parsed = parser.parse(xmlContent);
    } catch (error) {
      this.error(`No se pudo parsear el Permission Set (${inputPath}): ${error.message}`);
    }

    const permissionSet = parsed?.PermissionSet;
    if (!permissionSet) {
      this.error('El archivo XML no contiene un nodo PermissionSet válido.');
    }

    const startsWithPrefix = (value) => typeof value === 'string' && value.startsWith(prefix);

    const fieldPermissions = toArray(permissionSet.fieldPermissions).filter((entry) => {
      const fieldValue = entry?.field;
      if (typeof fieldValue !== 'string') {
        return false;
      }
      const parts = fieldValue.split('.');
      const fieldName = parts.length > 1 ? parts[1] : parts[0];
      return startsWithPrefix(fieldName) && !excludeSet.has(fieldName);
    });

    const objectPermissions = toArray(permissionSet.objectPermissions).filter((entry) => {
      const objectName = entry?.object;
      return startsWithPrefix(objectName) && !excludeSet.has(objectName);
    });

    const classAccesses = toArray(permissionSet.classAccesses).filter((entry) => {
      const className = entry?.apexClass;
      return startsWithPrefix(className) && !excludeSet.has(className);
    });

    const pageAccesses = toArray(permissionSet.pageAccesses).filter((entry) => {
      const pageName = entry?.apexPage;
      return startsWithPrefix(pageName) && !excludeSet.has(pageName);
    });

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      suppressEmptyNode: true,
      declaration: {
        encoding: 'UTF-8'
      }
    });

    const outputObject = buildOutputObject(permissionSet, {
      fieldPermissions,
      objectPermissions,
      classAccesses,
      pageAccesses
    });

    const xmlOutput = builder.build(outputObject);

    const cleanpsDir = path.join(projectRoot, 'cleanps');
    try {
      fs.mkdirSync(cleanpsDir, {recursive: true});
    } catch (error) {
      this.error(`No se pudo crear el directorio de salida (${cleanpsDir}): ${error.message}`);
    }

    const baseName = normalizedName.replace(/\.permissionset-meta\.xml$/i, '');
    const defaultOutputName = `${baseName}_${prefix}_filtered.permissionset-meta.xml`;
    const finalOutputName = outputNameFlag
      ? outputNameFlag.endsWith('.xml')
        ? outputNameFlag
        : `${outputNameFlag}.xml`
      : defaultOutputName;

    const outputPath = path.join(cleanpsDir, finalOutputName);

    try {
      fs.writeFileSync(outputPath, xmlOutput.endsWith('\n') ? xmlOutput : `${xmlOutput}\n`, 'utf8');
    } catch (error) {
      this.error(`No se pudo escribir el archivo de salida (${outputPath}): ${error.message}`);
    }

    this.log(`Permission Set filtrado generado en: ${outputPath}`);
  }
}

module.exports = CleanPs;
