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

const MANAGED_NAMESPACE_PATTERN = /^\w+__/;

const stripManagedNamespace = (name = '') => name.replace(MANAGED_NAMESPACE_PATTERN, '');

const findManualStepDoc = (baseDir, identifier) => {
  if (!identifier || !baseDir || !fs.existsSync(baseDir)) {
    return null;
  }

  const stack = [baseDir];
  const normalizedIdentifier = identifier.toUpperCase();

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = fs.readdirSync(currentDir, {withFileTypes: true});

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.toUpperCase().includes(normalizedIdentifier)) {
        return entryPath;
      }
    }
  }

  return null;
};

const levenshteinDistance = (a = '', b = '') => {
  const aLength = a.length;
  const bLength = b.length;

  if (aLength === 0) {
    return bLength;
  }
  if (bLength === 0) {
    return aLength;
  }

  const matrix = Array.from({length: aLength + 1}, (_, index) => [index]);
  for (let j = 0; j <= bLength; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= aLength; i += 1) {
    for (let j = 1; j <= bLength; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1
        );
      }
    }
  }

  return matrix[aLength][bLength];
};

const suggestSimilarClasses = (missingClass, availableClasses, limit = 5) => {
  const normalizedMissing = stripManagedNamespace(missingClass).toLowerCase();
  const candidates = Array.from(availableClasses).map((candidate) => {
    const normalizedCandidate = stripManagedNamespace(candidate).toLowerCase();
    const distance = levenshteinDistance(normalizedMissing, normalizedCandidate);
    return {candidate, distance};
  });

  candidates.sort((a, b) => {
    if (a.distance === b.distance) {
      return a.candidate.localeCompare(b.candidate);
    }
    return a.distance - b.distance;
  });

  const maxDistance = Math.max(3, Math.floor(normalizedMissing.length / 2));

  return candidates
    .filter(({distance}) => distance <= maxDistance)
    .slice(0, limit)
    .map(({candidate}) => candidate);
};

const COMMUNITY_CONTROLLERS = new Set([
  'ChangePasswordController',
  'CommunitiesLandingController',
  'CommunitiesLoginController',
  'CommunitiesSelfRegConfirmController',
  'CommunitiesSelfRegController',
  'ForgotPasswordController',
  'LightningForgotPasswordController',
  'LightningLoginFormController',
  'LightningSelfRegisterController',
  'MicrobatchSelfRegController',
  'MyProfilePageController',
  'SiteLoginController',
  'SiteRegisterController'
]);

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

const gatherTestsForDeployment = (
  apexMembers,
  manifestMembers,
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

  const existingMembers = new Set(manifestMembers);

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
    'run-deploy': Flags.boolean({
      summary: 'Ejecuta el despliegue sin agregar la bandera --dry-run.'
    }),
    'only-local': Flags.boolean({
      summary: 'Ignora el manifest y analiza únicamente las clases Apex presentes en el repositorio local.'
    }),
    'ignore-managed': Flags.boolean({
      summary: 'Omite miembros de paquetes gestionados (namespace__Clase).',
      default: true,
      allowNo: true
    }),
    'ignore-communities': Flags.boolean({
      summary: 'Omite controladores estándar de Communities.',
      default: true,
      allowNo: true
    }),
    verbose: Flags.boolean({
      summary: 'Muestra avisos detallados de clases omitidas por filtros o ausencia local.'
    }),
    json: Flags.boolean({
      summary: 'Emite un resumen en formato JSON con métricas de filtrado.'
    })
  };

  async run() {
    const {flags} = await this.parse(FindTest);

    if (flags['target-org'] && flags.org && flags['target-org'] !== flags.org) {
      this.error('Los valores de --target-org y --org no pueden diferir.');
    }

    const targetOrg = flags['target-org'] || flags.org;
    const useDryRun = !flags['run-deploy'];

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
    const filesystemClasses = new Set(Object.keys(apexTestMapping));

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
    const manifestIdentifier = manifestFlagPath
      ? path.basename(manifestFlagPath, path.extname(manifestFlagPath) || undefined)
      : null;
    const docsDir = path.join(projectRoot, 'docs');
    const manualDocPath = manifestIdentifier ? findManualStepDoc(docsDir, manifestIdentifier) : null;

    if (manifestFlagPath && !manifestExists) {
      const relativeManifestPath = path.relative(projectRoot, manifestFlagPath);
      if (manualDocPath) {
        const relativeManualPath = path.relative(projectRoot, manualDocPath);
        this.log(`\nNo existe el archivo XML indicado: ${relativeManifestPath}.`);
        this.log(
          `Se detectaron pasos manuales en ${relativeManualPath}. Ejecute esos pasos manuales sin utilizar --dry-run ni --run-deploy.`
        );
        return;
      }

      this.error(`No existe el archivo XML indicado: ${relativeManifestPath}`);
    }

    if (manualDocPath) {
      const relativeManualPath = path.relative(projectRoot, manualDocPath);
      this.log(
        `\nSe detectó documentación de pasos manuales relacionada (${relativeManualPath}). Revísala antes de continuar.`
      );
    }

    let manifestData = null;
    let manifestApexMembers = null;

    if (manifestExists && !flags['only-local']) {
      try {
        manifestData = readPackageXml(manifestFlagPath);
      } catch (error) {
        this.error(`No se pudo leer el package.xml: ${error.message}`);
      }

      if (!manifestData.Package) {
        this.error('El package.xml no contiene un nodo <Package>.');
      }

      if (flags['xml-name']) {
        this.log('\nSe utilizará el package.xml indicado en --xml-name.');
      }
      const manifestTypes = ensureArray(manifestData.Package.types ?? []);
      const manifestApexType = manifestTypes.find((type) => type.name === 'ApexClass');
      manifestApexMembers = manifestApexType ? ensureArray(manifestApexType.members ?? []) : [];
    }

    const ignoreManaged = flags['ignore-managed'] !== undefined ? flags['ignore-managed'] : true;
    const ignoreCommunities = flags['ignore-communities'] !== undefined
      ? flags['ignore-communities']
      : true;
    const verbose = Boolean(flags.verbose);

    const initialClassSet = new Set();
    let usedManifest = Boolean(manifestApexMembers);
    const manifestNonTestMembers = usedManifest
      ? ensureArray(manifestApexMembers).filter((name) => name && !TEST_NAME_PATTERN.test(name))
      : [];

    if (usedManifest) {
      (manifestApexMembers ?? []).forEach((name) => {
        if (name && !TEST_NAME_PATTERN.test(name)) {
          initialClassSet.add(name);
        }
      });
    } else {
      usedManifest = false;
      Array.from(filesystemClasses).forEach((name) => initialClassSet.add(name));
    }

    if (flags['only-local']) {
      usedManifest = false;
      initialClassSet.clear();
      Array.from(filesystemClasses).forEach((name) => initialClassSet.add(name));
    }

    const inputClasses = Array.from(initialClassSet).sort();

    const ignoredManaged = new Set();
    const ignoredCommunities = new Set();

    let filteredClasses = inputClasses.filter((className) => {
      if (ignoreManaged && MANAGED_NAMESPACE_PATTERN.test(className)) {
        ignoredManaged.add(className);
        return false;
      }
      if (ignoreCommunities && COMMUNITY_CONTROLLERS.has(className)) {
        ignoredCommunities.add(className);
        return false;
      }
      return true;
    });

    const filteredCount = filteredClasses.length;

    const missingLocal = filteredClasses.filter((className) => !filesystemClasses.has(className));
    const finalClasses = filteredClasses
      .filter((className) => filesystemClasses.has(className))
      .sort();

    const summaryLabel = usedManifest ? 'Clases (manifest)' : 'Clases (filesystem)';
    this.log(
      `${summaryLabel}: ${inputClasses.length} · Filtradas: ${filteredCount} · Presentes en repo: ${finalClasses.length}`
    );

    if (verbose) {
      const logLimitedWarnings = (items, formatter, extraMessage) => {
        if (items.length === 0) {
          return;
        }
        const preview = items.slice(0, 10);
        preview.forEach((item) => this.warn(formatter(item)));
        if (items.length > preview.length) {
          this.warn(`... (${items.length - preview.length} adicionales)`);
        }
        if (extraMessage) {
          this.warn(extraMessage);
        }
      };

      logLimitedWarnings(
        Array.from(ignoredManaged).sort(),
        (cls) => `Se omitió ${cls} por namespace gestionado (__).`
      );
      logLimitedWarnings(
        Array.from(ignoredCommunities).sort(),
        (cls) => `Se omitió ${cls} por pertenecer a los controladores estándar de Communities.`
      );
      logLimitedWarnings(
        missingLocal.sort(),
        (cls) => `Se omitió ${cls} porque no existe en el filesystem.`,
        'Revise su manifest o use --only-local.'
      );
    }

    if (finalClasses.length === 0) {
      if (usedManifest) {
        if (manifestNonTestMembers.length === 0) {
          const continuationMessage = targetOrg
            ? 'El package.xml indicado no contiene clases Apex para validar. Se continuará con NoTestRun.'
            : 'El package.xml indicado no contiene clases Apex para validar.';
          this.log(continuationMessage);
        } else {
          const presentInRepo = manifestNonTestMembers.filter((name) => filesystemClasses.has(name));

          if (presentInRepo.length === 0) {
            this.log('No se encontraron en el repositorio las clases Apex declaradas en el manifest:');
            manifestNonTestMembers.forEach((missingClass) => {
              const suggestionsForMissing = suggestSimilarClasses(missingClass, filesystemClasses);
              const suggestionText = suggestionsForMissing.length > 0
                ? ` (posibles coincidencias: ${suggestionsForMissing.join(', ')})`
                : '';
              this.log(` - ${missingClass}${suggestionText}`);
            });
            this.error('Actualiza el package.xml o sincroniza las clases Apex antes de continuar.');
          } else {
            this.warn('Todas las clases Apex del manifest fueron omitidas por los filtros aplicados.');
            this.warn('Ajusta las banderas --ignore-managed o --ignore-communities para incluirlas.');
            return;
          }
        }
      } else {
        this.error(
          'El manifest no tiene clases presentes en el repo local. Usa --only-local o pasa un manifest válido.'
        );
      }
    }

    const metrics = {
      inputCount: inputClasses.length,
      filteredCount,
      finalCount: finalClasses.length,
      ignoredManaged: Array.from(ignoredManaged).sort(),
      ignoredCommunities: Array.from(ignoredCommunities).sort(),
      missingLocal: missingLocal.sort()
    };

    if (finalClasses.length > 0) {
      this.log('Lista de ApexClass con sus respectivas ApexTest:');
      finalClasses.forEach((apexClass) => {
        this.log(` ${apexClass} → ${formatMappingDisplay(apexTestMapping[apexClass])}`);
      });
    }

    const relevantSuggestions = suggestions.filter(({apexClass}) => finalClasses.includes(apexClass));

    if (relevantSuggestions.length > 0) {
      this.log('');
      this.warn('No se encontraron coincidencias de nombre exactas para algunas clases Apex. Posibles coincidencias:');
      relevantSuggestions.forEach(({apexClass, testClass}) => {
        this.warn(` - ${apexClass}: posible prueba ${testClass}`);
      });
    }

    if (flags.json) {
      this.log(JSON.stringify(metrics, null, 2));
    }

    if (flags.deploy || manifestExists) {
      if (!manifestFlagPath) {
        this.error('Debe proporcionar la ruta al package.xml existente mediante --deploy o --xml-name.');
      }

      if (!manifestExists) {
        this.error(`El archivo package.xml indicado no existe: ${manifestFlagPath}`);
      }

      if (!targetOrg) {
        this.log(
          '\nNo se proporcionó --org ni --target-org. Se omite la ejecución de sf project deploy start. '
            + 'Indique una org para ejecutar el dry-run o el despliegue.'
        );
        return;
      }

      const packageObject = manifestData ?? readPackageXml(manifestFlagPath);

      if (!packageObject.Package) {
        this.error('El package.xml no contiene un nodo <Package>.');
      }

      const originalTypes = packageObject.Package.types ?? [];
      const types = ensureArray(originalTypes);
      const typesIsArray = Array.isArray(originalTypes);
      const apexType = types.find((type) => type.name === 'ApexClass');

      const deployArgs = ['project', 'deploy', 'start', '--manifest', manifestFlagPath, '--target-org', targetOrg];

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
      } = gatherTestsForDeployment(finalClasses, members, apexTestMapping, sourceDir, availableApexClasses);

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
