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
  if (value === undefined || value === null || value === '') {
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

const classFileExists = (directory, className) => {
  if (!className) {
    return false;
  }
  const filePath = path.join(directory, `${className}.cls`);
  return fs.existsSync(filePath);
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

const resolvePath = (baseDir, candidate) => {
  if (!candidate) {
    return null;
  }
  return path.isAbsolute(candidate) ? candidate : path.join(baseDir, candidate);
};

const readPackageXml = (manifestPath) => {
  const xmlContent = fs.readFileSync(manifestPath, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
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
  if (!packageObject['?xml']) {
    packageObject['?xml'] = {
      '@_version': '1.0',
      '@_encoding': 'UTF-8'
    };
  }
  const xml = builder.build(packageObject);
  const output = xml.endsWith('\n') ? xml : `${xml}\n`;
  fs.writeFileSync(manifestPath, output);
};

const gatherTestsForDeployment = (apexMembers, mapping, classesDirectory, availableApexClasses = new Set()) => {
  const testsToRun = new Set();
  const testsMissingInManifest = new Set();
  const missingTestFiles = new Set();
  const apexWithoutTests = new Set();
  const missingApexClasses = new Set();

  const existingMembers = new Set(apexMembers);

  for (const member of apexMembers) {
    if (TEST_NAME_PATTERN.test(member)) {
      testsToRun.add(member);
      if (!classFileExists(classesDirectory, member)) {
        missingTestFiles.add(member);
      }
      continue;
    }

    if (!availableApexClasses.has(member)) {
      missingApexClasses.add(member);
      continue;
    }

    const mapped = mapping[member];
    if (!mapped || mapped === '❌ No tiene pruebas asociadas') {
      apexWithoutTests.add(member);
      continue;
    }

    testsToRun.add(mapped);

    if (!classFileExists(classesDirectory, mapped)) {
      missingTestFiles.add(mapped);
      continue;
    }

    if (!existingMembers.has(mapped)) {
      testsMissingInManifest.add(mapped);
    }
  }

  return {
    testsToRun: Array.from(testsToRun),
    testsMissingInManifest: Array.from(testsMissingInManifest),
    missingTestFiles: Array.from(missingTestFiles),
    apexWithoutTests: Array.from(apexWithoutTests),
    missingApexClasses: Array.from(missingApexClasses)
  };
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
    const availableApexClasses = new Set(Object.keys(mapping));

    const deployPath = flags.deploy ? resolvePath(projectRoot, flags.deploy) : null;
    const xmlNameResolved = flags['xml-name']
      ? resolvePath(
          projectRoot,
          flags['xml-name'].endsWith('.xml') ? flags['xml-name'] : `${flags['xml-name']}.xml`
        )
      : null;

    if (flags.deploy && flags['xml-name'] && deployPath && xmlNameResolved) {
      if (fs.existsSync(xmlNameResolved) && path.resolve(xmlNameResolved) !== path.resolve(deployPath)) {
        this.error('Los valores de --deploy y --xml-name apuntan a archivos distintos.');
      }
    }

    const manifestFlagPath = deployPath || xmlNameResolved;
    const manifestExists = manifestFlagPath && fs.existsSync(manifestFlagPath);
    let manifestData = null;
    let manifestApexMembers = null;

    if (manifestExists) {
      try {
        manifestData = readPackageXml(manifestFlagPath);
      } catch (error) {
        this.error(`No se pudo leer el package.xml: ${error.message}`);
      }

      if (!manifestData.Package) {
        this.error('El package.xml no contiene un nodo <Package>.');
      }

      const manifestTypes = ensureArray(manifestData.Package.types ?? []);
      const manifestApexType = manifestTypes.find((type) => type.name === 'ApexClass');
      manifestApexMembers = manifestApexType ? ensureArray(manifestApexType.members ?? []) : [];
    }

    const manifestProvidesFilter = manifestApexMembers !== null;
    const classesToReport = manifestProvidesFilter
      ? Array.from(
          new Set(
            (manifestApexMembers ?? [])
              .filter((name) => name)
              .filter((name) => !TEST_NAME_PATTERN.test(name))
          )
        )
      : null;

    this.log('Lista de ApexClass con sus respectivas ApexTest:');
    if (manifestProvidesFilter) {
      if (classesToReport.length === 0) {
        this.log(' (El package.xml no incluye clases Apex para evaluar)');
      }
      classesToReport.forEach((apexClass) => {
        if (availableApexClasses.has(apexClass)) {
          this.log(` ${apexClass} → ${mapping[apexClass]}`);
        } else {
          this.log(` ${apexClass} → ❌ Clase Apex no encontrada en el directorio fuente`);
        }
      });
    } else {
      Object.entries(mapping).forEach(([apexClass, testClass]) => {
        this.log(` ${apexClass} → ${testClass}`);
      });
    }

    if (flags.xml) {
      const xmlNameFlag = flags['xml-name'];
      const branchName = flags.branch || detectGitBranch();
      let outputPath = null;

      if (xmlNameFlag) {
        const normalized = xmlNameFlag.endsWith('.xml') ? xmlNameFlag : `${xmlNameFlag}.xml`;
        const resolved = path.isAbsolute(normalized)
          ? normalized
          : path.join(projectRoot, normalized);

        if (manifestExists && path.resolve(resolved) === path.resolve(manifestFlagPath)) {
          this.log('\nEl archivo indicado en --xml-name se usará como package.xml existente. No se generará un XML de mapeo aparte.');
        } else {
          outputPath = resolved;
        }
      } else {
        const baseName = sanitizeFilename(branchName || 'package-apextest');
        const filename = baseName.endsWith('.xml') ? baseName : `${baseName}.xml`;
        const manifestDir = path.join(projectRoot, 'manifest');
        if (!fs.existsSync(manifestDir)) {
          fs.mkdirSync(manifestDir, {recursive: true});
        }
        outputPath = path.join(manifestDir, filename);
      }

      if (outputPath) {
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, {recursive: true});
        }
        fs.writeFileSync(outputPath, buildMappingXml(mapping));
        this.log(`\nArchivo XML generado en: ${outputPath}`);
      }
    }

    if (flags.deploy || manifestExists) {
      if (!manifestFlagPath) {
        this.error('Debe proporcionar la ruta al package.xml existente mediante --deploy o --xml-name.');
      }

      if (!manifestExists) {
        this.error(`El archivo package.xml indicado no existe: ${manifestFlagPath}`);
      }

      const packageObject = manifestData ?? readPackageXml(manifestFlagPath);

      if (!packageObject.Package) {
        this.error('El package.xml no contiene un nodo <Package>.');
      }

      const originalTypes = packageObject.Package.types ?? [];
      const types = ensureArray(originalTypes);
      const typesIsArray = Array.isArray(originalTypes);
      const apexType = types.find((type) => type.name === 'ApexClass');

      const deployArgs = ['project', 'deploy', 'start', '--manifest', manifestFlagPath];
      if (flags['target-org']) {
        deployArgs.push('--target-org', flags['target-org']);
      }

      if (!apexType) {
        this.log('\nEl package.xml no incluye clases Apex. Se ejecutará el despliegue con NoTestRun.');
        deployArgs.push('-l', 'NoTestRun', '--dry-run');
        this.log(`\nEjecutando: sf ${deployArgs.join(' ')}`);
        const result = spawnSync('sf', deployArgs, {stdio: 'inherit'});
        if (result.error) {
          this.warn(`Error al ejecutar sf project deploy start: ${result.error.message}`);
        } else if (result.status !== 0) {
          this.warn(`El comando sf project deploy start finalizó con código ${result.status}.`);
        }
        return;
      }

      const originalMembers = apexType.members ?? [];
      const members = ensureArray(originalMembers);

      const {
        testsToRun,
        testsMissingInManifest,
        missingTestFiles,
        apexWithoutTests,
        missingApexClasses
      } = gatherTestsForDeployment(members, mapping, sourceDir, availableApexClasses);

      if (testsMissingInManifest.length > 0) {
        const updatedMembers = Array.from(new Set([...members, ...testsMissingInManifest]));

        apexType.members = updatedMembers;

        const updatedTypes = types.map((type) => {
          if (type.name === 'ApexClass') {
            return {...type, members: updatedMembers};
          }
          return type;
        });

        packageObject.Package.types = typesIsArray ? updatedTypes : updatedTypes[0];

        try {
          writePackageXml(manifestFlagPath, packageObject);
          this.log(`\nSe agregaron ${testsMissingInManifest.length} clases de prueba al package.xml.`);
        } catch (error) {
          this.error(`No se pudo actualizar el package.xml: ${error.message}`);
        }
      } else {
        this.log('\nNo fue necesario modificar el package.xml.');
      }

      const blockingWarnings = [];
      if (missingApexClasses.length > 0) {
        blockingWarnings.push(
          `No se encontraron archivos .cls para las clases Apex indicadas en el manifest: ${missingApexClasses.join(', ')}`
        );
      }
      if (apexWithoutTests.length > 0) {
        blockingWarnings.push(`No se encontraron clases de prueba asociadas para: ${apexWithoutTests.join(', ')}`);
      }
      if (missingTestFiles.length > 0) {
        blockingWarnings.push(
          `No se encontraron archivos .cls para las clases de prueba requeridas: ${missingTestFiles.join(', ')}`
        );
      }

      blockingWarnings.forEach((message) => this.warn(message));

      if (blockingWarnings.length > 0) {
        this.log('\nSe omite la ejecución de sf project deploy start porque faltan clases de prueba requeridas.');
        return;
      }

      if (testsToRun.length === 0) {
        this.log('\nNo se detectaron clases Apex a validar. Se ejecutará NoTestRun.');
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
