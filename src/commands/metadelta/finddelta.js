import {Command, Flags} from '@oclif/core';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {XMLParser} from 'fast-xml-parser';

const DEFAULT_API_VERSION = '63.0';

class FindDelta extends Command {
  static id = 'metadelta:finddelta';
  static summary = 'Genera manifiestos delta (Core y Vlocity) comparando dos ramas.';
  static description = 'Compara dos ramas con git diff y genera package.xml/yaml de diferencias, incluyendo destructivos para eliminaciones.';

  static flags = {
    from: Flags.string({summary: 'Rama origen para el diff', required: true}),
    to: Flags.string({summary: 'Rama destino para el diff', required: true}),
    xml: Flags.string({summary: 'Archivo package.xml destino para incorporar componentes detectados'}),
    yaml: Flags.string({summary: 'Archivo package.yaml destino para incorporar datapacks detectados'})
  };

  async run() {
    const {flags} = await this.parse(FindDelta);
    const fromBranch = flags.from;
    const toBranch = flags.to;

    const diffLines = getGitDiffNameStatus(fromBranch, toBranch);
    if (diffLines.length === 0) {
      this.log(`No se detectaron diferencias entre ${fromBranch} y ${toBranch}.`);
      return;
    }

    const additions = [];
    const deletions = [];

    for (const line of diffLines) {
      const entry = parseDiffLine(line);
      if (!entry) continue;

      if (entry.status.startsWith('R')) {
        additions.push(entry.newPath);
        deletions.push(entry.oldPath);
        continue;
      }

      if (entry.status === 'D') {
        deletions.push(entry.path);
      } else {
        additions.push(entry.path);
      }
    }

    const activeCore = dedupeComponents(additions.map(resolveCoreComponent).filter(Boolean));
    const activeVlocity = dedupeComponents(additions.map(resolveVlocityComponent).filter(Boolean));
    const destructiveCore = dedupeComponents(deletions.map(resolveCoreComponent).filter(Boolean));
    const destructiveVlocity = dedupeComponents(deletions.map(resolveVlocityComponent).filter(Boolean));

    const manifestDir = path.resolve('manifest');
    fs.mkdirSync(manifestDir, {recursive: true});
    const branchKey = sanitizeForFilename(fromBranch);

    const packagePath = path.join(manifestDir, `${branchKey}.xml`);
    const vlocityPath = path.join(manifestDir, `${branchKey}.yaml`);
    const destructivePackagePath = path.join(manifestDir, `Destructive-${branchKey}.xml`);
    const destructiveVlocityPath = path.join(manifestDir, `Destructive-${branchKey}.yaml`);

    if (activeCore.length > 0) {
      fs.writeFileSync(packagePath, buildPackageXml(activeCore, DEFAULT_API_VERSION), 'utf8');
      this.log(`Generado: ${packagePath}`);
    }

    if (activeVlocity.length > 0) {
      fs.writeFileSync(vlocityPath, buildVlocityYaml(activeVlocity), 'utf8');
      this.log(`Generado: ${vlocityPath}`);
    }

    if (destructiveCore.length > 0) {
      fs.writeFileSync(destructivePackagePath, buildPackageXml(destructiveCore, DEFAULT_API_VERSION), 'utf8');
      this.log(`Generado: ${destructivePackagePath}`);
    }

    if (destructiveVlocity.length > 0) {
      fs.writeFileSync(destructiveVlocityPath, buildVlocityYaml(destructiveVlocity), 'utf8');
      this.log(`Generado: ${destructiveVlocityPath}`);
    }

    if (flags.xml && activeCore.length > 0) {
      const mergedXmlPath = mergeIntoXmlManifest(flags.xml, activeCore);
      this.log(`Manifest XML actualizado: ${mergedXmlPath}`);
    }

    if (flags.yaml && activeVlocity.length > 0) {
      const mergedYamlPath = mergeIntoYamlManifest(flags.yaml, activeVlocity);
      this.log(`Manifest YAML actualizado: ${mergedYamlPath}`);
    }

    if (activeCore.length === 0 && activeVlocity.length === 0 && destructiveCore.length === 0 && destructiveVlocity.length === 0) {
      this.log('No se detectaron componentes Core/Vlocity manejables para generar manifiestos.');
    }
  }
}

export default FindDelta;

function getGitDiffNameStatus(fromBranch, toBranch) {
  const output = execFileSync('git', ['diff', '--name-status', `${fromBranch}..${toBranch}`], {encoding: 'utf8'});
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

function parseDiffLine(line) {
  const columns = line.split('\t');
  const status = columns[0];
  if (!status) return null;

  if (status.startsWith('R')) {
    if (columns.length < 3) return null;
    return {status, oldPath: columns[1], newPath: columns[2]};
  }

  if (columns.length < 2) return null;
  return {status, path: columns[1]};
}

function sanitizeForFilename(value) {
  return String(value || 'branch').replace(/[\\/:*?"<>|\s]+/g, '-');
}

function dedupeComponents(components) {
  const map = new Map();
  for (const component of components) {
    const key = `${component.type}::${component.fullName}`;
    map.set(key, component);
  }
  return Array.from(map.values());
}

function resolveCoreComponent(filePath) {
  const normalized = normalizePath(filePath);
  const withoutMeta = normalized.replace(/-meta\.xml$/i, '');

  const simpleRules = [
    [/\/classes\/([^/]+)\.cls$/i, 'ApexClass'],
    [/\/triggers\/([^/]+)\.trigger$/i, 'ApexTrigger'],
    [/\/pages\/([^/]+)\.page$/i, 'ApexPage'],
    [/\/components\/([^/]+)\.component$/i, 'ApexComponent'],
    [/\/staticresources\/([^/]+)\.resource$/i, 'StaticResource'],
    [/\/flexipages\/([^/]+)\.flexipage$/i, 'FlexiPage'],
    [/\/permissionsets\/([^/]+)\.permissionset$/i, 'PermissionSet'],
    [/\/profiles\/([^/]+)\.profile$/i, 'Profile'],
    [/\/tabs\/([^/]+)\.tab$/i, 'CustomTab'],
    [/\/applications\/([^/]+)\.app$/i, 'CustomApplication'],
    [/\/flows\/([^/]+)\.flow$/i, 'Flow'],
    [/\/globalValueSets\/([^/]+)\.globalValueSet$/i, 'GlobalValueSet'],
    [/\/groups\/([^/]+)\.group$/i, 'Queue'],
    [/\/labels\/CustomLabels\.labels$/i, 'CustomLabels', 'CustomLabels'],
    [/\/layouts\/([^/]+)\.layout$/i, 'Layout'],
    [/\/quickActions\/([^/]+)\.quickAction$/i, 'QuickAction'],
    [/\/remoteSiteSettings\/([^/]+)\.remoteSite$/i, 'RemoteSiteSetting'],
    [/\/standardValueSets\/([^/]+)\.standardValueSet$/i, 'StandardValueSet'],
    [/\/standardValueSetTranslations\/([^/]+)\.standardValueSetTranslation$/i, 'StandardValueSetTranslation'],
    [/\/weblinks\/([^/]+)\.webLink$/i, 'WebLink'],
    [/\/reports\/([^/]+)\.report$/i, 'Report'],
    [/\/dashboards\/([^/]+)\.dashboard$/i, 'Dashboard'],
    [/\/reportTypes\/([^/]+)\.reportType$/i, 'ReportType']
  ];

  for (const [regex, type, fixedName] of simpleRules) {
    const match = withoutMeta.match(regex);
    if (match) {
      return {type, fullName: fixedName || match[1]};
    }
  }

  const lwcMatch = normalized.match(/\/lwc\/([^/]+)\//i);
  if (lwcMatch) return {type: 'LightningComponentBundle', fullName: lwcMatch[1]};

  const auraMatch = normalized.match(/\/aura\/([^/]+)\//i);
  if (auraMatch) return {type: 'AuraDefinitionBundle', fullName: auraMatch[1]};

  const customMetadataMatch = withoutMeta.match(/\/customMetadata\/([^/]+)\.md$/i);
  if (customMetadataMatch) return {type: 'CustomMetadata', fullName: customMetadataMatch[1]};

  const objectFieldMatch = withoutMeta.match(/\/objects\/([^/]+)\/fields\/([^/]+)\.field$/i);
  if (objectFieldMatch) return {type: 'CustomField', fullName: `${objectFieldMatch[1]}.${objectFieldMatch[2]}`};

  const objectRecordTypeMatch = withoutMeta.match(/\/objects\/([^/]+)\/recordTypes\/([^/]+)\.recordType$/i);
  if (objectRecordTypeMatch) return {type: 'RecordType', fullName: `${objectRecordTypeMatch[1]}.${objectRecordTypeMatch[2]}`};

  const objectValidationRuleMatch = withoutMeta.match(/\/objects\/([^/]+)\/validationRules\/([^/]+)\.validationRule$/i);
  if (objectValidationRuleMatch) return {type: 'ValidationRule', fullName: `${objectValidationRuleMatch[1]}.${objectValidationRuleMatch[2]}`};

  const objectListViewMatch = withoutMeta.match(/\/objects\/([^/]+)\/listViews\/([^/]+)\.listView$/i);
  if (objectListViewMatch) return {type: 'ListView', fullName: `${objectListViewMatch[1]}.${objectListViewMatch[2]}`};

  const objectCompactLayoutMatch = withoutMeta.match(/\/objects\/([^/]+)\/compactLayouts\/([^/]+)\.compactLayout$/i);
  if (objectCompactLayoutMatch) return {type: 'CompactLayout', fullName: `${objectCompactLayoutMatch[1]}.${objectCompactLayoutMatch[2]}`};

  const objectFieldSetMatch = withoutMeta.match(/\/objects\/([^/]+)\/fieldSets\/([^/]+)\.fieldSet$/i);
  if (objectFieldSetMatch) return {type: 'FieldSet', fullName: `${objectFieldSetMatch[1]}.${objectFieldSetMatch[2]}`};

  const objectBusinessProcessMatch = withoutMeta.match(/\/objects\/([^/]+)\/businessProcesses\/([^/]+)\.businessProcess$/i);
  if (objectBusinessProcessMatch) return {type: 'BusinessProcess', fullName: `${objectBusinessProcessMatch[1]}.${objectBusinessProcessMatch[2]}`};

  const objectWebLinkMatch = withoutMeta.match(/\/objects\/([^/]+)\/webLinks\/([^/]+)\.webLink$/i);
  if (objectWebLinkMatch) return {type: 'WebLink', fullName: `${objectWebLinkMatch[1]}.${objectWebLinkMatch[2]}`};

  const objectPathAssistantMatch = withoutMeta.match(/\/objects\/([^/]+)\/compactLayouts\/([^/]+)\.compactLayout$/i);
  if (objectPathAssistantMatch) return {type: 'CompactLayout', fullName: `${objectPathAssistantMatch[1]}.${objectPathAssistantMatch[2]}`};

  const customObjectMatch = withoutMeta.match(/\/objects\/([^/]+)\/([^/]+)\.object$/i);
  if (customObjectMatch) return {type: 'CustomObject', fullName: customObjectMatch[1]};

  return null;
}

function resolveVlocityComponent(filePath) {
  const normalized = normalizePath(filePath);
  const match = normalized.match(/(?:^|\/)Vlocity\/([^/]+)\/([^/]+)/i);
  if (!match) return null;
  const type = match[1];
  let fullName = match[2];

  fullName = fullName.replace(/\.(json|yaml|yml)$/i, '');
  fullName = fullName.replace(/_DataPack$/i, '');
  if (!fullName) return null;

  return {type, fullName};
}

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function buildPackageXml(components, apiVersion) {
  const grouped = components.reduce((acc, component) => {
    if (!acc.has(component.type)) {
      acc.set(component.type, new Set());
    }
    acc.get(component.type).add(component.fullName);
    return acc;
  }, new Map());

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<Package xmlns="http://soap.sforce.com/2006/04/metadata">'];
  const sortedTypes = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));

  for (const type of sortedTypes) {
    lines.push('    <types>');
    const sortedMembers = Array.from(grouped.get(type)).sort((a, b) => a.localeCompare(b));
    for (const member of sortedMembers) {
      lines.push(`        <members>${escapeXml(member)}</members>`);
    }
    lines.push(`        <name>${escapeXml(type)}</name>`);
    lines.push('    </types>');
  }

  lines.push(`    <version>${escapeXml(apiVersion || DEFAULT_API_VERSION)}</version>`);
  lines.push('</Package>');
  return `${lines.join('\n')}\n`;
}

function buildVlocityYaml(components) {
  const sorted = [...components].sort((a, b) => `${a.type}/${a.fullName}`.localeCompare(`${b.type}/${b.fullName}`));
  const lines = [
    'projectPath: ./Vlocity',
    'continueAfterError: true',
    'compileOnBuild: false',
    'maxDepth: 0',
    'autoUpdateSettings: true',
    '',
    'manifest:',
    ...sorted.map((c) => `- ${c.type}/${c.fullName}`),
    '',
    'OverrideSettings:',
    '    DataPacks:',
    '        Catalog:',
    '        Product2:',
    '            MaxDeploy: 1'
  ];
  return `${lines.join('\n')}\n`;
}

function mergeIntoXmlManifest(targetPath, components) {
  const resolvedPath = path.resolve(targetPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`No existe el archivo XML destino: ${resolvedPath}`);
  }

  const parser = new XMLParser({ignoreAttributes: false});
  const content = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = parser.parse(content);
  const pkg = parsed?.Package;
  if (!pkg) {
    throw new Error(`El XML destino no contiene nodo Package: ${resolvedPath}`);
  }

  const existingTypes = pkg.types ? (Array.isArray(pkg.types) ? pkg.types : [pkg.types]) : [];
  const typeOrder = [];
  const typeMap = new Map();

  for (const entry of existingTypes) {
    const typeName = String(entry?.name || '').trim();
    if (!typeName) continue;
    typeOrder.push(typeName);
    const membersRaw = entry.members;
    const membersArray = Array.isArray(membersRaw) ? membersRaw : [membersRaw];
    const memberSet = new Set(
      membersArray
        .map((member) => (member == null ? '' : String(member).trim()))
        .filter(Boolean)
    );
    typeMap.set(typeName, memberSet);
  }

  for (const component of components) {
    if (!typeMap.has(component.type)) {
      typeMap.set(component.type, new Set());
      typeOrder.push(component.type);
    }
    typeMap.get(component.type).add(component.fullName);
  }

  const version = pkg.version ? String(pkg.version).trim() : DEFAULT_API_VERSION;
  const orderedTypes = [...new Set(typeOrder)];
  const newTypes = Array.from(typeMap.keys()).filter((type) => !orderedTypes.includes(type)).sort((a, b) => a.localeCompare(b));
  const finalTypeOrder = [...orderedTypes, ...newTypes];

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<Package xmlns="http://soap.sforce.com/2006/04/metadata">'];
  for (const typeName of finalTypeOrder) {
    const members = typeMap.get(typeName);
    if (!members || members.size === 0) continue;
    lines.push('    <types>');
    for (const member of Array.from(members).sort((a, b) => a.localeCompare(b))) {
      lines.push(`        <members>${escapeXml(member)}</members>`);
    }
    lines.push(`        <name>${escapeXml(typeName)}</name>`);
    lines.push('    </types>');
  }
  lines.push(`    <version>${escapeXml(version || DEFAULT_API_VERSION)}</version>`);
  lines.push('</Package>');

  fs.writeFileSync(resolvedPath, `${lines.join('\n')}\n`, 'utf8');
  return resolvedPath;
}

function mergeIntoYamlManifest(targetPath, components) {
  const resolvedPath = path.resolve(targetPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`No existe el archivo YAML destino: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf8');
  const lines = content.split(/\r?\n/);

  const manifestIndex = lines.findIndex((line) => line.trim() === 'manifest:');
  if (manifestIndex < 0) {
    throw new Error(`El YAML destino no contiene la sección manifest: ${resolvedPath}`);
  }

  let endIndex = lines.length;
  for (let i = manifestIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!line.trim().startsWith('- ')) {
      endIndex = i;
      break;
    }
  }

  const existingEntries = lines
    .slice(manifestIndex + 1, endIndex)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());

  const manifestSet = new Set(existingEntries);
  for (const component of components) {
    manifestSet.add(`${component.type}/${component.fullName}`);
  }

  const sortedEntries = Array.from(manifestSet).sort((a, b) => a.localeCompare(b));
  const newLines = [
    ...lines.slice(0, manifestIndex + 1),
    ...sortedEntries.map((entry) => `- ${entry}`),
    ...lines.slice(endIndex)
  ];

  fs.writeFileSync(resolvedPath, `${newLines.join('\n')}\n`, 'utf8');
  return resolvedPath;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
