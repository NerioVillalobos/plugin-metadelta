import {Command, Flags} from '../../../utils/oclif.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  createMonitorWorkspace,
  resetCurrent,
} from '../../../utils/monitor/workspace.js';
import {initGit, hasBaseline, createBaseline, parseDiff, diffSummary, updateBaseline} from '../../../utils/monitor/gitEngine.js';
import {normalizeTree} from '../../../utils/monitor/normalizer.js';
import {retrieveSalesforceCore, exportVlocity} from '../../../utils/monitor/retriever.js';
import {enrichChanges} from '../../../utils/monitor/metadata.js';
import {appendChangeLogEntries, appendSessionEnded, appendSessionStarted, exportChangeLogToCsv} from '../../../utils/monitor/changeLog.js';
import {MonitorUi} from '../../../utils/monitor/ui.js';
import {isIgnoredMonitorFile} from '../../../utils/monitor/ignore.js';

class MonitorRun extends Command {
  static id = 'metadelta:monitor:run';
  static summary = 'Run a temporary local Salesforce/Vlocity metadata drift monitor.';
  static description = `
  Creates a temporary .metadelta-monitor workspace, retrieves Salesforce Core and Vlocity metadata,
  tracks drift with a local Git repository, and renders an interactive terminal monitor.
  Snapshots, Git baseline, and change logs are preserved under .metadelta/monitor/<org>.
  `;

  static examples = [
    'sf metadelta monitor run --org DEV',
    'sf metadelta monitor run --org devNervill-2 --scope salesforce',
    'sf metadelta monitor run --org vlocitySandbox --scope vlocity',
  ];

  static flags = {
    org: Flags.string({char: 'o', summary: 'Alias or username of the target org', required: true}),
    interval: Flags.integer({summary: 'Refresh interval in minutes', default: 5}),
    scope: Flags.string({
      summary: 'Metadata source to monitor: all, salesforce, or vlocity',
      default: 'all',
      options: ['all', 'salesforce', 'vlocity'],
    }),
    'scope-xml': Flags.string({summary: 'Path to a Salesforce Core package.xml used to monitor only those components'}),
    'scope-yaml': Flags.string({summary: 'Path to a Vlocity YAML manifest used to monitor only those DataPacks'}),
    'export-csv': Flags.string({summary: 'Export the persistent monitor change log to this CSV file when the command exits'}),
    once: Flags.boolean({summary: 'Run one refresh cycle and exit after cleanup. Useful for validation.'}),
  };

  async run() {
    const {flags} = await this.parse(MonitorRun);
    const orgAlias = flags.org;
    const launchRoot = process.cwd();
    const scopedXmlPath = resolveOptionalManifestPath(launchRoot, flags['scope-xml']);
    const scopedYamlPath = resolveOptionalManifestPath(launchRoot, flags['scope-yaml']);
    const commandRoot = path.join(launchRoot, '.metadelta', 'monitor', orgAlias);
    fs.mkdirSync(commandRoot, {recursive: true});
    process.chdir(commandRoot);
    const changeLogPath = path.join(commandRoot, 'change-log.jsonl');
    const csvExportPath = flags['export-csv'] ? path.resolve(launchRoot, flags['export-csv']) : undefined;
    const intervalMs = Math.max(1, flags.interval) * 60 * 1000;
    const paths = createMonitorWorkspace(process.cwd(), orgAlias);
    let scope = resolveEffectiveScope(flags.scope, {scopedXmlPath, scopedYamlPath});
    let displayScope = resolveDisplayScope(scope, {scopedXmlPath, scopedYamlPath});
    const sessionStartedAt = new Date().toISOString();
    appendSessionStarted(changeLogPath, {orgAlias, scope: displayScope, startedAt: sessionStartedAt});
    let ui;
    let timer;
    let refreshing = false;
    let exiting = false;
    let sessionEndedLogged = false;
    const accumulatedChanges = new Map();

    const logSessionEnded = (code, reason) => {
      if (sessionEndedLogged) {
        return;
      }
      sessionEndedLogged = true;
      appendSessionEnded(changeLogPath, {
        orgAlias,
        scope: displayScope,
        startedAt: sessionStartedAt,
        endedAt: new Date().toISOString(),
        exitCode: code,
        reason,
      });
      if (csvExportPath) {
        exportChangeLogToCsv(changeLogPath, csvExportPath);
      }
    };

    const scheduleNextRefresh = () => {
      if (flags.once || !ui || exiting) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      const nextRefreshAt = Date.now() + intervalMs;
      ui.update({nextRefreshAt});
      timer = setTimeout(() => {
        void refresh();
      }, intervalMs);
    };

    const cleanupAndExit = async (code = 0) => {
      if (exiting) {
        return;
      }
      exiting = true;
      if (timer) {
        clearInterval(timer);
      }
      ui?.stop();
      logSessionEnded(code, code === 0 ? 'USER_EXIT' : 'SIGNAL_EXIT');
      if (flags.once) {
        return;
      }
      process.exitCode = code;
    };

    const refresh = async () => {
      if (refreshing || exiting) {
        return;
      }
      refreshing = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      ui?.update({
        status: 'REFRESHING',
        nextRefreshAt: null,
        errorDetail: '',
        noticeDetail: '',
        message: 'Retrieving metadata from org...',
      });

      try {
        resetCurrent(paths, scope);
        let retrieveDurationMs = 0;
        if (scope === 'all' || scope === 'salesforce') {
          ui?.update({message: 'Retrieving Salesforce Core metadata...'});
          const startedAt = Date.now();
          await retrieveSalesforceCore(paths, orgAlias, {manifestPath: scopedXmlPath});
          retrieveDurationMs += Date.now() - startedAt;
        }
        let vlocityMessage = '';
        let vlocityWarning = '';
        if (scope === 'all' || scope === 'vlocity') {
          ui?.update({message: 'Exporting Vlocity DataPacks...'});
          const startedAt = Date.now();
          const vlocityResult = await exportVlocity(paths, orgAlias, {
            required: scope === 'vlocity',
            jobPath: scopedYamlPath,
          });
          retrieveDurationMs += Date.now() - startedAt;
          if (vlocityResult.skipped) {
            vlocityMessage = vlocityResult.reason;
          } else if (vlocityResult.warning) {
            vlocityWarning = vlocityResult.warning;
          }
        }

        ui?.update({message: 'Normalizing and comparing snapshots...'});
        normalizeTree(paths.orgRoot);
        const baselineExists = await hasBaseline(paths.root);
        const lastRefreshAt = Date.now();
        if (!baselineExists) {
          await createBaseline(paths.root);
          const baselineMessage = 'Initial baseline snapshot created.';
          ui?.update({
            rows: [...accumulatedChanges.values()],
            status: 'BASELINE CREATED',
            lastRefreshAt,
            retrieveDurationMs,
            message: vlocityMessage
              ? `${baselineMessage} Vlocity fue omitido; ver detalles abajo.`
              : vlocityWarning
                ? `${baselineMessage} ${vlocityWarning} El monitor continúa.`
                : baselineMessage,
            noticeDetail: vlocityMessage,
          });
          return;
        }

        const currentPrefix = `${orgAlias}/current/`;
        const rawChanges = (await parseDiff(paths.root)).filter((change) => change.file.startsWith(currentPrefix) && !isIgnoredMonitorFile(change.file));
        const rows = await enrichChanges(rawChanges, orgAlias, paths.root, diffSummary);
        const detectedAt = new Date(lastRefreshAt).toISOString();
        for (const row of rows) {
          accumulatedChanges.set(`${row.action}:${row.file}`, {
            ...row,
            detectedAt,
          });
        }
        appendChangeLogEntries(changeLogPath, rows, {orgAlias, detectedAt});
        const cumulativeRows = [...accumulatedChanges.values()].sort(sortRecentChanges);
        ui?.update({
          rows: cumulativeRows,
          status: 'WATCHING',
          lastRefreshAt,
          retrieveDurationMs,
          message: vlocityMessage
            ? `${rows.length} new change(s), ${cumulativeRows.length} cumulative. Vlocity fue omitido; ver detalles abajo.`
            : vlocityWarning
              ? `${rows.length} new change(s), ${cumulativeRows.length} cumulative. ${vlocityWarning} El monitor continúa.`
              : `${rows.length} new change(s), ${cumulativeRows.length} cumulative. Baseline updated for next refresh.`,
          noticeDetail: vlocityMessage,
        });
        await updateBaseline(paths.root);
      } catch (error) {
        ui?.update({
          status: 'ERROR',
          message: 'Refresh failed. Error completo abajo.',
          errorDetail: error.message,
          noticeDetail: '',
        });
        if (flags.once) {
          throw error;
        }
      } finally {
        refreshing = false;
        scheduleNextRefresh();
      }
    };

    process.once('SIGINT', () => {
      void cleanupAndExit(130);
    });
    process.once('SIGTERM', () => {
      void cleanupAndExit(143);
    });

    try {
      await initGit(paths.root);
      if (flags.once || !process.stdout.isTTY) {
        await refresh();
        const baselineExists = await hasBaseline(paths.root);
        const changes = baselineExists ? await parseDiff(paths.root).catch(() => []) : [];
        this.log(`STATUS: ${changes.length === 0 ? 'BASELINE CREATED' : 'WATCHING'}`);
        await cleanupAndExit(0);
        return;
      }

      ui = new MonitorUi({
        orgAlias,
        intervalMs,
        onRefresh: () => {
          void refresh();
        },
        onQuit: () => {
          void cleanupAndExit(0);
        },
        onScope: (nextScope) => {
          scope = resolveEffectiveScope(nextScope, {scopedXmlPath, scopedYamlPath});
          displayScope = resolveDisplayScope(scope, {scopedXmlPath, scopedYamlPath});
          ui.update({scope: displayScope, message: `Scope changed to ${displayScope}. Press r to refresh now.`});
        },
      });
      ui.start();
      ui.update({scope: displayScope});
      await refresh();
    } catch (error) {
      ui?.stop();
      logSessionEnded(1, 'ERROR');
      this.error(error.message);
    }
  }
}

function resolveOptionalManifestPath(baseDir, manifestPath) {
  if (!manifestPath) {
    return undefined;
  }
  const resolved = path.resolve(baseDir, manifestPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`No se encontró el manifest indicado: ${manifestPath}`);
  }
  return resolved;
}

function resolveEffectiveScope(defaultScope, {scopedXmlPath, scopedYamlPath}) {
  if (scopedXmlPath && scopedYamlPath) {
    return 'all';
  }
  if (scopedXmlPath) {
    return 'salesforce';
  }
  if (scopedYamlPath) {
    return 'vlocity';
  }
  return defaultScope;
}

function resolveDisplayScope(scope, {scopedXmlPath, scopedYamlPath}) {
  if (scopedXmlPath && scopedYamlPath) {
    return 'all-custom';
  }
  if (scopedXmlPath) {
    return 'salesforce-custom';
  }
  if (scopedYamlPath) {
    return 'vlocity-custom';
  }
  return scope;
}

function sortRecentChanges(left, right) {
  const detectedDiff = Date.parse(right.detectedAt ?? '') - Date.parse(left.detectedAt ?? '');
  if (Number.isFinite(detectedDiff) && detectedDiff !== 0) {
    return detectedDiff;
  }

  const modifiedDiff = Date.parse(right.lastModifiedDate ?? '') - Date.parse(left.lastModifiedDate ?? '');
  if (Number.isFinite(modifiedDiff) && modifiedDiff !== 0) {
    return modifiedDiff;
  }

  return String(left.file ?? '').localeCompare(String(right.file ?? ''));
}

export default MonitorRun;
