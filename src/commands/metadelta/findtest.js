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

const DIRECT_TEST_SUFFIXES = [
  'test',
  '_test',
  'tests',
  '_tests',
  'testclass',
  '_testclass',
  'testcls',
  '_testcls',
  'testcase',
  '_testcase'
];

const isDirectTestMatch = (apexClass, testClass) => {
  if (!testClass) {
    return false;
  }

  const normalizedApex = apexClass.toLowerCase();
  const normalizedTest = testClass.toLowerCase();

  return DIRECT_TEST_SUFFIXES.some((suffix) => normalizedTest === `${normalizedApex}${suffix}`);
};

const findPrimaryTestClass = (apexClass, testClasses, directory) => {
  let bestSuggestion = null;

  for (const testClass of testClasses) {
    if (isDirectTestMatch(apexClass, testClass)) {
      return {testClass, confidence: 'exact'};
    }

    const testClassContent = getClassContent(directory, testClass);
    let score = 0;

    if (testClassContent.includes(apexClass)) {
      score += 3;
    }
    if (findTestReferences(apexClass, testClassContent)) {
      score += 2;
    }

    if (score > 0) {
      if (!bestSuggestion || score > bestSuggestion.score) {
        bestSuggestion = {testClass, confidence: 'suggested', score};
      }
    }
  }

  return bestSuggestion;
};

const mapApexToTests = (classesDirectory) => {
  const apexClasses = getApexClasses(classesDirectory);
  const testClasses = getTestClasses(classesDirectory);
  const mapping = {};
  const suggestions = [];

  for (const apexClass of apexClasses) {
    const primary = findPrimaryTestClass(apexClass, testClasses, classesDirectory);

    if (primary && primary.confidence === 'exact') {
      mapping[apexClass] = {testClass: primary.testClass, confidence: 'exact'};
    } else {
      mapping[apexClass] = {testClass: null, confidence: 'none'};

      if (primary && primary.confidence === 'suggested') {
        mapping[apexClass].suggestion = primary.testClass;
        suggestions.push({apexClass, testClass: primary.testClass});
      }
    }
  }

  return {mapping, suggestions};
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

const NO_TEST_FOUND_MESSAGE = '❌ No tiene pruebas asociadas';

const formatMappingDisplay = (entry) => {
  if (entry && entry.confidence === 'exact' && entry.testClass) {
    return entry.testClass;
  }

  return NO_TEST_FOUND_MESSAGE;
};

const resolvePath = (baseDir, candidate) => {
  if (!candidate) {
    return null;
  }
  return path.isAbsolute(candidate) ? candidate : path.join(baseDir, candidate);
};

const readPackageXml = (manifestPath) => {
  const xmlContent = fs.readFileSync(manifestPath, 'utf8');

  if (/<<<<<<<|=======|>>>>>>>/.test(xmlContent)) {
    const conflictError = new Error(
      'El package.xml contiene marcadores de conflicto (<<<<<<<, =======, >>>>>>>).'
    );
    conflictError.name = 'ManifestConflictError';
    throw conflictError;
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      preserveOrder: false
    });
    return parser.parse(xmlContent);
  } catch (error) {
    if (error instanceof SyntaxError && error.message.includes("Unexpected token '<<'")) {
      const syntax = new Error(
        'No se pudo analizar el package.xml porque contiene marcadores de conflicto o caracteres inválidos.'
      );
      syntax.name = 'ManifestSyntaxError';
      throw syntax;
    }

    throw error;
  }
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

const gatherTestsForDeployment = (
  apexMembers,
  mapping,
  classesDirectory,
  availableApexClasses = new Set()
) => {
  const testsToRun = new Set();
  const testsMissingInManifest = new Set();
  const missingTestFiles = new Set();
  const apexWithoutTests = new Set();
  const missingApexClasses = new Set();
  const lowConfidenceMatches = new Map();

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

    const mappingEntry = mapping[member];

    if (!mappingEntry || mappingEntry.confidence !== 'exact' || !mappingEntry.testClass) {
      if (mappingEntry && mappingEntry.suggestion) {
        lowConfidenceMatches.set(member, mappingEntry.suggestion);
      }

      apexWithoutTests.add(member);
      continue;
    }

    const mapped = mappingEntry.testClass;
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
    missingApexClasses: Array.from(missingApexClasses),
    lowConfidenceMatches
  };
};

class FindTest extends SfCommand {
  static id = 'metadelta:findtest';
  static summary = 'Busca clases Apex y determina sus clases de prueba asociadas, con opciones de despliegue.';
  static description = 'Busca clases Apex y determina sus clases de prueba asociadas, con opciones de despliegue.';

  static flags = {
    'project-dir': Flags.string({
      summary: 'Ruta al directorio raíz del proyecto Salesforce (contiene sfdx-project.json).'
    }),
    'source-dir': Flags.string({
      summary: 'Ruta relativa o absoluta al directorio que contiene las clases Apex.',
      default: 'force-app/main/default/classes'
    }),
    'xml-name': Flags.string({
      summary: 'Ruta al package.xml existente que se usará para el análisis o despliegue.'
    }),
    deploy: Flags.string({
      summary: 'Ruta al package.xml existente que se utilizará para el despliegue.'
    }),
    org: Flags.string({
      char: 'o',
      summary: 'Alias o usuario de la org destino (usa la predeterminada si se omite).'
    }),
    'target-org': Flags.string({
      summary: 'Alias o usuario de la org destino para la ejecución de despliegue.'
    }),
    'dry-run': Flags.boolean({
      summary: 'Asegura que el despliegue se ejecute con --dry-run (valor predeterminado).',
      allowNo: true
    }),
    'run-deploy': Flags.boolean({
      summary: 'Ejecuta el despliegue sin agregar la bandera --dry-run.'
    })
  };

  async run() {
    const {flags} = await this.parse(FindTest);

    if (flags['target-org'] && flags.org && flags['target-org'] !== flags.org) {
      this.error('Los valores de --target-org y --org no pueden diferir.');
    }

    const targetOrg = flags['target-org'] || flags.org;
    const explicitDryRun = flags['dry-run'];
    const wantsRunDeploy = Boolean(flags['run-deploy']);

    if (wantsRunDeploy && explicitDryRun === true) {
      this.error('No puede usar --run-deploy junto con --dry-run. Use --no-dry-run o quite --run-deploy.');
    }

    const useDryRun = wantsRunDeploy ? false : explicitDryRun !== undefined ? explicitDryRun : true;

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

    const {mapping: apexTestMapping, suggestions} = mapApexToTests(sourceDir);
    const availableApexClasses = new Set(Object.keys(apexTestMapping));

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
        if (error instanceof Error && ['ManifestConflictError', 'ManifestSyntaxError'].includes(error.name)) {
          this.error(error.message);
        }

        this.error(`No se pudo leer el package.xml: ${error instanceof Error ? error.message : error}`);
      }

      if (!manifestData.Package) {
        this.error('El package.xml no contiene un nodo <Package>.');
      }

      this.log(`\nUsando package.xml existente: ${manifestFlagPath}`);

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
          this.log(` ${apexClass} → ${formatMappingDisplay(apexTestMapping[apexClass])}`);
        } else {
          this.log(` ${apexClass} → ❌ Clase Apex no encontrada en el directorio fuente`);
        }
      });
    } else {
      Object.entries(apexTestMapping).forEach(([apexClass, entry]) => {
        this.log(` ${apexClass} → ${formatMappingDisplay(entry)}`);
      });
    }

    const relevantSuggestions = manifestProvidesFilter
      ? suggestions.filter(({apexClass}) => classesToReport?.includes(apexClass))
      : suggestions;

    if (relevantSuggestions.length > 0) {
      this.log('');
      this.warn('No se encontraron coincidencias de nombre exactas para algunas clases Apex. Posibles coincidencias:');
      relevantSuggestions.forEach(({apexClass, testClass}) => {
        this.warn(` - ${apexClass}: posible prueba ${testClass}`);
      });
    }

    if (flags.deploy || manifestExists) {
      if (!manifestFlagPath) {
        this.error('Debe proporcionar la ruta al package.xml existente mediante --deploy o --xml-name.');
      }

      if (!manifestExists) {
        this.error(`El archivo package.xml indicado no existe: ${manifestFlagPath}`);
      }

      let packageObject = manifestData;
      if (!packageObject) {
        try {
          packageObject = readPackageXml(manifestFlagPath);
        } catch (error) {
          if (error instanceof Error && ['ManifestConflictError', 'ManifestSyntaxError'].includes(error.name)) {
            this.error(error.message);
          }

          this.error(`No se pudo leer el package.xml: ${error instanceof Error ? error.message : error}`);
        }
      }

      if (!packageObject.Package) {
        this.error('El package.xml no contiene un nodo <Package>.');
      }

      const originalTypes = packageObject.Package.types ?? [];
      const types = ensureArray(originalTypes);
      const typesIsArray = Array.isArray(originalTypes);
      const apexType = types.find((type) => type.name === 'ApexClass');

      const deployArgs = ['project', 'deploy', 'start', '--manifest', manifestFlagPath];
      if (targetOrg) {
        deployArgs.push('--target-org', targetOrg);
      }

      if (!apexType) {
        this.log('\nEl package.xml no incluye clases Apex. Se ejecutará el despliegue con NoTestRun.');
        deployArgs.push('-l', 'NoTestRun');
        if (useDryRun) {
          deployArgs.push('--dry-run');
        }
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
        missingApexClasses,
        lowConfidenceMatches
      } = gatherTestsForDeployment(members, apexTestMapping, sourceDir, availableApexClasses);

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
        const details = apexWithoutTests
          .map((apexClass) => {
            const suggested = lowConfidenceMatches.get(apexClass);
            return suggested ? `${apexClass} (posible: ${suggested})` : apexClass;
          })
          .join(', ');

        blockingWarnings.push(`No se encontraron clases de prueba asociadas para: ${details}`);
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

      if (useDryRun) {
        deployArgs.push('--dry-run');
      }

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
