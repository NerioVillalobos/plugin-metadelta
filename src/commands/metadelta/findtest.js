const {SfCommand, Flags} = require('@salesforce/sf-plugins-core');
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {XMLParser, XMLBuilder} = require('fast-xml-parser');

const TEST_NAME_PATTERN = /TEST|Test_|test_|_TEST|TEST_|Test|_test/i;

const ensureArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
};

const getApexClasses = (directory) => {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith('.cls'))
    .map((file) => path.basename(file, '.cls'))
    .filter((file) => !TEST_NAME_PATTERN.test(file));
};

const getTestClasses = (directory) => {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith('.cls') && TEST_NAME_PATTERN.test(file))
    .map((file) => path.basename(file, '.cls'));
};

const getClassContent = (directory, className) => {
  const filePath = path.join(directory, `${className}.cls`);
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
};

const findTestReferences = (apexClass, testClassContent) => {
  const patterns = [
    new RegExp(`\\bnew\\s+${apexClass}\\b`, 'g'),
    new RegExp(`\\b${apexClass}\\.\\w+\\(`, 'g'),
    new RegExp(`\\b${apexClass}\\s+\\w+;`, 'g')
  ];
  return patterns.some((pattern) => pattern.test(testClassContent));
};

const findPrimaryTestClass = (apexClass, testClasses, directory) => {
  let bestMatch = null;
  let maxScore = 0;
  const possibleMatches = [];

  for (const testClass of testClasses) {
    const testClassContent = getClassContent(directory, testClass);
    let score = 0;

    if (testClass === `${apexClass}Test`) {
      return testClass;
    }

    if (testClassContent.includes(apexClass)) {
      score += 3;
    }
    if (findTestReferences(apexClass, testClassContent)) {
      score += 2;
    }

    if (score > 0) {
      possibleMatches.push({testClass, score});
    }
  }

  if (possibleMatches.length > 0) {
    possibleMatches.sort((a, b) => b.score - a.score);
    bestMatch = possibleMatches[0].testClass;
    maxScore = possibleMatches[0].score;
  }

  return maxScore > 0 ? bestMatch : null;
};

const mapApexToTests = (classesDirectory) => {
  const apexClasses = getApexClasses(classesDirectory);
  const testClasses = getTestClasses(classesDirectory);
  const mapping = {};

  for (const apexClass of apexClasses) {
    const primary = findPrimaryTestClass(apexClass, testClasses, classesDirectory);
    mapping[apexClass] = primary || '❌ No tiene pruebas asociadas';
  }

  return mapping;
};

const findProjectRoot = (startDir) => {
  let currentDir = startDir;
  const root = path.parse(currentDir).root;

  while (currentDir && currentDir !== root) {
    if (fs.existsSync(path.join(currentDir, 'sfdx-project.json'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return fs.existsSync(path.join(startDir, 'sfdx-project.json')) ? startDir : null;
};

const sanitizeFilename = (value) => {
  const replaced = String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-');
  return replaced.length > 0 ? replaced : 'package-apextest';
};

const detectGitBranch = () => {
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (result.status === 0) {
      const branch = result.stdout.trim();
      if (branch && branch !== 'HEAD') {
        return branch;
      }
    }
  } catch (error) {
    /* ignore */
  }
  return null;
};

const xmlEscape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const buildMappingXml = (mapping) => {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<ApexTestMapping>'];
  Object.entries(mapping).forEach(([apexClass, testClass]) => {
    lines.push(`    <apexClass name="${xmlEscape(apexClass)}">`);
    lines.push(`        <testClass>${xmlEscape(testClass)}</testClass>`);
    lines.push('    </apexClass>');
  });
  lines.push('</ApexTestMapping>', '');
  return lines.join('\n');
};

const readPackageXml = (manifestPath) => {
  const xmlContent = fs.readFileSync(manifestPath, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_' ,
    preserveOrder: false
  });
  return parser.parse(xmlContent);
};

const writePackageXml = (manifestPath, packageObject) => {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    suppressEmptyNode: true
  });
  const xml = builder.build(packageObject);
  const prolog = '<?xml version="1.0" encoding="UTF-8"?>\n';
  fs.writeFileSync(manifestPath, prolog + xml);
};

const ensureApexType = (packageObject) => {
  if (!packageObject.Package) {
    packageObject.Package = {};
  }
  let {types} = packageObject.Package;
  types = ensureArray(types);
  let apexType = types.find((item) => item.name === 'ApexClass');
  if (!apexType) {
    apexType = {members: [], name: 'ApexClass'};
    types.push(apexType);
  }
  apexType.members = ensureArray(apexType.members);
  packageObject.Package.types = types;
  return apexType;
};

const gatherTestsForDeployment = (apexMembers, mapping) => {
  const tests = new Set();
  for (const member of apexMembers) {
    if (TEST_NAME_PATTERN.test(member)) {
      tests.add(member);
      continue;
    }
    const mapped = mapping[member];
    if (mapped && mapped !== '❌ No tiene pruebas asociadas') {
      tests.add(mapped);
    }
  }
  return Array.from(tests);
};

class FindTest extends SfCommand {
  static description = 'Busca clases Apex y determina sus clases de prueba asociadas, con opciones de despliegue.';

  static flags = {
    'project-dir': Flags.string({
      summary: 'Ruta al directorio raíz del proyecto Salesforce (contiene sfdx-project.json).'
    }),
    'source-dir': Flags.string({
      summary: 'Ruta relativa o absoluta al directorio que contiene las clases Apex.',
      default: 'force-app/main/default/classes'
    }),
    xml: Flags.boolean({
      summary: 'Genera un archivo XML con el mapeo de clases y pruebas.'
    }),
    'xml-name': Flags.string({
      summary: 'Nombre del archivo XML a generar cuando se usa --xml.'
    }),
    branch: Flags.string({
      summary: 'Nombre de rama a usar cuando se genera un XML (sobrescribe la rama detectada).'
    }),
    deploy: Flags.string({
      summary: 'Ruta al package.xml existente que se utilizará para el despliegue.'
    }),
    'target-org': Flags.string({
      summary: 'Alias o usuario de la org destino para la ejecución de despliegue.'
    })
  };

  async run() {
    const {flags} = await this.parse(FindTest);

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

    const sourceDir = path.isAbsolute(flags['source-dir'])
      ? flags['source-dir']
      : path.join(projectRoot, flags['source-dir']);

    if (!fs.existsSync(sourceDir)) {
      this.error(`El directorio de clases Apex no existe: ${sourceDir}`);
    }

    const mapping = mapApexToTests(sourceDir);

    this.log('Lista de ApexClass con sus respectivas ApexTest:');
    Object.entries(mapping).forEach(([apexClass, testClass]) => {
      this.log(` ${apexClass} → ${testClass}`);
    });

    if (flags.xml) {
      const branchName = flags.branch || detectGitBranch();
      const baseName = flags['xml-name']
        ? sanitizeFilename(flags['xml-name'])
        : sanitizeFilename(branchName || 'package-apextest');
      const filename = baseName.endsWith('.xml') ? baseName : `${baseName}.xml`;
      const manifestDir = path.join(projectRoot, 'manifest');
      if (!fs.existsSync(manifestDir)) {
        fs.mkdirSync(manifestDir, {recursive: true});
      }
      const outputPath = path.join(manifestDir, filename);
      fs.writeFileSync(outputPath, buildMappingXml(mapping));
      this.log(`\nArchivo XML generado en: ${outputPath}`);
    }

    if (flags.deploy) {
      const manifestPath = path.isAbsolute(flags.deploy)
        ? flags.deploy
        : path.join(projectRoot, flags.deploy);

      if (!fs.existsSync(manifestPath)) {
        this.error(`El archivo package.xml indicado no existe: ${manifestPath}`);
      }

      let packageObject;
      try {
        packageObject = readPackageXml(manifestPath);
      } catch (error) {
        this.error(`No se pudo leer el package.xml: ${error.message}`);
      }

      const apexType = ensureApexType(packageObject);
      const orderedMembers = [...apexType.members];
      const existingMembers = new Set(orderedMembers);

      const testsToRun = gatherTestsForDeployment(orderedMembers, mapping);
      const apexWithoutTests = orderedMembers.filter((name) => !TEST_NAME_PATTERN.test(name) && (!mapping[name] || mapping[name] === '❌ No tiene pruebas asociadas'));
      if (apexWithoutTests.length > 0) {
        this.warn(`No se encontraron clases de prueba asociadas para: ${apexWithoutTests.join(', ')}`);
      }
      const missingTests = testsToRun.filter((testName) => !existingMembers.has(testName)).sort();
      const updatedMembers = [...orderedMembers, ...missingTests];
      const dedupedMembers = Array.from(new Set(updatedMembers));

      apexType.members = dedupedMembers;
      packageObject.Package.types = packageObject.Package.types.map((type) => {
        if (type.name === 'ApexClass') {
          return {...type, members: dedupedMembers};
        }
        return type;
      });

      try {
        writePackageXml(manifestPath, packageObject);
      } catch (error) {
        this.error(`No se pudo actualizar el package.xml: ${error.message}`);
      }

      if (testsToRun.length === 0) {
        this.log('\nNo se detectaron clases Apex en el package.xml o no se encontraron pruebas asociadas.');
      } else {
        this.log(`\nSe aseguraron ${testsToRun.length} clases de prueba en el package.xml.`);
      }

      const deployArgs = ['project', 'deploy', 'start', '--manifest', manifestPath];
      if (flags['target-org']) {
        deployArgs.push('--target-org', flags['target-org']);
      }

      if (testsToRun.length === 0) {
        deployArgs.push('-l', 'NoTestRun');
      } else {
        deployArgs.push('-l', 'RunSpecifiedTests');
        testsToRun.forEach((testName) => {
          deployArgs.push('-t', testName);
        });
      }

      deployArgs.push('--dry-run');

      this.log(`\nEjecutando: sf ${deployArgs.join(' ')}`);
      const result = spawnSync('sf', deployArgs, {stdio: 'inherit'});
      if (result.error) {
        this.warn(`Error al ejecutar sf project deploy start: ${result.error.message}`);
      } else if (result.status !== 0) {
        this.warn(`El comando sf project deploy start finalizó con código ${result.status}.`);
      }
    }
  }
}

module.exports = FindTest;
module.exports.default = FindTest;
