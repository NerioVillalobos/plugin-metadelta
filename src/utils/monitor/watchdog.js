import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {URL} from 'node:url';

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.metadelta', 'monitor', 'watchdog.config.json');
const DEFAULT_STATE_PATH = path.join(os.homedir(), '.metadelta', 'monitor', 'teams-watchdog-state.json');
const DEFAULT_WEBHOOK_ENV = 'METADELTA_TEAMS_WEBHOOK_URL';

const ACTION_LABELS = {
  A: 'Agregado',
  ADDED: 'Agregado',
  M: 'Modificado',
  MODIFIED: 'Modificado',
  D: 'Eliminado',
  DELETED: 'Eliminado',
  R: 'Renombrado',
  RENAMED: 'Renombrado',
};

const ACTION_COLORS = {
  A: '28A745',
  ADDED: '28A745',
  M: 'FFC107',
  MODIFIED: 'FFC107',
  D: 'D93025',
  DELETED: 'D93025',
  R: '5B9BD5',
  RENAMED: '5B9BD5',
};

export function getDefaultWatchdogConfigPath() {
  return DEFAULT_CONFIG_PATH;
}

export function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === '~') {
    return os.homedir();
  }
  if (inputPath.startsWith(`~${path.sep}`) || inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function resolveUserPath(inputPath, baseDir = process.cwd()) {
  if (!inputPath) {
    return inputPath;
  }
  const expanded = expandHome(inputPath);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(baseDir, expanded);
}

export function defaultMonitorLogPath(orgAlias) {
  return path.join(os.homedir(), '.metadelta', 'monitor', orgAlias, 'change-log.jsonl');
}

export function defaultMonitorCsvPath(orgAlias) {
  return path.join(os.homedir(), '.metadelta', `${orgAlias}-metadelta-monitor.csv`);
}

export function loadWatchdogConfig(configPath = DEFAULT_CONFIG_PATH) {
  return loadJson(resolveUserPath(configPath), null);
}

export function saveWatchdogConfig(configPath = DEFAULT_CONFIG_PATH, config) {
  saveJsonAtomic(resolveUserPath(configPath), normalizeConfig(config));
}

export function ensureWatchdogConfig(configPath = DEFAULT_CONFIG_PATH, defaults = {}) {
  const resolved = resolveUserPath(configPath);
  const existing = loadJson(resolved, null);
  if (existing) {
    return normalizeConfig(existing);
  }
  const config = normalizeConfig({
    webhookUrlEnv: DEFAULT_WEBHOOK_ENV,
    ignoreEvents: ['SESSION_STARTED', 'SESSION_ENDED'],
    stateFile: DEFAULT_STATE_PATH,
    watchTargets: [],
    ...defaults,
  });
  saveJsonAtomic(resolved, config);
  return config;
}

export function normalizeConfig(config = {}) {
  return {
    webhookUrl: config.webhookUrl,
    webhookUrlEnv: config.webhookUrlEnv || DEFAULT_WEBHOOK_ENV,
    controlLanguage: normalizeControlLanguage(config.controlLanguage),
    devopsAllowlist: Array.isArray(config.devopsAllowlist) ? config.devopsAllowlist : [],
    ignoreEvents: Array.isArray(config.ignoreEvents) ? config.ignoreEvents : ['SESSION_STARTED', 'SESSION_ENDED'],
    stateFile: resolveUserPath(config.stateFile || DEFAULT_STATE_PATH),
    watchTargets: Array.isArray(config.watchTargets) ? config.watchTargets.map(normalizeTarget) : [],
  };
}

export function normalizeTarget(target = {}) {
  const org = String(target.org ?? '').trim();
  const normalized = {
    org,
    logPath: resolveUserPath(target.logPath || (org ? defaultMonitorLogPath(org) : '')),
  };
  if (target.scopeXml) {
    normalized.scopeXml = resolveUserPath(target.scopeXml);
  }
  if (target.scopeYaml) {
    normalized.scopeYaml = resolveUserPath(target.scopeYaml);
  }
  if (Number.isFinite(Number(target.interval))) {
    normalized.interval = Math.max(1, Number(target.interval));
  }
  if (target.exportCsv) {
    normalized.exportCsv = resolveUserPath(target.exportCsv);
  }
  return normalized;
}

export function listWatchTargets(configPath = DEFAULT_CONFIG_PATH) {
  return ensureWatchdogConfig(configPath).watchTargets;
}

export function addWatchTarget(configPath, orgAlias, options = {}) {
  const org = String(orgAlias ?? '').trim();
  if (!org) {
    throw new Error('El alias del ambiente es requerido.');
  }
  const config = ensureWatchdogConfig(configPath);
  if (config.watchTargets.some((target) => target.org === org)) {
    return {status: 'exists', target: config.watchTargets.find((target) => target.org === org), config};
  }
  const target = normalizeTarget({
    org,
    logPath: options.logPath || defaultMonitorLogPath(org),
    scopeXml: options.scopeXml,
    scopeYaml: options.scopeYaml,
    interval: options.interval,
    exportCsv: options.exportCsv || defaultMonitorCsvPath(org),
  });
  config.watchTargets.push(target);
  saveWatchdogConfig(configPath, config);
  return {status: 'added', target, config};
}

export function removeWatchTarget(configPath, orgAlias) {
  const config = ensureWatchdogConfig(configPath);
  const before = config.watchTargets.length;
  config.watchTargets = config.watchTargets.filter((target) => target.org !== orgAlias);
  saveWatchdogConfig(configPath, config);
  return {removed: before - config.watchTargets.length, config};
}

export function updateWatchTarget(configPath, orgAlias, updates = {}) {
  const config = ensureWatchdogConfig(configPath);
  const index = config.watchTargets.findIndex((target) => target.org === orgAlias);
  if (index === -1) {
    throw new Error(`No existe un monitor configurado para ${orgAlias}.`);
  }
  const current = config.watchTargets[index];
  const next = {...current};
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  config.watchTargets[index] = normalizeTarget(next);
  saveWatchdogConfig(configPath, config);
  return {target: config.watchTargets[index], config};
}

export function updateControlLanguage(configPath, language) {
  const config = ensureWatchdogConfig(configPath);
  config.controlLanguage = normalizeControlLanguage(language);
  saveWatchdogConfig(configPath, config);
  return config;
}

export function readNewEntries(filePath, previousOffset) {
  const stat = fs.statSync(filePath);
  let offset = previousOffset;
  if (!Number.isFinite(offset) || offset < 0 || offset > stat.size) {
    offset = 0;
  }
  if (offset === stat.size) {
    return {entries: [], finalOffsetIfEmpty: offset};
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    const length = stat.size - offset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, offset);

    const entries = [];
    let cursor = 0;
    for (;;) {
      const newlineIdx = buffer.indexOf(0x0A, cursor);
      if (newlineIdx === -1) {
        break;
      }
      const line = buffer.slice(cursor, newlineIdx).toString('utf8').trim();
      const endOffset = offset + newlineIdx + 1;
      if (line) {
        entries.push({line, endOffset});
      }
      cursor = newlineIdx + 1;
    }
    return {entries, finalOffsetIfEmpty: offset};
  } finally {
    fs.closeSync(fd);
  }
}

export function buildMessageCard(entry, fallbackOrg) {
  const org = entry.org || fallbackOrg;
  const action = entry.action || 'UNKNOWN';
  return {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary: `Cambio no autorizado detectado en ${org}`,
    themeColor: ACTION_COLORS[action] || '6B6B6B',
    title: `Cambio fuera de DevOps - ${org}`,
    sections: [
      {
        facts: [
          {name: 'Sandbox', value: org},
          {name: 'Accion', value: ACTION_LABELS[action] || action},
          {name: 'Tipo', value: entry.type || 'Metadata'},
          {name: 'Componente', value: entry.component || entry.file || 'N/D'},
          {name: 'Modificado por', value: entry.lastModifiedBy || 'Desconocido'},
          {name: 'Fecha de modificacion (org)', value: entry.lastModifiedDate || 'N/D'},
          {name: 'Detectado', value: entry.detectedAt || 'N/D'},
        ],
        markdown: true,
      },
    ],
  };
}

export async function runWatchdogOnce(configPath = DEFAULT_CONFIG_PATH, options = {}) {
  const config = normalizeConfig({
    ...ensureWatchdogConfig(configPath),
    webhookUrl: options.webhookUrl || ensureWatchdogConfig(configPath).webhookUrl,
  });
  const webhookUrl = resolveWebhookUrl(config, options);
  if (!webhookUrl) {
    throw new Error(`Falta webhookUrl o la variable ${config.webhookUrlEnv || DEFAULT_WEBHOOK_ENV}.`);
  }
  if (config.watchTargets.length === 0) {
    throw new Error('Falta watchTargets en la configuracion del watchdog.');
  }

  const stateFile = resolveUserPath(config.stateFile || DEFAULT_STATE_PATH);
  const state = loadJson(stateFile, {});
  let totalAlerts = 0;
  let totalErrors = 0;
  const summaries = [];

  for (const target of config.watchTargets) {
    const summary = await processWatchTarget(target, {...config, webhookUrl}, state, options);
    totalAlerts += summary.alerts;
    totalErrors += summary.errors;
    summaries.push(summary);
  }

  saveJsonAtomic(stateFile, state);
  return {alerts: totalAlerts, errors: totalErrors, stateFile, summaries};
}

export async function processWatchTarget(target, config, state, options = {}) {
  const normalized = normalizeTarget(target);
  const {org, logPath} = normalized;
  const summary = {org, alerts: 0, errors: 0, skipped: false};

  if (!org || !logPath) {
    summary.errors += 1;
    summary.error = 'Target invalido, requiere org y logPath.';
    return summary;
  }
  if (!fs.existsSync(logPath)) {
    summary.skipped = true;
    summary.reason = `Todavia no existe ${logPath}.`;
    return summary;
  }

  const previousOffset = state[logPath]?.offset ?? 0;
  let entries;
  let finalOffsetIfEmpty;
  try {
    ({entries, finalOffsetIfEmpty} = readNewEntries(logPath, previousOffset));
  } catch (error) {
    summary.errors += 1;
    summary.error = error.message;
    return summary;
  }

  let committedOffset = entries.length === 0 ? finalOffsetIfEmpty : previousOffset;
  const allowlist = new Set((config.devopsAllowlist || []).map(normalizeName));
  const ignoreEvents = new Set(config.ignoreEvents || ['SESSION_STARTED', 'SESSION_ENDED']);
  const post = options.postToTeams || postToTeams;

  for (const {line, endOffset} of entries) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      committedOffset = endOffset;
      continue;
    }

    if (ignoreEvents.has(parsed.event) || parsed.event !== 'CHANGE_DETECTED') {
      committedOffset = endOffset;
      continue;
    }
    const eventDate = parsed.detectedAt || parsed.lastModifiedDate;
    if (!isToday(eventDate, options.now)) {
      committedOffset = endOffset;
      continue;
    }
    if (allowlist.has(normalizeName(parsed.lastModifiedBy))) {
      committedOffset = endOffset;
      continue;
    }

    try {
      await post(config.webhookUrl, buildMessageCard(parsed, org));
      summary.alerts += 1;
      committedOffset = endOffset;
    } catch (error) {
      summary.errors += 1;
      summary.error = error.message;
      break;
    }
  }

  state[logPath] = {offset: committedOffset, org, lastCheckedAt: new Date().toISOString()};
  return summary;
}

export function buildMonitorRunArgs(target, defaults = {}) {
  const normalized = normalizeTarget(target);
  const args = ['metadelta', 'monitor', 'run', '--org', normalized.org];
  const interval = normalized.interval || defaults.interval;
  if (interval) {
    args.push('--interval', String(interval));
  }
  if (normalized.scopeXml) {
    args.push('--scope-xml', normalized.scopeXml);
  }
  if (normalized.scopeYaml) {
    args.push('--scope-yaml', normalized.scopeYaml);
  }
  if (normalized.exportCsv) {
    args.push('--export-csv', normalized.exportCsv);
  }
  return args;
}

function resolveWebhookUrl(config, options = {}) {
  return options.webhookUrl || config.webhookUrl || process.env[config.webhookUrlEnv || DEFAULT_WEBHOOK_ENV];
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw new Error(`No se pudo leer/parsear ${filePath}: ${error.message}`);
  }
}

function saveJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function normalizeControlLanguage(language) {
  const normalized = String(language || 'es').trim().toLowerCase();
  return normalized === 'en' ? 'en' : 'es';
}

function isToday(dateString, nowValue = new Date()) {
  if (!dateString) {
    return false;
  }
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const now = new Date(nowValue);
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function postToTeams(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(webhookUrl);
    } catch {
      reject(new Error(`webhookUrl invalida: ${webhookUrl}`));
      return;
    }

    const body = JSON.stringify(payload);
    const transport = url.protocol === 'http:' ? http : https;
    const request = transport.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(raw);
            return;
          }
          reject(new Error(`Teams respondio HTTP ${response.statusCode}: ${raw.slice(0, 300)}`));
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error('Timeout llamando al webhook de Teams')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}
