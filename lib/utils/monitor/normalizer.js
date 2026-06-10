import fs from 'node:fs';
import path from 'node:path';
const volatileLinePatterns = [
    /LastModifiedDate/i,
    /CreatedDate/i,
    /sourceOrgUrl/i,
    /packageVersions/i,
    /VlocityDataPackId/i,
    /VlocityRecordSourceKey/i,
    /SalesforceId/i,
    /GlobalKey/i,
    /\b[a-zA-Z0-9]{15,18}\b/,
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/,
];
export function normalizeTree(root) {
    if (!fs.existsSync(root)) {
        return;
    }
    for (const filePath of collectFiles(root)) {
        normalizeFile(filePath);
    }
}
function collectFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'vlocity-temp') {
            continue;
        }
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
function normalizeFile(filePath) {
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    }
    catch {
        return;
    }
    const normalized = content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .filter((line) => !volatileLinePatterns.some((pattern) => pattern.test(line)))
        .map((line) => line.replace(/\s+$/g, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n');
    if (normalized !== content) {
        fs.writeFileSync(filePath, normalized);
    }
}
