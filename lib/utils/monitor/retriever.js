import fs from 'node:fs';
import path from 'node:path';
import { commandExists, runProcess } from './process.js';
export async function retrieveSalesforceCore(paths, orgAlias) {
    fs.mkdirSync(paths.manifest, { recursive: true });
    ensureSfdxProject(paths.orgRoot);
    await runProcess('sf', ['project', 'generate', 'manifest', '--from-org', orgAlias, '--excluded-metadata', 'StandardValueSet', '--name', 'metadelta-backup'], { cwd: paths.orgRoot });
    const generatedCandidates = [
        path.join(paths.orgRoot, 'metadelta-backup.xml'),
        path.join(paths.orgRoot, 'manifest', 'metadelta-backup.xml'),
    ];
    const packageXml = path.join(paths.manifest, 'package.xml');
    const generated = generatedCandidates.find((candidate) => fs.existsSync(candidate));
    if (generated) {
        fs.renameSync(generated, packageXml);
    }
    else if (!fs.existsSync(packageXml)) {
        throw new Error(`No se generó el manifest esperado para ${orgAlias}.`);
    }
    ensureSfdxProject(paths.salesforce);
    await runProcess('sf', ['project', 'retrieve', 'start', '--manifest', packageXml, '--target-org', orgAlias], {
        cwd: paths.salesforce,
    });
}
export async function exportVlocity(paths, orgAlias, options = {}) {
    const { jobPath: providedJobPath, required = false } = options;
    if (!commandExists('vlocity')) {
        const reason = 'El binario vlocity no está disponible en este ambiente.';
        if (required) {
            throw new Error(reason);
        }
        return { skipped: true, reason };
    }
    const jobPath = providedJobPath ? path.resolve(providedJobPath) : writeDefaultVlocityJob(paths);
    if (!fs.existsSync(jobPath)) {
        throw new Error(`No se encontró el job Vlocity: ${jobPath}`);
    }
    try {
        await runProcess('vlocity', ['-sfdx.username', orgAlias, '--projectPath', paths.vlocity, '-job', jobPath, 'packExportAllDefault'], { cwd: paths.orgRoot });
    }
    catch (error) {
        if (required) {
            throw error;
        }
        return {
            skipped: true,
            reason: `Vlocity omitido en este refresh:\n${error.message}`,
        };
    }
    return { skipped: false };
}
function writeDefaultVlocityJob(paths) {
    const jobPath = path.join(paths.temp, 'vlocity-export-all.yaml');
    fs.writeFileSync(jobPath, [
        'projectPath: .',
        'expansionPath: .',
        'maxDepth: -1',
        'useAllRelationships: true',
        'supportHeadersOnly: true',
        'supportForceDeploy: true',
        'includeSalesforceMetadata: false',
        'manifest:',
        '  - OmniScript',
        '  - DataRaptor',
        '  - FlexCard',
        '  - IntegrationProcedure',
        '  - EPC',
        '  - VlocityDataPack',
        '',
        '# packExportAllDefault uses Vlocity default DataPack queries.',
        '# The manifest documents the monitor scope and keeps the job compatible with custom overrides.',
        '',
    ].join('\n'));
    return jobPath;
}
function ensureSfdxProject(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'force-app', 'main', 'default'), { recursive: true });
    const sfdxProject = path.join(dir, 'sfdx-project.json');
    fs.writeFileSync(sfdxProject, JSON.stringify({
        packageDirectories: [{ path: 'force-app', default: true }],
        name: 'metadelta-monitor',
        namespace: '',
        sfdcLoginUrl: 'https://login.salesforce.com',
        sourceApiVersion: '65.0',
    }, null, 2));
}
