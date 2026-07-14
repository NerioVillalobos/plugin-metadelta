import fs from 'node:fs';
import path from 'node:path';
import {commandExists, runProcess} from './process.js';
import {isIgnoredMonitorFile, isSampleInputJsonError} from './ignore.js';

export async function retrieveSalesforceCore(paths, orgAlias, options = {}) {
  const {manifestPath} = options;
  fs.mkdirSync(paths.manifest, {recursive: true});
  ensureSfdxProject(paths.orgRoot);

  const packageXml = path.join(paths.manifest, 'package.xml');
  if (manifestPath) {
    fs.copyFileSync(manifestPath, packageXml);
  } else {
    await runProcess(
      'sf',
      ['project', 'generate', 'manifest', '--from-org', orgAlias, '--excluded-metadata', 'StandardValueSet', '--name', 'metadelta-backup'],
      {cwd: paths.orgRoot}
    );

    const generatedCandidates = [
      path.join(paths.orgRoot, 'metadelta-backup.xml'),
      path.join(paths.orgRoot, 'manifest', 'metadelta-backup.xml'),
    ];
    const generated = generatedCandidates.find((candidate) => fs.existsSync(candidate));
    if (generated) {
      fs.renameSync(generated, packageXml);
    } else if (!fs.existsSync(packageXml)) {
      throw new Error(`No se generó el manifest esperado para ${orgAlias}.`);
    }
  }

  ensureSfdxProject(paths.salesforce);
  await runProcess('sf', ['project', 'retrieve', 'start', '--manifest', packageXml, '--target-org', orgAlias], {
    cwd: paths.salesforce,
  });
}

export async function exportVlocity(paths, orgAlias, options = {}) {
  const {required = false, jobPath: providedJobPath} = options;
  if (!commandExists('vlocity')) {
    const reason = 'El binario vlocity no está disponible en este ambiente.';
    if (required) {
      throw new Error(reason);
    }
    return {skipped: true, reason};
  }

  const jobPath = providedJobPath ? writeScopedVlocityMonitorJob(paths, providedJobPath) : writeVlocityMonitorJob(paths);
  const vlocityJobPath = toVlocityRelativePath(paths.orgRoot, jobPath);
  const vlocityProjectPath = toVlocityRelativePath(paths.orgRoot, paths.vlocity);
  const command = providedJobPath ? 'packExport' : 'packExportAllDefault';
  try {
    await runProcess(
      'vlocity',
      ['-sfdx.username', orgAlias, '-job', vlocityJobPath, '--projectPath', vlocityProjectPath, command],
      {cwd: paths.orgRoot}
    );
  } catch (error) {
    removeIgnoredMonitorFiles(paths.vlocity);
    const hasExportedFiles = hasMonitorFiles(paths.vlocity);
    if (isSampleInputJsonError(error.message)) {
      return {
        skipped: false,
        warning: 'Vlocity export tuvo errores en *_SampleInputJson.json; esos archivos fueron ignorados por el monitor.',
      };
    }
    if (hasExportedFiles) {
      return {
        skipped: false,
        warning: `Vlocity export terminó con errores, pero se conservaron los DataPacks exportados parcialmente:\n${error.message}`,
      };
    }
    if (required) {
      throw error;
    }
    return {
      skipped: true,
      reason: `Vlocity omitido en este refresh:\n${error.message}`,
    };
  }
  removeIgnoredMonitorFiles(paths.vlocity);
  return {skipped: false};
}

export function writeVlocityMonitorJob(paths) {
  fs.mkdirSync(paths.manifest, {recursive: true});
  const jobPath = path.join(paths.manifest, 'monitor-vlocity-export.yaml');
  const yaml = [
    `projectPath: ${yamlScalar(toVlocityRelativePath(paths.orgRoot, paths.vlocity))}`,
    'continueAfterError: true',
    'compileOnBuild: false',
    'maxDepth: 0',
    'autoUpdateSettings: true',
    '',
    'manifest: []',
    '',
    'OverrideSettings:',
    '  DataPacks:',
    '    Catalog: {}',
    '    Product2:',
    '      MaxDeploy: 1',
    '',
  ].join('\n');
  fs.writeFileSync(jobPath, yaml, 'utf8');
  return jobPath;
}

export function writeScopedVlocityMonitorJob(paths, sourceJobPath) {
  fs.mkdirSync(paths.manifest, {recursive: true});
  const jobPath = path.join(paths.manifest, `monitor-${path.basename(sourceJobPath)}`);
  const sourceYaml = fs.readFileSync(sourceJobPath, 'utf8');
  const yamlWithoutProjectPath = sourceYaml
    .split(/\r?\n/)
    .filter((line) => !/^projectPath\s*:/i.test(line.trim()))
    .join('\n');
  const yaml = [
    `projectPath: ${yamlScalar(toVlocityRelativePath(paths.orgRoot, paths.vlocity))}`,
    ...missingScopedJobDefaults(yamlWithoutProjectPath),
    '',
    yamlWithoutProjectPath.trim(),
  ].join('\n');
  fs.writeFileSync(jobPath, yaml, 'utf8');
  return jobPath;
}

function missingScopedJobDefaults(yaml) {
  const defaults = [
    ['continueAfterError', 'true'],
    ['compileOnBuild', 'false'],
    ['maxDepth', '0'],
    ['autoUpdateSettings', 'true'],
  ];
  return defaults
    .filter(([key]) => !new RegExp(`^\\s*${key}\\s*:`, 'im').test(yaml))
    .map(([key, value]) => `${key}: ${value}`);
}

function yamlScalar(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function toVlocityRelativePath(from, target) {
  const relative = path.relative(from, target) || '.';
  return relative.split(path.sep).join('/');
}

function hasMonitorFiles(root) {
  if (!fs.existsSync(root)) {
    return false;
  }
  return collectFiles(root).some((filePath) => !isIgnoredMonitorFile(filePath));
}

function removeIgnoredMonitorFiles(root) {
  if (!fs.existsSync(root)) {
    return;
  }
  for (const filePath of collectFiles(root)) {
    if (isIgnoredMonitorFile(filePath)) {
      fs.rmSync(filePath, {force: true});
    }
  }
}

function collectFiles(dir) {
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function ensureSfdxProject(dir) {
  fs.mkdirSync(dir, {recursive: true});
  fs.mkdirSync(path.join(dir, 'force-app', 'main', 'default'), {recursive: true});
  const sfdxProject = path.join(dir, 'sfdx-project.json');
  fs.writeFileSync(
    sfdxProject,
    JSON.stringify(
      {
        packageDirectories: [{path: 'force-app', default: true}],
        name: 'metadelta-monitor',
        namespace: '',
        sfdcLoginUrl: 'https://login.salesforce.com',
        sourceApiVersion: '65.0',
      },
      null,
      2
    )
  );
}
