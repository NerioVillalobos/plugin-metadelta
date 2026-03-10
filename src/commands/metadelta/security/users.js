import {Command, Flags} from '@oclif/core';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const SEPARATOR = '|';

const splitValues = (value) => {
  if (!value) {
    return [];
  }

  return String(value)
    .split(SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
};

const csvEscape = (value) => {
  const normalized = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  return normalized;
};

const parseCsvLine = (line) => {
  const values = [];
  let current = '';
  let i = 0;
  let inQuotes = false;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }

        inQuotes = false;
        i += 1;
        continue;
      }

      current += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ',') {
      values.push(current);
      current = '';
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  values.push(current);
  return values;
};

const parseCsv = (rawContent) => {
  const content = rawContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!content.trim()) {
    return [];
  }

  const lines = content.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const rows = [];

  for (const line of lines.slice(1)) {
    if (!line.trim()) {
      continue;
    }

    const values = parseCsvLine(line);
    const row = {};

    for (let index = 0; index < headers.length; index += 1) {
      row[headers[index]] = values[index] ?? '';
    }

    rows.push(row);
  }

  return rows;
};

const writeCsv = (filePath, rows, headers) => {
  const headerLine = `${headers.join(',')}\n`;
  const body = rows
    .map((row) => headers.map((header) => csvEscape(row[header] ?? '')).join(','))
    .join('\n');

  const output = body ? `${headerLine}${body}\n` : headerLine;
  fs.writeFileSync(filePath, output, 'utf8');
};

const loadMaster = (masterFile) => {
  const matrix = new Map();
  const content = fs.readFileSync(masterFile, 'utf8');
  const rows = parseCsv(content);

  for (const row of rows) {
    const role = (row.RoleName ?? '').trim();
    if (!role) {
      continue;
    }

    if (!matrix.has(role)) {
      matrix.set(role, {
        psg: new Set(),
        puesto: null,
        segmentos: new Set(),
        queues: new Set()
      });
    }

    const config = matrix.get(role);

    for (const psg of splitValues(row.PermissionSetGroup)) {
      config.psg.add(psg);
    }

    const puesto = (row.PublicGroupPuesto ?? '').trim();
    if (puesto) {
      config.puesto = puesto;
    }

    for (const segment of splitValues(row.PublicGroupSegmento)) {
      config.segmentos.add(segment);
    }

    for (const queue of splitValues(row.Queues)) {
      config.queues.add(queue);
    }
  }

  return matrix;
};

const loadTargetUsers = (targetUsersFile) => {
  const content = fs.readFileSync(targetUsersFile, 'utf8');
  return parseCsv(content);
};

class MetadeltaSecurityUsers extends Command {
  static summary = 'Genera y aplica cambios de roles, PSGs y grupos para usuarios objetivo según una matriz maestra.';

  static description =
    'Replica el flujo de “metadelta security users”: carga la matriz maestra y usuarios objetivo, resuelve IDs en la org, genera CSVs de cambios y opcionalmente ejecuta los bulk jobs.';

  static flags = {
    master: Flags.string({summary: 'CSV maestro con la matriz de seguridad.', required: true}),
    'target-users': Flags.string({summary: 'CSV con usuarios objetivo (Username, RoleName).', required: true}),
    org: Flags.string({char: 'o', summary: 'Alias/username de la org donde se resuelven IDs y se aplican cambios.', required: true}),
    'output-dir': Flags.string({summary: 'Directorio de salida para los CSV generados.', default: 'out'}),
    apply: Flags.boolean({summary: 'Aplica los cambios mediante Bulk API.', default: false})
  };

  runSfQuery(targetOrg, query) {
    let result;
    try {
      result = execFileSync('sf', ['data', 'query', '-q', query, '-o', targetOrg, '--json'], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      const stderr = error.stderr?.toString() ?? error.message;
      throw new Error(`Error ejecutando query:\n${query}\n\nSTDERR:\n${stderr}`);
    }

    let data;
    try {
      data = JSON.parse(result);
    } catch {
      throw new Error(`No se pudo interpretar la respuesta JSON.\n\nSTDOUT:\n${result}`);
    }

    if (!data?.result?.records) {
      throw new Error(`Respuesta inesperada del comando sf.\n\n${JSON.stringify(data, null, 2)}`);
    }

    return data.result.records;
  }

  runSfCommand(args) {
    execFileSync('sf', args, {
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });
  }

  async run() {
    const {flags} = await this.parse(MetadeltaSecurityUsers);

    const outputDir = path.resolve(flags['output-dir']);
    fs.mkdirSync(outputDir, {recursive: true});

    this.log('Loading master matrix...');
    const matrix = loadMaster(path.resolve(flags.master));

    this.log('Loading target users...');
    const users = loadTargetUsers(path.resolve(flags['target-users']));

    this.log('Resolving IDs from org...');

    const userRecords = this.runSfQuery(flags.org, 'SELECT Id, Username, UserRoleId FROM User');
    const roleRecords = this.runSfQuery(flags.org, 'SELECT Id, DeveloperName FROM UserRole');
    const psgRecords = this.runSfQuery(flags.org, 'SELECT Id, DeveloperName FROM PermissionSetGroup');
    const groupRecords = this.runSfQuery(flags.org, 'SELECT Id, DeveloperName FROM Group');

    const userMap = new Map(userRecords.map((record) => [record.Username, record.Id]));
    const roleMap = new Map(roleRecords.map((record) => [record.DeveloperName, record.Id]));
    const psgMap = new Map(psgRecords.map((record) => [record.DeveloperName, record.Id]));
    const groupMap = new Map(groupRecords.map((record) => [record.DeveloperName, record.Id]));

    const roleUpdates = [];
    const psgRows = [];
    const groupRows = [];
    const errors = [];

    const seenRoleUpdates = new Set();
    const seenPsgRows = new Set();
    const seenGroupRows = new Set();

    for (const user of users) {
      const username = (user.Username ?? '').trim();
      const role = (user.RoleName ?? '').trim();

      if (!username) {
        errors.push({Username: '', Error: 'Username vacío en target-users'});
        continue;
      }

      if (!userMap.has(username)) {
        errors.push({Username: username, Error: 'User not found'});
        continue;
      }

      const userId = userMap.get(username);

      if (!matrix.has(role)) {
        errors.push({Username: username, Error: `Role not in matrix: ${role}`});
        continue;
      }

      const config = matrix.get(role);

      if (roleMap.has(role)) {
        const roleKey = `${userId}|${roleMap.get(role)}`;
        if (!seenRoleUpdates.has(roleKey)) {
          roleUpdates.push({
            Id: userId,
            UserRoleId: roleMap.get(role)
          });
          seenRoleUpdates.add(roleKey);
        }
      } else {
        errors.push({Username: username, Error: `UserRole not found in org: ${role}`});
      }

      for (const psg of config.psg) {
        if (psgMap.has(psg)) {
          const psgKey = `${userId}|${psgMap.get(psg)}`;
          if (!seenPsgRows.has(psgKey)) {
            psgRows.push({
              AssigneeId: userId,
              PermissionSetGroupId: psgMap.get(psg)
            });
            seenPsgRows.add(psgKey);
          }
        } else {
          errors.push({Username: username, Error: `PermissionSetGroup not found in org: ${psg}`});
        }
      }

      if (config.puesto) {
        const puesto = config.puesto;
        if (groupMap.has(puesto)) {
          const groupKey = `${groupMap.get(puesto)}|${userId}`;
          if (!seenGroupRows.has(groupKey)) {
            groupRows.push({
              GroupId: groupMap.get(puesto),
              UserOrGroupId: userId
            });
            seenGroupRows.add(groupKey);
          }
        } else {
          errors.push({Username: username, Error: `PublicGroupPuesto not found in org: ${puesto}`});
        }
      }

      for (const segment of config.segmentos) {
        if (groupMap.has(segment)) {
          const groupKey = `${groupMap.get(segment)}|${userId}`;
          if (!seenGroupRows.has(groupKey)) {
            groupRows.push({
              GroupId: groupMap.get(segment),
              UserOrGroupId: userId
            });
            seenGroupRows.add(groupKey);
          }
        } else {
          errors.push({Username: username, Error: `PublicGroupSegmento not found in org: ${segment}`});
        }
      }

      for (const queue of config.queues) {
        if (groupMap.has(queue)) {
          const groupKey = `${groupMap.get(queue)}|${userId}`;
          if (!seenGroupRows.has(groupKey)) {
            groupRows.push({
              GroupId: groupMap.get(queue),
              UserOrGroupId: userId
            });
            seenGroupRows.add(groupKey);
          }
        } else {
          errors.push({Username: username, Error: `Queue/Group not found in org: ${queue}`});
        }
      }
    }

    writeCsv(path.join(outputDir, 'user_role_updates.csv'), roleUpdates, ['Id', 'UserRoleId']);
    writeCsv(path.join(outputDir, 'permissionsetassignment_insert.csv'), psgRows, ['AssigneeId', 'PermissionSetGroupId']);
    writeCsv(path.join(outputDir, 'groupmember_insert.csv'), groupRows, ['GroupId', 'UserOrGroupId']);
    writeCsv(path.join(outputDir, 'validation_errors.csv'), errors, ['Username', 'Error']);

    this.log('');
    this.log(`Files generated in: ${outputDir}`);
    this.log(`Role updates: ${roleUpdates.length}`);
    this.log(`PSG assignments: ${psgRows.length}`);
    this.log(`Group memberships: ${groupRows.length}`);
    this.log(`Validation errors: ${errors.length}`);

    if (!flags.apply) {
      this.log('');
      this.log('DRY RUN completed. No changes applied.');
      return;
    }

    this.log('');
    this.log('Applying changes via Bulk API...');

    if (roleUpdates.length > 0) {
      this.runSfCommand(['data', 'update', 'bulk', '-s', 'User', '-f', path.join(outputDir, 'user_role_updates.csv'), '-o', flags.org, '--line-ending', 'LF']);
    }

    if (psgRows.length > 0) {
      this.runSfCommand([
        'data',
        'import',
        'bulk',
        '-s',
        'PermissionSetAssignment',
        '-f',
        path.join(outputDir, 'permissionsetassignment_insert.csv'),
        '-o',
        flags.org,
        '--line-ending',
        'LF'
      ]);
    }

    if (groupRows.length > 0) {
      this.runSfCommand(['data', 'import', 'bulk', '-s', 'GroupMember', '-f', path.join(outputDir, 'groupmember_insert.csv'), '-o', flags.org, '--line-ending', 'LF']);
    }

    this.log('Finished.');
  }
}

export default MetadeltaSecurityUsers;
