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

const loadIncludeSet = (includePath) => {
  if (!includePath) {
    return new Set();
  }

  let content;
  try {
    content = fs.readFileSync(includePath, 'utf8');
  } catch (error) {
    throw new Error(`No se pudo leer el archivo indicado en --exclude (${includePath}): ${error.message}`);
  }

  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );
};

const FILTER_TARGETS = [
  {
    key: 'applicationVisibilities',
    extractValues: (entry) => [entry?.application]
  },
  {
    key: 'classAccesses',
    extractValues: (entry) => [entry?.apexClass]
  },
  {
    key: 'customPermissions',
    extractValues: (entry) => [entry?.name]
  },
  {
    key: 'fieldPermissions',
    extractValues: (entry) => {
      const fieldValue = entry?.field;
      if (typeof fieldValue !== 'string') {
        return [];
      }

      const [objectName, fieldName] = fieldValue.split('.', 2);
      const values = [fieldValue];
      if (objectName) {
        values.push(objectName);
      }
      if (fieldName) {
        values.push(fieldName);
      }
      return values;
    }
  },
  {
    key: 'objectPermissions',
    extractValues: (entry) => [entry?.object]
  },
  {
    key: 'pageAccesses',
    extractValues: (entry) => [entry?.apexPage]
  },
  {
    key: 'recordTypeVisibilities',
    extractValues: (entry) => {
      const recordTypeValue = entry?.recordType;
      if (typeof recordTypeValue !== 'string') {
        return [];
      }

      const [objectName, recordTypeName] = recordTypeValue.split('.', 2);
      const values = [recordTypeValue];
      if (objectName) {
        values.push(objectName);
      }
      if (recordTypeName) {
        values.push(recordTypeName);
      }
      return values;
    }
  },
  {
    key: 'tabSettings',
    extractValues: (entry) => [entry?.tab]
  },
  {
    key: 'userPermissions',
    extractValues: (entry) => [entry?.name]
  }
];

const buildOutputObject = (originalPermissionSet, filteredSections) => {
  const output = {};

  if (originalPermissionSet['@_xmlns']) {
    output['@_xmlns'] = originalPermissionSet['@_xmlns'];
  } else {
    output['@_xmlns'] = METADATA_NAMESPACE;
  }

  for (const [key, value] of Object.entries(originalPermissionSet)) {
    if (key === '@_xmlns') {
      continue;
    }

    if (filteredSections.has(key)) {
      const sectionEntries = filteredSections.get(key);
      if (sectionEntries.length > 0) {
        output[key] = sectionEntries;
      }
      continue;
    }

    output[key] = value;
  }

  for (const [key, entries] of filteredSections.entries()) {
    if (output[key] === undefined && entries.length > 0) {
      output[key] = entries;
    }
  }

  return {PermissionSet: output};
};

class CleanPs extends SfCommand {
  static id = 'metadelta:cleanps';
  static summary = 'Genera una versión depurada de un Permission Set filtrando por coincidencias y una lista opcional.';
  static description =
    'Lee un Permission Set desde la carpeta permissionsets del proyecto y crea una versión filtrada en la carpeta cleanps del proyecto.';

  static flags = {
    prefix: Flags.string({
      char: 'f',
      summary: 'Fragmento que deben contener los miembros para conservarse.',
      required: true
    }),
    permissionset: Flags.string({
      char: 'p',
      summary: 'Nombre del Permission Set a filtrar (sin extensión o nombre de archivo).',
      required: true
    }),
    exclude: Flags.string({
      char: 'e',
      summary: 'Ruta al archivo con nombres exactos a conservar (uno por línea).'
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

    let includeSet;
    try {
      includeSet = loadIncludeSet(excludePath);
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

    const matchesCriteria = (value) => {
      if (typeof value !== 'string' || value.length === 0) {
        return false;
      }

      if (prefix && value.includes(prefix)) {
        return true;
      }

      return includeSet.has(value);
    };

    const filteredSections = new Map();

    for (const {key, extractValues} of FILTER_TARGETS) {
      const entries = toArray(permissionSet[key]);
      if (entries.length === 0) {
        continue;
      }

      const filteredEntries = entries.filter((entry) => {
        const candidates = extractValues(entry).filter((candidate) => typeof candidate === 'string');
        return candidates.some((candidate) => matchesCriteria(candidate));
      });

      filteredSections.set(key, filteredEntries);
    }

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      suppressEmptyNode: true,
      declaration: {
        encoding: 'UTF-8'
      }
    });

    const outputObject = buildOutputObject(permissionSet, filteredSections);

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
