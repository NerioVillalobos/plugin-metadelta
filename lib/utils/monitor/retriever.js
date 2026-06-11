import fs from 'node:fs';
import path from 'node:path';
import { commandExists, runProcess } from './process.js';
import { isIgnoredMonitorFile, isSampleInputJsonError } from './ignore.js';
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
    const { required = false } = options;
    if (!commandExists('vlocity')) {
        const reason = 'El binario vlocity no está disponible en este ambiente.';
        if (required) {
            throw new Error(reason);
        }
        return { skipped: true, reason };
    }
    try {
        await runProcess('vlocity', ['-sfdx.username', orgAlias, '--projectPath', paths.vlocity, '-nojob', 'packExportAllDefault'], { cwd: paths.orgRoot });
    }
    catch (error) {
        removeIgnoredMonitorFiles(paths.vlocity);
        if (isSampleInputJsonError(error.message)) {
            return {
                skipped: false,
                warning: 'Vlocity export tuvo errores en *_SampleInputJson.json; esos archivos fueron ignorados por el monitor.',
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
    return { skipped: false };
}
function removeIgnoredMonitorFiles(root) {
    if (!fs.existsSync(root)) {
        return;
    }
    for (const filePath of collectFiles(root)) {
        if (isIgnoredMonitorFile(filePath)) {
            fs.rmSync(filePath, { force: true });
        }
    }
}
function collectFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFiles(fullPath));
        }
        else if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
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
