import {Command, Flags} from '@oclif/core';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  TaskOrchestrator,
  ensureTestsDirectory,
  ensurePlaywrightReady,
  buildFrontdoorUrlFromOrgDisplay,
  ensurePlaywrightTestDependency,
  executeCommandLive,
  extractPlaywrightFailureDetails,
  resolveTestFilePath,
} from '../../../utils/task/orchestrator.js';

class TaskPlay extends Command {
  static summary = 'Reproduce una grabación de Playwright en una org de Salesforce con hardening y diagnóstico orquestado.';

  static flags = {
    org: Flags.string({
      char: 'o',
      summary: 'Alias de sf-cli para la org en la que se ejecutará la tarea.',
      required: false,
    }),
    'target-org': Flags.string({
      summary: 'Alias alternativo compatible con la convención de Salesforce CLI.',
      required: false,
    }),
    tstname: Flags.string({
      summary: 'Nombre del archivo .ts generado por el comando record.',
      required: true,
    }),
    header: Flags.boolean({
      summary: 'Muestra el navegador durante la ejecución.',
      default: false,
    }),
    'vlocity-job-time': Flags.integer({
      summary: 'Tiempo de espera (en segundos) después de confirmar Maintenance Jobs.',
      default: 180,
    }),
    ai: Flags.boolean({
      summary: 'Activa una capa opcional de estabilización asistida por IA sobre el archivo .metadelta.* ya parcheado.',
      default: false,
    }),
    'ai-provider': Flags.string({
      summary: 'Proveedor de IA para estabilización opcional (actualmente: gemini).',
      required: false,
    }),
    'ai-key': Flags.string({
      summary: 'API key del proveedor IA. No se guarda en disco.',
      required: false,
    }),
    'ai-model': Flags.string({
      summary: 'Modelo Gemini opcional (ejemplo: gemini-2.0-flash). También puede definirse por METADELTA_AI_MODEL o GEMINI_MODEL.',
      required: false,
    }),
  };

  async run() {
    const {flags} = await this.parse(TaskPlay);
    const orchestrator = new TaskOrchestrator({commandName: 'metadelta task play'});
    if (flags['target-org'] && flags.org && flags['target-org'] !== flags.org) {
      this.error('Los valores de --org y --target-org no pueden diferir.');
    }

    const targetOrg = flags.org || flags['target-org'];
    if (!targetOrg) {
      this.error('Debes indicar la org con --org o --target-org.');
    }
    const testFile = resolveTestFilePath({name: flags.tstname});

    try {
      ensureTestsDirectory();
      if (!testFile || !fs.existsSync(testFile)) {
        this.error(`No se encontró el archivo de prueba: ${flags.tstname}`);
      }

      const {cacheDir, cliPath} = ensurePlaywrightTestDependency(process.cwd());
      ensurePlaywrightReady({baseDir: process.cwd(), playwrightCliPath: cliPath});
      const url = buildFrontdoorUrlFromOrgDisplay(targetOrg);
      const baseOrigin = this.extractBaseOrigin(url);
      const patchedTestFile = this.createPatchedTestFile(testFile, flags['vlocity-job-time']);
      const aiOutcome = await this.maybeCreateAiEnhancedTestFile({
        aiEnabled: Boolean(flags.ai),
        aiProvider: flags['ai-provider'],
        aiKey: flags['ai-key'],
        aiModel: flags['ai-model'],
        originalTestFile: testFile,
        patchedTestFile,
      });
      const executionTestFile = aiOutcome.executionFile;
      this.log(
        [
          `AI mode: ${aiOutcome.enabled ? 'enabled' : 'disabled'}`,
          aiOutcome.provider ? `provider=${aiOutcome.provider}` : null,
          aiOutcome.model ? `model=${aiOutcome.model}` : null,
          `result=${aiOutcome.result}`,
          `executionFile=${executionTestFile}`,
        ]
          .filter(Boolean)
          .join(' | ')
      );
      this.writeAiDiagnosticsSummary(aiOutcome, executionTestFile);
      const configPath = this.createPlaywrightConfig(executionTestFile);
      const args = this.buildPlaywrightArgs({cliPath, configPath, header: flags.header});

      this.log(`Ejecutando prueba en ${targetOrg} con archivo ${executionTestFile}`);

      const result = await executeCommandLive(process.execPath, args, {
        env: {
          ...process.env,
          METADELTA_BASE_URL: baseOrigin,
          METADELTA_FRONTDOOR_URL: url,
          METADELTA_VLOCITY_JOB_WAIT_MS: String((flags['vlocity-job-time'] ?? 180) * 1000),
          NODE_PATH: cacheDir ? path.join(cacheDir, 'node_modules') : process.env.NODE_PATH,
        },
      });

      if (result.status !== 0) {
        const genericMessage = [
          'La ejecución de Playwright finalizó con errores.',
          result.error?.message ? `Detalle: ${result.error.message}` : null,
          typeof result.status === 'number' ? `Código de salida: ${result.status}` : null,
          result.signal ? `Señal: ${result.signal}` : null,
        ]
          .filter(Boolean)
          .join(' ');
        const failure = extractPlaywrightFailureDetails(
          [result.stdout, result.stderr].filter(Boolean).join('\n'),
          genericMessage
        );
        const detailedError = new Error(failure.summary || genericMessage);
        detailedError.stack = failure.outputExcerpt || detailedError.stack;
        detailedError.playwrightMatcherText = failure.matcherText;
        detailedError.playwrightSummary = failure.summary;
        detailedError.playwrightExitCode = result.status;
        detailedError.playwrightSignal = result.signal;
        throw detailedError;
      }

      fs.rmSync(configPath, {force: true});
      fs.rmSync(patchedTestFile, {force: true});
      if (aiOutcome.generatedAiFile) {
        fs.rmSync(aiOutcome.generatedAiFile, {force: true});
      }
    } catch (error) {
      const diagnosticMessage = error.playwrightMatcherText || error.message;
      orchestrator.recordError({
        message: diagnosticMessage,
        stack: error.stack,
        context: {
          org: targetOrg,
          testFile: flags.tstname,
          playwrightSummary: error.playwrightSummary || error.message,
          playwrightExitCode: error.playwrightExitCode ?? null,
          playwrightSignal: error.playwrightSignal ?? null,
        },
      });
      const solution = orchestrator.findSolution(diagnosticMessage);
      if (solution) {
        this.error(`${error.playwrightSummary || error.message}\nSugerencia: ${solution.solution}`);
      }
      this.error(error.playwrightSummary || error.message);
    }
  }

  extractBaseOrigin(frontdoorUrl) {
    try {
      return new URL(frontdoorUrl).origin;
    } catch (error) {
      return frontdoorUrl;
    }
  }

  createPlaywrightConfig(testFile) {
    const configPath = path.resolve(process.cwd(), 'tests', '.metadelta.playwright.config.cjs');
    const testDir = path.dirname(testFile);
    const testBase = path.basename(testFile);
    const contents = `module.exports = {
  testDir: ${JSON.stringify(testDir)},
  testMatch: [${JSON.stringify(testBase)}],
};\n`;
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, contents, 'utf8');
    return configPath;
  }

  buildPlaywrightArgs({cliPath, configPath, header}) {
    const args = [cliPath, 'test', '--config', configPath, '--reporter', 'line'];
    if (header) {
      args.push('--headed');
    }
    return args;
  }

  async maybeCreateAiEnhancedTestFile({aiEnabled, aiProvider, aiKey, aiModel, originalTestFile, patchedTestFile}) {
    const provider = (aiProvider || 'gemini').toLowerCase();
    if (!aiEnabled) {
      return {
        enabled: false,
        provider: null,
        model: null,
        result: 'ai-disabled',
        executionFile: patchedTestFile,
        generatedAiFile: null,
      };
    }

    const resolvedKey = aiKey || process.env.METADELTA_AI_KEY || process.env.GEMINI_API_KEY;
    if (!resolvedKey) {
      this.warn(
        'AI habilitada sin credenciales. Usa --ai-key (o GEMINI_API_KEY / METADELTA_AI_KEY). Se usará el archivo determinista.'
      );
      return {
        enabled: true,
        provider,
        model: null,
        result: 'fallback-missing-config',
        executionFile: patchedTestFile,
        generatedAiFile: null,
      };
    }

    if (provider !== 'gemini') {
      this.warn(`Proveedor AI no soportado: ${provider}. Proveedor actual soportado: gemini. Se usará el archivo determinista.`);
      return {
        enabled: true,
        provider,
        model: null,
        result: 'fallback-unsupported-provider',
        executionFile: patchedTestFile,
        generatedAiFile: null,
      };
    }

    try {
      const originalContent = fs.readFileSync(originalTestFile, 'utf8');
      const patchedContent = fs.readFileSync(patchedTestFile, 'utf8');
      const diagnosticExcerpt = this.getRecentTaskDiagnosticExcerpt();
      const model = await this.resolveGeminiModel({apiKey: resolvedKey, preferredModel: aiModel});
      const aiResponse = await this.requestGeminiStabilization({
        apiKey: resolvedKey,
        model,
        originalContent,
        patchedContent,
        diagnosticExcerpt,
      });

      const parsedPlan = this.parseAiHardeningPlan(aiResponse);
      if (!parsedPlan.valid) {
        this.warn(`La salida IA fue inválida para hardening dirigido (${parsedPlan.reason}). Se usará el archivo determinista.`);
        return {
          enabled: true,
          provider,
          model,
          result: 'fallback-invalid-ai-output',
          executionFile: patchedTestFile,
          generatedAiFile: null,
        };
      }

      const effectiveChanges = this.ensureMandatoryFragilityChanges(patchedContent, parsedPlan.changes);
      const aiContent = this.applyAiHardeningPlan(patchedContent, effectiveChanges);
      if (!this.isValidAiPatchedTestContent(aiContent)) {
        this.warn('La IA devolvió una propuesta que dañó la estructura base del test. Se usará el archivo determinista.');
        return {
          enabled: true,
          provider,
          model,
          result: 'fallback-invalid-ai-output',
          executionFile: patchedTestFile,
          generatedAiFile: null,
        };
      }

      const normalizedAiContent = aiContent.trim();
      const normalizedPatchedContent = patchedContent.trim();
      const syntaxValidation = this.validateAiTypescriptSyntax(normalizedAiContent, patchedTestFile);
      if (!syntaxValidation.valid) {
        this.warn(
          `La salida IA fue inválida para TypeScript/Playwright (${syntaxValidation.reason}). Se usará el archivo determinista.`
        );
        return {
          enabled: true,
          provider,
          model,
          result: 'fallback-invalid-ai-output',
          executionFile: patchedTestFile,
          generatedAiFile: null,
        };
      }

      if (normalizedAiContent === normalizedPatchedContent) {
        return {
          enabled: true,
          provider,
          model,
          result: 'no-changes-required',
          executionFile: patchedTestFile,
          generatedAiFile: null,
        };
      }

      const aiEnhancedPath = this.createAiEnhancedTestFilePath(patchedTestFile);
      fs.writeFileSync(aiEnhancedPath, `${normalizedAiContent}\n`, 'utf8');
      return {
        enabled: true,
        provider,
        model,
        result: 'ai-safe-hardening-applied',
        executionFile: aiEnhancedPath,
        generatedAiFile: aiEnhancedPath,
      };
    } catch (error) {
      this.warn(`No fue posible aplicar estabilización IA (${provider}): ${error.message}. Se usará el archivo determinista.`);
      return {
        enabled: true,
        provider,
        model: null,
        result: 'fallback-provider-error',
        executionFile: patchedTestFile,
        generatedAiFile: null,
      };
    }
  }

  createAiEnhancedTestFilePath(patchedTestFile) {
    const directory = path.dirname(patchedTestFile);
    const extension = path.extname(patchedTestFile) || '.ts';
    const basename = path.basename(patchedTestFile, extension);
    return path.join(directory, `${basename}.ai${extension}`);
  }

  getRecentTaskDiagnosticExcerpt() {
    try {
      const orchestratorPath = path.resolve(process.cwd(), '.metadelta', 'metadelta-task-orchestrator.json');
      if (!fs.existsSync(orchestratorPath)) {
        return '';
      }
      const raw = fs.readFileSync(orchestratorPath, 'utf8');
      const trimmed = raw.trim();
      return trimmed.length > 4000 ? trimmed.slice(-4000) : trimmed;
    } catch (error) {
      return '';
    }
  }

  writeAiDiagnosticsSummary(aiOutcome, executionFile) {
    try {
      const metaDir = path.resolve(process.cwd(), '.metadelta');
      fs.mkdirSync(metaDir, {recursive: true});
      const summaryPath = path.join(metaDir, 'metadelta-task-ai-summary.json');
      const summary = {
        timestamp: new Date().toISOString(),
        enabled: aiOutcome.enabled,
        provider: aiOutcome.provider,
        model: aiOutcome.model,
        result: aiOutcome.result,
        executionFile,
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    } catch (error) {
      this.warn(`No se pudo escribir resumen AI de diagnóstico: ${error.message}`);
    }
  }

  isValidAiPatchedTestContent(content) {
    if (!content || typeof content !== 'string' || content.trim().length < 50) {
      return false;
    }
    const normalized = content.trim();
    const looksLikePlaywright = normalized.includes("from '@playwright/test'") && /test\s*\(/.test(normalized);
    const preservesMetadeltaCore =
      normalized.includes('METADELTA_HELPERS_BEGIN') &&
      normalized.includes('runTaskOrchestrator') &&
      normalized.includes('gotoWithRetry');
    return looksLikePlaywright && preservesMetadeltaCore;
  }

  validateAiTypescriptSyntax(content, patchedTestFile) {
    if (/```[a-z]*\s*[\s\S]*```/i.test(content)) {
      return {valid: false, reason: 'markdown fences detectados'};
    }
    const sourceFile = ts.createSourceFile(
      this.createAiEnhancedTestFilePath(patchedTestFile),
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    if (sourceFile.parseDiagnostics.length > 0) {
      const firstDiagnostic = sourceFile.parseDiagnostics[0];
      const message = ts.flattenDiagnosticMessageText(firstDiagnostic.messageText, '\n');
      return {valid: false, reason: message};
    }
    return {valid: true, reason: 'ok'};
  }

  parseAiHardeningPlan(aiResponse) {
    if (!aiResponse || typeof aiResponse !== 'string' || !aiResponse.trim()) {
      return {valid: false, reason: 'respuesta vacía'};
    }
    if (/```/i.test(aiResponse)) {
      return {valid: false, reason: 'markdown fences detectados'};
    }

    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
    } catch (error) {
      return {valid: false, reason: 'JSON inválido en plan AI'};
    }

    const rawChanges = Array.isArray(parsed?.changes) ? parsed.changes : [];
    const allowedTypes = new Set([
      'setup_button_disambiguation',
      'quick_find_ready_guard',
      'click_ready_guard',
      'iframe_readiness_guard',
    ]);
    const changes = rawChanges.filter((entry) => allowedTypes.has(entry?.type));
    return {valid: true, changes};
  }

  ensureMandatoryFragilityChanges(source, changes) {
    const normalizedChanges = Array.isArray(changes) ? [...changes] : [];
    const types = new Set(normalizedChanges.map((entry) => entry.type));
    if (this.hasAmbiguousSetupSelector(source) && !types.has('setup_button_disambiguation')) {
      normalizedChanges.push({
        type: 'setup_button_disambiguation',
        reason: 'mandatory-known-fragility-setup-selector',
      });
    }
    return normalizedChanges;
  }

  hasAmbiguousSetupSelector(source) {
    return /getByRole\('button',\s*\{\s*name:\s*'Setup'\s*\}\)\.click\(\);/.test(source);
  }

  applyAiHardeningPlan(source, changes) {
    let updated = source;
    const changeTypes = new Set((changes || []).map((entry) => entry.type));

    if (changeTypes.has('setup_button_disambiguation')) {
      updated = updated.replace(
        /await\s+page\.getByRole\('button',\s*\{\s*name:\s*'Setup'\s*\}\)\.click\(\);/g,
        `{
    const globalSetupButton = page.locator('a.slds-global-actions__setup, button.slds-global-actions__setup').first();
    if ((await globalSetupButton.count()) > 0) {
      await globalSetupButton.waitFor({state: 'visible', timeout: 15000});
      await globalSetupButton.click({timeout: 15000});
    } else {
      const setupButtonExact = page.getByRole('button', {name: 'Setup', exact: true}).first();
      await setupButtonExact.waitFor({state: 'visible', timeout: 15000});
      await setupButtonExact.click({timeout: 15000});
    }
  }`
      );
    }

    if (changeTypes.has('quick_find_ready_guard')) {
      updated = updated
        .replace(
          /await (\w+)\.getByRole\('searchbox', \{ name: 'Quick Find' \}\)\.click\(\);/g,
          `await $1.getByRole('searchbox', {name: 'Quick Find'}).waitFor({state: 'visible', timeout: 15000});
  await $1.getByRole('searchbox', {name: 'Quick Find'}).click({timeout: 15000});`
        )
        .replace(
          /await (\w+)\.getByRole\('searchbox', \{ name: 'Quick Find' \}\)\.fill\('([^']+)'\);/g,
          `await $1.getByRole('searchbox', {name: 'Quick Find'}).waitFor({state: 'visible', timeout: 15000});
  await $1.getByRole('searchbox', {name: 'Quick Find'}).fill('$2');`
        );
    }

    if (changeTypes.has('iframe_readiness_guard')) {
      updated = updated.replace(
        /const vf = await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.first\(\)\.contentFrame\(\);/g,
        `const vfLocator = $1.locator('iframe[name^="vfFrameId_"]').first();
  await vfLocator.waitFor({timeout: 15000});
  const vf = await vfLocator.contentFrame();`
      );
    }

    if (changeTypes.has('click_ready_guard')) {
      updated = updated.replace(
        /await (\w+)\.getByRole\('button', \{ name: 'OK' \}\)\.click\(\);/g,
        `await $1.getByRole('button', {name: 'OK'}).waitFor({state: 'visible', timeout: 15000});
  await $1.getByRole('button', {name: 'OK'}).click({timeout: 15000});`
      );
    }

    return updated;
  }

  buildAiSystemInstruction() {
    return [
      'Eres un asistente de hardening preventivo para playback Playwright de Salesforce orientado a CI/CD.',
      'No reescribas el archivo completo. Solo analiza fragilidad y devuelve un plan JSON mínimo.',
      'Preserva intención funcional y helpers/metadelta existentes.',
      'Prioriza riesgos: selector Setup ambiguo, Quick Find sin waits, iframe readiness, click/fill sin ready state.',
      'No incluyas markdown fences, comentarios ni texto fuera de JSON.',
      'Respuesta obligatoria: {"changes":[{"type":"setup_button_disambiguation|quick_find_ready_guard|click_ready_guard|iframe_readiness_guard","reason":"..."}]}.',
    ].join('\n');
  }

  buildAiUserPrompt({originalContent, patchedContent, diagnosticExcerpt}) {
    return [
      'Objetivo: reforzar resiliencia sin alterar intención funcional.',
      '',
      'Contexto de estabilizadores metadelta existentes (preservar):',
      '- navegación con retry (gotoWithRetry),',
      '- recuperación/apertura de Setup popup/tab y rebind de handles,',
      '- waits/scroll helpers para Action Library,',
      '- checks de habilitación de Finish y secuencias de maintenance jobs,',
      '- fallback de App Launcher y guardas de base/frontdoor URL.',
      '',
      'Archivo original grabado:',
      '<<<ORIGINAL_BEGIN>>>',
      originalContent,
      '<<<ORIGINAL_END>>>',
      '',
      'Archivo patched determinista (base que debes preservar):',
      '<<<PATCHED_BEGIN>>>',
      patchedContent,
      '<<<PATCHED_END>>>',
      '',
      'Extracto diagnóstico reciente (si existe):',
      diagnosticExcerpt || '(sin diagnóstico adicional)',
      '',
      'Recuerda: salida = JSON válido con "changes". Si no hay mejoras seguras, devuelve {"changes":[]}.',
    ].join('\n');
  }

  extractGeminiTextResponse(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return '';
    }
    return parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }

  normalizeGeminiModelName(modelName) {
    const normalized = (modelName || '').trim();
    if (!normalized) {
      return '';
    }
    return normalized.startsWith('models/') ? normalized : `models/${normalized}`;
  }

  async resolveGeminiModel({apiKey, preferredModel}) {
    const configuredModel = preferredModel || process.env.METADELTA_AI_MODEL || process.env.GEMINI_MODEL;
    const normalizedConfiguredModel = this.normalizeGeminiModelName(configuredModel);
    if (normalizedConfiguredModel) {
      return normalizedConfiguredModel;
    }

    try {
      const listEndpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(listEndpoint, {method: 'GET'});
      if (!response.ok) {
        return 'models/gemini-2.0-flash';
      }
      const payload = await response.json();
      const models = Array.isArray(payload?.models) ? payload.models : [];
      const compatible = models.filter((entry) =>
        Array.isArray(entry?.supportedGenerationMethods) && entry.supportedGenerationMethods.includes('generateContent')
      );
      const preferredPatterns = [/gemini-2\.5-flash/i, /gemini-2\.0-flash/i, /gemini-1\.5-flash/i];
      for (const pattern of preferredPatterns) {
        const match = compatible.find((entry) => pattern.test(entry?.name || ''));
        if (match?.name) {
          return match.name;
        }
      }
      const firstGemini = compatible.find((entry) => /models\/gemini/i.test(entry?.name || ''));
      if (firstGemini?.name) {
        return firstGemini.name;
      }
    } catch (error) {
      return 'models/gemini-2.0-flash';
    }

    return 'models/gemini-2.0-flash';
  }

  async requestGeminiStabilization({apiKey, model, originalContent, patchedContent, diagnosticExcerpt}) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      systemInstruction: {
        role: 'system',
        parts: [{text: this.buildAiSystemInstruction()}],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: this.buildAiUserPrompt({
                originalContent,
                patchedContent,
                diagnosticExcerpt,
              }),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        topP: 1,
      },
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        throw new Error(`Modelo Gemini no disponible o incompatible con generateContent (${model}).`);
      }
      throw new Error(`Gemini response ${response.status}: ${errorText.slice(0, 300)}`);
    }
    const payload = await response.json();
    return this.extractGeminiTextResponse(payload);
  }

  applyStructuralStabilizers(source) {
    let stabilized = source;
    stabilized = this.fixSelfReferencingBaseUrl(stabilized);
    stabilized = this.normalizeSetupPopupSequence(stabilized);
    stabilized = this.normalizeEinsteinSetupRefreshSequence(stabilized);
    stabilized = this.normalizeSetupRefreshCloseReopenSequence(stabilized);
    stabilized = this.fixDuplicatePopupPromises(stabilized);
    stabilized = this.rebindClosedPopupPageHandles(stabilized);
    stabilized = this.removePostReopenSetupClicks(stabilized);
    stabilized = this.removeOrphanPopupPromises(stabilized);
    return stabilized;
  }

  fixSelfReferencingBaseUrl(source) {
    return source.replace(
      /const\s+baseUrl\s*=\s*process\.env\.METADELTA_BASE_URL\s*\?\?\s*baseUrl\s*;/g,
      "const baseUrl = process.env.METADELTA_BASE_URL ?? 'https://login.salesforce.com';"
    );
  }

  fixDuplicatePopupPromises(source) {
    const promiseCount = new Map();
    return source.replace(/const\s+(page\d*Promise)\s*=\s*([\w$.]+)\.waitForEvent\('popup'\);/g, (match, name, pageRef) => {
      const count = (promiseCount.get(name) ?? 0) + 1;
      promiseCount.set(name, count);
      if (count === 1) {
        return match;
      }
      const renamed = `${name}_${count}`;
      return `const ${renamed} = ${pageRef}.waitForEvent('popup');`;
    });
  }

  normalizeSetupPopupSequence(source) {
    return source.replace(
      /(\s*)await page\.getByRole\('button', \{ name: 'Setup' \}\)\.click\(\);\n((?:\s*(?:await page\.(?:goto|waitForTimeout)\([^\n]+\);|\/\/[^\n]*)\n)*)\s*const (page\d*Promise) = page\.waitForEvent\('popup'\);\n\s*await page\.getByRole\('menuitem', \{ name: 'Setup Opens in a new tab Setup for current app' \}\)\.click\(\);\n\s*const (page\d+) = await \3;/g,
      (match, indent, intermediateSteps = '', _promiseVar, pageVar) => {
        const normalizedSteps = intermediateSteps ? intermediateSteps.replace(/\s+$/, '\n') : '';
        return `${indent}${normalizedSteps}${indent}const ${pageVar} = await openSetupPopup(page);\n`;
      }
    );
  }

  normalizeEinsteinSetupRefreshSequence(source) {
    const toggleRegex = /await\s+(page\d*)\.getByRole\('link', \{ name: 'Einstein Setup' \}\)\.click\(\);\n\s*await\s+\1\.locator\('\.slds-checkbox_faux'\)\.first\(\)\.click\(\);/g;
    let updated = source;
    const matches = [...source.matchAll(toggleRegex)];

    for (const match of matches) {
      const pageVar = match[1];
      const endIndex = (match.index ?? -1) + match[0].length;
      if (endIndex < 0) {
        continue;
      }

      const afterToggle = updated.slice(endIndex);
      if (!new RegExp(`\\b${pageVar}\\.`).test(afterToggle)) {
        continue;
      }
      const hasExplicitClose = new RegExp(`await\\s+${pageVar}\\.close\\(\\);`).test(afterToggle);
      if (hasExplicitClose) {
        continue;
      }

      const refreshedVar = `${pageVar}EinsteinRefreshed`;
      const refreshSnippet = `\n  const ${refreshedVar} = await reopenSetupAfterEinsteinToggle(${pageVar}, page);\n`;
      updated = `${updated.slice(0, endIndex)}${refreshSnippet}${updated.slice(endIndex)}`;

      const injectedAt = endIndex + refreshSnippet.length;
      const tail = updated.slice(injectedAt).replace(new RegExp(`\\b${pageVar}\\.`, 'g'), `${refreshedVar}.`);
      updated = `${updated.slice(0, injectedAt)}${tail}`;
    }

    return updated;
  }

  normalizeSetupRefreshCloseReopenSequence(source) {
    return source.replace(
      /await\s+(page\d+)\.keyboard\.press\('Control\+R'\);\n\s*await\s+\1\.close\(\);\n\s*const\s+(page\d+Reopened)\s*=\s*await\s+openSetupPopup\(page\);/g,
      `await forceFullPageRefresh($1);\n  await $1.close();\n  const $2 = await openSetupPopup(page);`
    );
  }



  removePostReopenSetupClicks(source) {
    return source.replace(
      /\n\s*await page\.getByRole\('button', \{ name: 'Setup' \}\)\.click\(\);(?=\n\s*(?:(?:\/\/[^\n]*|console\.log\([^\n]*\));\n\s*)*await page\d*Reopened\.getByRole\('searchbox', \{ name: 'Quick Find' \}\)\.click\(\);)/g,
      ''
    );
  }

  removeOrphanPopupPromises(source) {
    const declarationRegex = /const\s+(page\d*Promise(?:_\d+)?)\s*=\s*[\w$.]+\.waitForEvent\('popup'\);\n?/g;
    return source.replace(declarationRegex, (match, promiseVar, offset, fullSource) => {
      const remaining = fullSource.slice(offset + match.length);
      const awaitPattern = new RegExp(`await\\s+${promiseVar}\\b`);
      return awaitPattern.test(remaining) ? match : '';
    });
  }

  rebindClosedPopupPageHandles(source) {
    const closeRegex = /await\s+(page\d*)\.close\(\);/g;
    let updated = source;
    const matches = [...source.matchAll(closeRegex)];

    for (const match of matches) {
      const pageVar = match[1];
      const closeStatement = match[0];
      const closeIndex = match.index ?? -1;
      if (closeIndex < 0) {
        continue;
      }

      const afterClose = updated.slice(closeIndex + closeStatement.length);
      if (!new RegExp(`\\b${pageVar}\\.`).test(afterClose)) {
        continue;
      }

      const reopenedVar = `${pageVar}Reopened`;
      const reopenSnippet = `
  const ${reopenedVar} = await openSetupPopup(page);
`;

      updated = `${updated.slice(0, closeIndex + closeStatement.length)}${reopenSnippet}${updated.slice(closeIndex + closeStatement.length)}`;

      const injectedAt = closeIndex + closeStatement.length + reopenSnippet.length;
      const tail = updated.slice(injectedAt).replace(new RegExp(`\\b${pageVar}\\.`, 'g'), `${reopenedVar}.`);
      updated = `${updated.slice(0, injectedAt)}${tail}`;
    }

    return updated;
  }


  createPatchedTestFile(testFile, vlocityJobTime) {
    const patchedPath = path.resolve(process.cwd(), 'tests', `.metadelta.${path.basename(testFile)}`);
    const original = fs.readFileSync(testFile, 'utf8');
    const stabilizedOriginal = this.applyStructuralStabilizers(original);
    this.ensureRoutesFile();
    const injected = this.applyPatchedTestNormalizations(stabilizedOriginal, vlocityJobTime);

    const legacyOrPartialHelperIssue = this.detectLegacyOrPartialHelperIssue(injected);
    if (legacyOrPartialHelperIssue) {
      throw new Error(
        [
          `El archivo de prueba parece contener helper legacy o contaminación parcial y no se puede inyectar automáticamente (${patchedPath}).`,
          `Detalle: ${legacyOrPartialHelperIssue}`,
          'Acción sugerida: elimina los helpers legacy/parciales del archivo fuente o deja únicamente el bloque helper completo con markers METADELTA_HELPERS_BEGIN/END antes de reintentar.',
        ].join('\n')
      );
    }

    const withHelper = this.injectHelperBlockIfNeeded(injected);
    return this.writeValidatedPatchedTestFile(patchedPath, withHelper);
  }

  applyPatchedTestNormalizations(stabilizedOriginal, vlocityJobTime) {
    const normalizedFrames = this.shouldNormalizeVisualforceFrames()
      ? stabilizedOriginal
          .replace(/vfFrameId_\d+/g, 'vfFrameId_')
          .replace(/iframe\[name="vfFrameId_"\]/g, 'iframe[name^="vfFrameId_"]')
          .replace(/iframe\[name="vfFrameId_\d+"\]/g, 'iframe[name^="vfFrameId_"]')
      : stabilizedOriginal;
    const normalizedButtons = this.shouldNormalizeGenericButtonSelectors()
      ? normalizedFrames.replace(
          /contentFrame\(\)\.locator\('button:nth-child\(2\)'\)/g,
          "contentFrame().getByRole('button', { name: /Start/i })"
        )
      : normalizedFrames;
    const normalizedStartRole = this.shouldNormalizeGenericButtonSelectors()
      ? normalizedButtons
          .replace(
            /contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)/g,
            "contentFrame().getByRole('button', { name: /Start/i }).first()"
          )
          .replace(
            /contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\)/g,
            "contentFrame().getByRole('button', { name: /Start/i }).first().click({force: true})"
          )
          .replace(
            /contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\)\.toBeVisible\(\)/g,
            "contentFrame().getByRole('button', { name: /Start/i }).first()).toBeVisible()"
          )
      : normalizedButtons;

    // -------------------------------------------------------------------------
    // REGLAS GENÉRICAS DE NORMALIZACIÓN (reutilizables entre múltiples flujos)
    // -------------------------------------------------------------------------
    const normalizedAppLauncherSearchClick = normalizedStartRole.replace(
      /await page\.getByRole\('combobox', \{ name: 'Search apps and items\.\.\.' \}\)\.click\(\);/g,
      `{
    const launcherSearch = page.getByRole('combobox', {name: 'Search apps and items...'}).first();
    if ((await launcherSearch.count()) === 0) {
      const launcherButton = page.getByRole('button', {name: 'App Launcher'}).first();
      if (await launcherButton.count()) {
        await launcherButton.click({timeout: 15000});
      }
    }
    if ((await launcherSearch.count()) > 0) {
      await launcherSearch.click({timeout: 15000});
    } else {
      const launcherFallback = page.getByPlaceholder('Search apps and items...').first();
      await launcherFallback.waitFor({timeout: 15000});
      await launcherFallback.click({timeout: 15000});
    }
  }`
    );
    const normalizedAppLauncherSearchFill = normalizedAppLauncherSearchClick.replace(
      /await page\.getByRole\('combobox', \{ name: 'Search apps and items\.\.\.' \}\)\.fill\('([^']+)'\);/g,
      `{
    const launcherSearch = page.getByRole('combobox', {name: 'Search apps and items...'}).first();
    if ((await launcherSearch.count()) > 0) {
      await launcherSearch.fill('$1');
    } else {
      const launcherFallback = page.getByPlaceholder('Search apps and items...').first();
      await launcherFallback.waitFor({timeout: 15000});
      await launcherFallback.fill('$1');
    }
  }`
    );
    const normalizedOptionClick = normalizedAppLauncherSearchFill.replace(
      /await page\.getByRole\('option', \{ name: 'Vlocity CMT Administration' \}\)\.click\(\);/g,
      `{
    const option = page.getByRole('option', {name: 'Vlocity CMT Administration'});
    if (await option.count()) {
      await option.first().click({timeout: 15000});
    } else {
      const optionByRole = page.locator('[role="option"]').filter({hasText: 'Vlocity CMT Administration'}).first();
      if (await optionByRole.count()) {
        await optionByRole.click({timeout: 15000, force: true});
      } else {
        await page.getByText('Vlocity CMT Administration').first().click({timeout: 15000, force: true});
      }
    }
  }`
    );
    const normalizedStatusWaits = normalizedOptionClick
      .replace(
        /await expect\(([^)]+getByText\('InProgress'\)[^)]*)\)\.toBeVisible\(\{timeout: 120000\}\);/g,
        `await expect.poll(async () => await $1.count(), {timeout: 300000}).toBeGreaterThan(0);`
      )
      .replace(
        /await expect\(([^)]+getByText\('Success'\)[^)]*)\)\.toBeVisible\(\{timeout: 120000\}\);/g,
        `await expect.poll(async () => await $1.count(), {timeout: 300000}).toBeGreaterThan(0);`
      )
      .replace(
        /getByText\('InProgress'\)\)\.toBeVisible\(\)/g,
        "getByText('InProgress').first()).toBeVisible({timeout: 300000})"
      )
      .replace(
        /getByText\('Success'\)(?:\.first\(\))?\)\.toBeVisible\(\)/g,
        "getByText('Success').first()).toBeVisible({timeout: 300000})"
      );
    const normalizedStartClicks = normalizedStatusWaits
      .replace(
        /await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\{force: true\}\);/g,
        `await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: /Start/i})
    .first()
    .click({force: true});
  await ensureStartTriggered(page);`
      )
      .replace(
        /await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\);/g,
        `await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: /Start/i})
    .first()
    .click();
  await ensureStartTriggered(page);`
      );
    const normalizedModalStartClicks = normalizedStartClicks.replace(
      /await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: \/Start\/i \}\)\.first\(\)\.click\(\{force: true\}\);/g,
      `await clickModalStartIfPresent(page);
  await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: /Start/i})
    .first()
    .click({force: true});
  await ensureStartTriggered(page);`
    );
    const normalizedExactStartClicks = normalizedModalStartClicks.replace(
      /await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: 'Start' \}\)\.first\(\)\.click\(\);/g,
      `await clickModalStartIfPresent(page);
  await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: 'Start'})
    .first()
    .click({force: true});
  await ensureStartTriggered(page);`
    );
    const normalizedMaintenanceWaits = normalizedExactStartClicks.replace(
      /await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.locator\('([^']*job-start[^']*)'\)\.click\(\);\s*\n\s*await page\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: 'OK' \}\)\.click\(\);/g,
      `await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .locator('$1')
    .click();
  await page
    .locator('iframe[name^="vfFrameId_"]')
    .contentFrame()
    .getByRole('button', {name: 'OK'})
    .click();
  await waitForMaintenanceJob();`
    );

    // -------------------------------------------------------------------------
    // REGLAS ESPECÍFICAS DE FLUJO (Salesforce Setup por dominio funcional)
    // Candidatas a futura extracción por módulo:
    // - Deliverability / User Interface
    // - Agentforce
    // - Permission Set Assignments
    // -------------------------------------------------------------------------
    const normalizedDeliverabilityClick = normalizedMaintenanceWaits.replace(
      /await (\w+)\.getByRole\('link', \{ name: 'Deliverability', exact: true \}\)\.click\(\);/g,
      `{
    const deliverabilityLink = $1.getByRole('link', {name: 'Deliverability', exact: true});
    if (await deliverabilityLink.count()) {
      await deliverabilityLink.first().click({timeout: 15000});
    } else {
      await $1.getByText('Deliverability', {exact: true}).first().click({timeout: 15000});
    }
  }`
    );
    const normalizedUserInterfaceClick = normalizedDeliverabilityClick.replace(
      /await (\w+)\.getByRole\('link', \{ name: 'User Interface' \}\)\.nth\(1\)\.click\(\);/g,
      `{
    const uiLinks = $1.getByRole('link', {name: 'User Interface'});
    if (await uiLinks.nth(1).count()) {
      await uiLinks.nth(1).scrollIntoViewIfNeeded();
      await uiLinks.nth(1).click({timeout: 15000, force: true});
    } else {
      await uiLinks.first().scrollIntoViewIfNeeded();
      await uiLinks.first().click({timeout: 15000, force: true});
    }
  }`
    );
    const normalizedQuickFind = normalizedUserInterfaceClick.replace(
      /await (\w+)\.getByRole\('searchbox', \{ name: 'Quick Find' \}\)\.fill\('([^']+)'\);/g,
      `await $1.getByRole('searchbox', {name: 'Quick Find'}).fill('$2');
  await $1.getByRole('searchbox', {name: 'Quick Find'}).press('Enter');`
    );
    const normalizedAgentforceLink = normalizedQuickFind.replace(
      /await (\w+)\.getByRole\('link', \{ name: 'Agentforce Agents' \}\)\.click\(\);/g,
      `await clickAgentforceAgentsLink($1);`
    );
    const normalizedPermissionSetAssignmentsLink = normalizedAgentforceLink.replace(
      /await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('link', \{ name: 'Permission Set Assignments\[\d+\]' \}\)\.click\(\);/g,
      `{
    const vf = await $1.locator('iframe[name^="vfFrameId_"]').first().contentFrame();
    if (vf) {
      const assignmentLink = vf.getByRole('link', {name: /Permission Set Assignments\\s*\\[\\d+\\]/i}).first();
      if ((await assignmentLink.count()) > 0) {
        await assignmentLink.click({timeout: 15000});
      } else {
        await vf.getByText(/Permission Set Assignments\\s*\\[\\d+\\]/i).first().click({timeout: 15000, force: true});
      }
    }
  }`
    );
    const normalizedPermissionSetAssignmentsRow = normalizedPermissionSetAssignmentsLink.replace(
      /await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('row', \{ name: 'Permission Set Assignments Edit Assignments Permission Set Assignments Help' \}\)\.locator\('input\[name="editPermSetAssignments"\]'\)\.click\(\);/g,
      `{
    const vf = await $1.locator('iframe[name^="vfFrameId_"]').first().contentFrame();
    if (vf) {
      const editAssignmentsButton = vf
        .getByRole('row', {name: /^Permission Set Assignments/i})
        .locator('input[name="editPermSetAssignments"]')
        .first();
      await editAssignmentsButton.click({timeout: 15000});
    }
  }`
    );
    const normalizedIframeHtmlClicks = normalizedPermissionSetAssignmentsRow.replace(
      /await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.locator\('html'\)\.click\(\);/g,
      `// omit iframe html click in patched tests to avoid timeouts in other orgs`
    );
    const normalizedBaseUrls = normalizedIframeHtmlClicks
      .replace(/https:\/\/[^'"]+\.my\.salesforce\.com(\/[^'"]*)?/g, 'baseUrl$1')
      .replace(/https:\/\/[^'"]+\.lightning\.force\.com(\/[^'"]*)?/g, 'baseUrl$1')
      .replace(/https:\/\/[^'"]+\.salesforce-setup\.com(\/[^'"]*)?/g, 'baseUrl$1')
      .replace(/https:\/\/[^'"]+\.salesforce\.com(\/[^'"]*)?/g, 'baseUrl$1')
      .replace(
        /https%3A%2F%2F[^'"]+?(?:my%2Esalesforce%2Ecom|lightning%2Eforce%2Ecom|salesforce-setup%2Ecom|salesforce%2Ecom)%2F/gi,
        'baseUrl/'
      );
    const normalizedBaseUrlExpressions = normalizedBaseUrls
      .replace(/'baseUrl(\/[^']*)'/g, "baseUrl + '$1'")
      .replace(/"baseUrl(\/[^"]*)"/g, "baseUrl + '$1'");
    const normalizedGotoCalls = normalizedBaseUrlExpressions.replace(
      /await (\w+)\.goto\(([^;]+)\);/g,
      `await gotoWithRetry($1, $2);`
    );
    const normalizedActionLibraryCheckboxes = normalizedGotoCalls.replace(
      /await (\w+)\.locator\('#check-button-label-[^']+ > \.slds-checkbox_faux'\)\.click\(\);/g,
      `await selectActionLibraryCheckboxWithScroll($1);`
    );
    const normalizedGenericCheckboxFauxClicks = this.shouldPreserveLegacyCriticalFlowSelectors(normalizedActionLibraryCheckboxes)
      ? normalizedActionLibraryCheckboxes
      : normalizedActionLibraryCheckboxes.replace(
          /await (\w+)\.locator\('\.slds-checkbox_faux'\)\.click\(\);/g,
          `await clickCheckboxFaux($1);`
        );
    const normalizedCheckboxes = normalizedGenericCheckboxFauxClicks.replace(
      /await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('checkbox', \{ name: '([^']+)' \}\)\.(check|uncheck)\(\);/g,
      `{
    const checkbox = await ensureSetupCheckbox($1, '$2', 'User Interface');
    if (checkbox) {
      await checkbox.scrollIntoViewIfNeeded();
      await checkbox.$3({timeout: 15000});
    }
  }`
    );
    const normalizedFinishButtonClick = normalizedCheckboxes.replace(
      /await (\w+)\.getByRole\('button', \{ name: 'Finish' \}\)\.click\(\);/g,
      `await clickFinishWhenEnabled($1);`
    );
    const normalizedSetupSaveClicks = normalizedFinishButtonClick.replace(
      /await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('button', \{ name: 'Save' \}\)\.click\(\);/g,
      `{
    const saveButton = $1
      .locator('iframe[name^="vfFrameId_"]')
      .contentFrame()
      .getByRole('button', {name: 'Save'});
    if (await saveButton.count()) {
      await saveButton.first().click({timeout: 15000});
      await $1.waitForLoadState('domcontentloaded', {timeout: 7000}).catch(() => {});
      await $1.waitForTimeout(600);
    } else {
      console.log('⚠️ Se omite Save porque no existe botón Save visible en el contexto actual.');
    }
  }`
    );
    const normalizedSetupSaveInputClicks = normalizedSetupSaveClicks.replace(
      /await (\w+)\.locator\('iframe\[name\^="vfFrameId_"\]'\)\.contentFrame\(\)\.getByRole\('row', \{ name: '([^']+)', exact: true \}\)\.locator\('input\[name="save"\]'\)\.click\(\);/g,
      `{
    const saveInput = $1
      .locator('iframe[name^="vfFrameId_"]')
      .contentFrame()
      .getByRole('row', {name: '$2', exact: true})
      .locator('input[name="save"]')
      .first();
    if ((await saveInput.count()) > 0) {
      await saveInput.click({timeout: 15000});
      await $1.waitForLoadState('domcontentloaded', {timeout: 7000}).catch(() => {});
      await $1.waitForTimeout(600);
    } else {
      console.log('⚠️ Se omite Save input porque no se encontró input[name=\"save\"] visible.');
    }
  }`
    );
    const normalizedIdempotentCheckboxes = normalizedSetupSaveInputClicks.replace(
      /await ([^;\n]+?getByRole\('checkbox', \{ name: '([^']+)' \}[^;\n]*)\.(check|uncheck)\(\);/g,
      (match, locatorExpression, checkboxName, operation) => {
        const desiredChecked = operation === 'check' ? 'true' : 'false';
        return `await setCheckboxStateIfNeeded(${locatorExpression}, ${desiredChecked}, 'checkbox:${checkboxName}');`;
      }
    );
    const normalizedIdempotentSwitches = normalizedIdempotentCheckboxes.replace(
      /await ([^;\n]+?getByRole\('switch', \{ name: '([^']+)' \}[^;\n]*)\.click\(\);/g,
      (match, locatorExpression, switchName) =>
        `await clickToggleIfNeeded(${locatorExpression}, true, 'switch:${switchName}');`
    );
    const normalizedIdempotentFills = normalizedIdempotentSwitches.replace(
      /await ([^;\n]+?)\.fill\('([^']*)'\);/g,
      (match, locatorExpression, desiredValue) =>
        `await fillIfNeeded(${locatorExpression}, '${desiredValue.replace(/'/g, "\\'")}', 'fill:${desiredValue.slice(0, 32)}');`
    );
    const normalizedOffThenToggle = normalizedIdempotentFills.replace(
      /await expect\(([\w$]+\.locator\('[^']+'\))\.getByText\('Off'\)\)\.toBeVisible\(\);\s*\n\s*await ([^;\n]+?\.locator\('\.slds-checkbox_faux'\)\.first\(\))\.click\(\);/g,
      `await ensureToggleStateFromDescription($1, $2, 'Off', 'On', 'toggle-from-off-expectation');`
    );
    const normalizedClickLogs = normalizedOffThenToggle.replace(
      /await (\w+)\.getByRole\('searchbox', \{ name: 'Quick Find' \}\)\.press\('Enter'\);/g,
      `console.log('➡️ Enter: Quick Find');\n  await $1.getByRole('searchbox', {name: 'Quick Find'}).press('Enter');`
    );
    const normalizedClickLogsFinal = normalizedClickLogs
      .replace(
        /\n(\s*)await ([^;\n]+?getByRole\([^;\n]+?name:\s*'([^']+)'[^;\n]*\))\.click\(([^)]*)\);/g,
        `\n$1console.log('➡️ Click: name: "$3"');\n$1await $2.click($4);`
      )
      .replace(
        /\n(\s*)await ([^;\n]+?getByText\('([^']+)'\)[^;\n]*)\.click\(([^)]*)\);/g,
        `\n$1console.log('➡️ Click: "$3"');\n$1await $2.click($4);`
      );
    const injectedImports = normalizedClickLogsFinal.replace(
      /(import\s+\{\s*test[^;]+;)/,
      `$1\nimport {runTaskOrchestrator} from './metadelta-task-orchestrator-routes.js';`
    );
    const baseUrlDeclaration = injectedImports.includes('const baseUrl')
      ? ''
      : 'const baseUrl = process.env.METADELTA_BASE_URL;\n';
    const injectedBase = injectedImports.replace(
      /(import\s+\{\s*test[^;]+;\n)/,
      `$1${baseUrlDeclaration}`
    );
    const injected = injectedBase.replace(
      /(test\(['"][^'"]+['"],\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{\s*\n)/,
      `$1  test.setTimeout(${Math.max(300000, (vlocityJobTime ?? 180) * 1000 + 120000)});\n  page.setDefaultTimeout(60000);\n  installOrgDomainGuard(page);\n  await gotoWithRetry(page, process.env.METADELTA_FRONTDOOR_URL ?? process.env.METADELTA_BASE_URL);\n  await runTaskOrchestrator(page);\n`
    );
    return injected;
  }

  getPatchedTestHelpersBlock() {
    return `
// METADELTA_HELPERS_BEGIN
// METADELTA_TECHNICAL_HELPERS_BEGIN
async function gotoWithRetry(page, destination, options = {}) {
  const defaultOptions = {waitUntil: 'domcontentloaded', ...options};
  try {
    await page.goto(destination, defaultOptions);
  } catch (error) {
    const message = String(error?.message ?? '');
    if (!/net::ERR_ABORTED/i.test(message)) {
      throw error;
    }
    await page.waitForTimeout(1200);
    await page.goto(destination, defaultOptions);
  }
}

async function openSetupPopup(page, options = {}) {
  const {timeoutMs = 20000, popupTimeoutMs = 60000} = options;
  const setupButton = page.getByRole('button', {name: 'Setup'}).first();
  const setupMenuCandidates = [
    page.getByRole('menuitem', {name: 'Setup Opens in a new tab Setup for current app'}).first(),
    page.getByRole('menuitem', {name: /Setup Opens in a new tab/i}).first(),
    page.getByText(/Setup Opens in a new tab/i).first(),
  ];

  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await setupButton.waitFor({timeout: timeoutMs});
      await setupButton.click({timeout: timeoutMs});

      let setupMenuItem = null;
      for (const candidate of setupMenuCandidates) {
        if ((await candidate.count()) > 0) {
          setupMenuItem = candidate;
          break;
        }
      }

      if (!setupMenuItem) {
        for (const candidate of setupMenuCandidates) {
          try {
            await candidate.waitFor({timeout: Math.max(4000, Math.floor(timeoutMs / 2))});
            setupMenuItem = candidate;
            break;
          } catch (error) {
            lastError = error;
          }
        }
      }

      if (!setupMenuItem) {
        throw lastError ?? new Error('No se encontró el menuitem de Setup para abrir la nueva pestaña.');
      }

      const popupPromise = page.waitForEvent('popup', {timeout: popupTimeoutMs});
      await setupMenuItem.click({timeout: timeoutMs, force: true});
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded', {timeout: 15000}).catch(() => {});
      return popup;
    } catch (error) {
      lastError = error;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(800);
    }
  }

  throw new Error('No se pudo abrir Setup en una nueva pestaña. ' + (lastError?.message ?? 'El menú o popup no estuvo disponible.'));
}

async function forceFullPageRefresh(page, options = {}) {
  const {timeoutMs = 20000} = options;
  const reloadShortcut = process.platform === 'darwin' ? 'Meta+R' : 'Control+R';
  const currentUrl = page.url();
  const strategies = [
    async () => {
      await page.evaluate(() => window.location.reload());
      await page.waitForLoadState('domcontentloaded', {timeout: timeoutMs});
    },
    async () => {
      await page.keyboard.press(reloadShortcut);
      await page.waitForLoadState('domcontentloaded', {timeout: timeoutMs});
    },
    async () => {
      await page.reload({waitUntil: 'domcontentloaded', timeout: timeoutMs});
    },
    async () => {
      if (!currentUrl) {
        throw new Error('No hay URL disponible para forzar el refresh completo.');
      }
      await page.goto(currentUrl, {waitUntil: 'domcontentloaded', timeout: timeoutMs});
    },
  ];

  let lastError = null;
  for (const strategy of strategies) {
    try {
      await strategy();
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error('No se pudo forzar el refresh completo de Setup. ' + (lastError?.message ?? 'Sin detalle adicional.'));
}

async function reopenSetupAfterEinsteinToggle(setupPage, rootPage, options = {}) {
  const {waitMs = 20000, forceReopenAfterRefresh = true} = options;
  await setupPage.waitForTimeout(waitMs);

  if (!setupPage.isClosed() && !forceReopenAfterRefresh) {
    await forceFullPageRefresh(setupPage);
    return setupPage;
  }

  if (!setupPage.isClosed()) {
    await forceFullPageRefresh(setupPage);
    await setupPage.close().catch(() => {});
  }

  await rootPage.bringToFront().catch(() => {});
  return await openSetupPopup(rootPage);
}

async function clickCheckboxFaux(scope, options = {}) {
  const {timeoutMs = 15000} = options;
  const checkboxCandidates = [
    {type: 'click', locator: scope.locator('.slds-checkbox_faux:visible')},
    {type: 'click', locator: scope.locator('[role="checkbox"]:visible')},
    {type: 'check', locator: scope.locator('input[type="checkbox"]:visible')},
  ];

  for (const candidate of checkboxCandidates) {
    const locator = candidate.locator;
    const count = await locator.count();
    if (count === 0) {
      continue;
    }

    const target = locator.first();
    await target.scrollIntoViewIfNeeded().catch(() => {});
    if (count > 1) {
      console.log('⚠️ .slds-checkbox_faux devolvió ' + count + ' elementos; se usará el primero visible.');
    }

    if (candidate.type === 'check') {
      await target.check({timeout: timeoutMs, force: true});
    } else {
      await target.click({timeout: timeoutMs, force: true});
    }
    return;
  }

  throw new Error('No se encontró un checkbox visible compatible para el selector .slds-checkbox_faux.');
}

function logIdempotentSkip(reason) {
  if (!reason) {
    console.log('⏭️ action skipped: already satisfied');
    return;
  }
  console.log('⏭️ action skipped: already satisfied (' + reason + ')');
}

async function readToggleState(locator) {
  try {
    const ariaChecked = await locator.getAttribute('aria-checked');
    if (ariaChecked === 'true') {
      return true;
    }
    if (ariaChecked === 'false') {
      return false;
    }
  } catch (error) {
    // noop
  }

  try {
    const ariaPressed = await locator.getAttribute('aria-pressed');
    if (ariaPressed === 'true') {
      return true;
    }
    if (ariaPressed === 'false') {
      return false;
    }
  } catch (error) {
    // noop
  }

  try {
    const classes = await locator.getAttribute('class');
    if (typeof classes === 'string') {
      if (/\b(is-checked|slds-is-selected|active|checked)\b/i.test(classes)) {
        return true;
      }
      if (/\b(is-unchecked|inactive|off|unchecked)\b/i.test(classes)) {
        return false;
      }
    }
  } catch (error) {
    // noop
  }

  return null;
}

async function setCheckboxStateIfNeeded(locator, desiredChecked, reason = '') {
  const target = locator.first();
  await target.waitFor({state: 'visible', timeout: 15000});
  let currentChecked = null;
  try {
    currentChecked = await target.isChecked();
  } catch (error) {
    currentChecked = await readToggleState(target);
  }

  if (typeof currentChecked === 'boolean' && currentChecked === desiredChecked) {
    logIdempotentSkip(reason || 'checkbox');
    return;
  }

  if (desiredChecked) {
    await target.check({timeout: 15000, force: true});
  } else {
    await target.uncheck({timeout: 15000, force: true});
  }
}

async function clickToggleIfNeeded(locator, desiredOn, reason = '') {
  const target = locator.first();
  await target.waitFor({state: 'visible', timeout: 15000});
  const current = await readToggleState(target);
  if (typeof current === 'boolean' && current === desiredOn) {
    logIdempotentSkip(reason || 'toggle');
    return;
  }

  await target.click({timeout: 15000, force: true});
}

async function fillIfNeeded(locator, desiredValue, reason = '') {
  const target = locator.first();
  await target.waitFor({state: 'visible', timeout: 15000});
  let currentValue = null;
  try {
    currentValue = await target.inputValue();
  } catch (error) {
    currentValue = null;
  }

  if (typeof currentValue === 'string' && currentValue === desiredValue) {
    logIdempotentSkip(reason || 'fill');
    return;
  }

  await target.fill(desiredValue);
}

async function ensureToggleStateFromDescription(containerLocator, toggleLocator, offText = 'Off', onText = 'On', reason = '') {
  const container = containerLocator.first();
  const toggle = toggleLocator.first();
  await container.waitFor({state: 'visible', timeout: 15000}).catch(() => {});
  await toggle.waitFor({state: 'visible', timeout: 15000});

  const offCandidate = container.getByText(offText).first();
  const onCandidate = container.getByText(onText).first();
  const offVisible = (await offCandidate.count()) > 0 && (await offCandidate.isVisible().catch(() => false));
  const onVisible = (await onCandidate.count()) > 0 && (await onCandidate.isVisible().catch(() => false));

  if (onVisible && !offVisible) {
    logIdempotentSkip(reason || 'toggle-already-on');
    return;
  }

  if (offVisible) {
    await toggle.click({timeout: 15000, force: true});
    return;
  }

  await expect(offCandidate).toBeVisible({timeout: 5000});
  await toggle.click({timeout: 15000, force: true});
}

// METADELTA_TECHNICAL_HELPERS_END
// METADELTA_FLOW_SPECIFIC_HELPERS_BEGIN
async function clickAgentforceAgentsLink(page, options = {}) {
  const {attempts = 4, reloadDelayMs = 5000} = options;
  const rootPage = page.context().pages()[0] ?? page;
  let currentPage = page;
  const directSetupPaths = [
    '/lightning/setup/EinsteinCopilot/home',
    '/lightning/setup/AgentforceAgents/home',
    '/lightning/setup/EinsteinGPTSetup/home',
  ];

  // Estrategia legacy exacta (prioritaria para Agentforce crítico).
  const legacyQuickFindAttempt = async (scope) => {
    const quickFind = scope.getByRole('searchbox', {name: 'Quick Find'}).first();
    const agentforceLink = scope.getByRole('link', {name: 'Agentforce Agents'}).first();
    const agentforceText = scope.getByText('Agentforce Agents', {exact: true}).first();
    let quickFindReady = false;

    await scope.waitForLoadState('domcontentloaded').catch(() => {});
    try {
      await quickFind.waitFor({state: 'visible', timeout: 15000});
      await quickFind.click({timeout: 15000});
      await quickFind.fill('Agentforce Agents');
      await quickFind.press('Enter');
      await scope.waitForTimeout(1200);
      quickFindReady = true;
    } catch (error) {
      // seguimos con otras estrategias legacy si Quick Find aún no está listo
    }

    if ((await agentforceLink.count()) > 0) {
      await agentforceLink.click({timeout: 15000});
      return true;
    }

    if (quickFindReady) {
      await scope.waitForLoadState('domcontentloaded');
      await scope.waitForTimeout(3000);
      await forceFullPageRefresh(scope);
      await quickFind.waitFor({state: 'visible', timeout: 15000});
      await quickFind.click({timeout: 15000});
      await quickFind.fill('Agentforce Agents');
      await quickFind.press('Enter');
      await scope.waitForTimeout(1200);
    }

    if ((await agentforceLink.count()) > 0) {
      await agentforceLink.click({timeout: 15000});
      return true;
    }

    if ((await agentforceText.count()) > 0) {
      await agentforceText.click({timeout: 15000, force: true});
      return true;
    }

    return false;
  };

  const legacyCloseReopenAndRetry = async () => {
    if (!currentPage.isClosed() && currentPage !== rootPage) {
      await currentPage.close().catch(() => {});
    }
    await rootPage.bringToFront().catch(() => {});
    currentPage = await openSetupPopup(rootPage);
    await currentPage.waitForLoadState('domcontentloaded').catch(() => {});
    return await legacyQuickFindAttempt(currentPage);
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await currentPage.waitForLoadState('domcontentloaded');

    if (await legacyQuickFindAttempt(currentPage)) {
      return;
    }

    const quickFind = currentPage.getByRole('searchbox', {name: 'Quick Find'}).first();
    const candidateFactories = [
      () => currentPage.getByRole('link', {name: 'Agentforce Agents'}).first(),
      () => currentPage.getByText('Agentforce Agents', {exact: true}).first(),
      () => currentPage.getByText(/Agentforce Agents/i).first(),
    ];

    if ((await quickFind.count()) > 0) {
      for (const searchTerm of ['Agentforce Agents', 'Agentforce']) {
        await quickFind.fill(searchTerm);
        await quickFind.press('Enter');

        for (const buildCandidate of candidateFactories) {
          const candidate = buildCandidate();
          if ((await candidate.count()) > 0) {
            await candidate.click({timeout: 15000, force: true});
            return;
          }
        }
      }
    }

    for (const setupPath of directSetupPaths) {
      try {
        const currentOrigin = new URL(process.env.METADELTA_BASE_URL ?? currentPage.url()).origin;
        await gotoWithRetry(currentPage, currentOrigin + setupPath);
        const newAgentButton = currentPage.getByRole('button', {name: 'New Agent'}).first();
        const agentforceHeading = currentPage.getByText(/Agentforce Agents/i).first();
        if ((await newAgentButton.count()) > 0 || (await agentforceHeading.count()) > 0) {
          return;
        }
      } catch (error) {
        // seguimos con otras estrategias
      }
    }

    if (attempt < attempts - 1) {
      const waitMs = reloadDelayMs + attempt * 2000;
      console.log('⚠️ Agentforce Agents no apareció aún; se esperará ' + waitMs + 'ms y se intentará refrescar Setup sin cambiar de pestaña.');
      await currentPage.waitForTimeout(waitMs);

      if (!currentPage.isClosed()) {
        await forceFullPageRefresh(currentPage);
        continue;
      }

      await rootPage.bringToFront().catch(() => {});
      currentPage = await openSetupPopup(rootPage);
    }
  }

  // Último intento acumulativo: espera más larga por texto exacto tras Quick Find.
  try {
    const finalQuickFind = currentPage.getByRole('searchbox', {name: 'Quick Find'}).first();
    if ((await finalQuickFind.count()) > 0) {
      await finalQuickFind.fill('Agentforce Agents');
      await finalQuickFind.press('Enter');
    }

    await currentPage
      .getByText('Agentforce Agents', {exact: true})
      .first()
      .click({timeout: 30000, force: true});
    return;
  } catch (error) {
    console.log('⚠️ Agentforce Agents no apareció; se intentará reabrir Setup en nueva pestaña.');
    const reopenedFound = await legacyCloseReopenAndRetry();
    console.log('🔁 Setup reabierto, reintentando búsqueda de Agentforce Agents.');
    if (reopenedFound) {
      return;
    }

    const reopenedQuickFind = currentPage.getByRole('searchbox', {name: 'Quick Find'}).first();
    try {
      await reopenedQuickFind.waitFor({state: 'visible', timeout: 15000});
      await reopenedQuickFind.click({timeout: 15000});
      await reopenedQuickFind.fill('Agentforce Agents');
      await reopenedQuickFind.press('Enter');
      await currentPage.waitForTimeout(1200);
    } catch (quickFindError) {
      // mantenemos el intento de click final por texto exacto como último recurso
    }

    try {
      await currentPage
        .getByText('Agentforce Agents', {exact: true})
        .first()
        .click({timeout: 30000, force: true});
      return;
    } catch (reopenError) {
      throw new Error('No se pudo ubicar Agentforce Agents después de agotar las estrategias acumulativas.');
    }
  }
}

async function waitForActionLibraryReady(page, timeoutMs = 45000) {
  const modalContainer = page.locator('section[role="dialog"], .slds-modal__content').first();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const hasModal = (await modalContainer.count()) > 0;
    const rows = hasModal ? modalContainer.locator('tbody tr') : page.locator('tbody tr');
    const checkboxes = hasModal
      ? modalContainer.locator('[id^="check-button-label-"], tbody tr .slds-checkbox_faux, tbody tr input[type="checkbox"]')
      : page.locator('[id^="check-button-label-"], tbody tr .slds-checkbox_faux, tbody tr input[type="checkbox"]');

    const rowCount = await rows.count();
    const checkboxCount = await checkboxes.count();
    const loadingSpinners = hasModal ? modalContainer.locator('.slds-spinner, [role="progressbar"]') : page.locator('.slds-spinner, [role="progressbar"]');
    const spinnerCount = await loadingSpinners.count();

    if ((rowCount > 0 || checkboxCount > 0) && spinnerCount === 0) {
      return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function selectActionLibraryCheckboxWithScroll(page, options = {}) {
  const {requireFinishEnabled = false} = options;
  const modalContainer = page.locator('section[role="dialog"], .slds-modal__content').first();
  const finishButton = page.getByRole('button', {name: 'Finish'}).first();

  await waitForActionLibraryReady(page, 45000);

  async function isFinishReady() {
    return (await finishButton.count()) > 0 && (await finishButton.isEnabled());
  }

  async function trySelectCheckbox() {
    const selectorAttempts = [
      {type: 'click', locator: modalContainer.locator('[id^="check-button-label-"] .slds-checkbox_faux')},
      {type: 'click', locator: modalContainer.locator('[id^="check-button-label-"]')},
      {type: 'click', locator: modalContainer.locator('tbody tr .slds-checkbox_faux')},
      {type: 'click', locator: modalContainer.locator('tbody tr [role="checkbox"]')},
      {type: 'check', locator: modalContainer.locator('tbody tr input[type="checkbox"]')},
    ];

    for (const attempt of selectorAttempts) {
      const locator = attempt.locator;
      if ((await locator.count()) === 0) {
        continue;
      }
      const target = locator.first();
      await target.scrollIntoViewIfNeeded();
      if (attempt.type === 'check') {
        await target.check({timeout: 15000, force: true});
      } else {
        await target.click({timeout: 15000, force: true});
      }
      return true;
    }

    return false;
  }

  async function scrollActionLibrary(direction = 1) {
    const scrollHost = (await modalContainer.count()) > 0 ? modalContainer : page.locator('body');
    await scrollHost.evaluate((node, dir) => {
      const root = node;
      const candidates = [root, ...root.querySelectorAll('*')];
      for (const element of candidates) {
        const style = window.getComputedStyle(element);
        const canScroll =
          (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') &&
          element.scrollHeight > element.clientHeight;
        if (canScroll) {
          element.scrollBy(0, 320 * dir);
        }
      }
    }, direction);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!requireFinishEnabled && (await isFinishReady())) {
      return true;
    }

    const selected = await trySelectCheckbox();
    if (selected) {
      await page.waitForTimeout(500);
      if (!requireFinishEnabled || (await isFinishReady())) {
        return true;
      }
    }

    if (attempt % 4 === 0) {
      await waitForActionLibraryReady(page, 8000);
    }

    const direction = attempt < 14 ? 1 : -1;
    await scrollActionLibrary(direction);
    await page.waitForTimeout(350);
  }

  if (!requireFinishEnabled) {
    console.log('⚠️ No se pudo seleccionar checkbox de Action Library automáticamente; se continuará con el flujo.');
    return false;
  }

  throw new Error('El botón Finish permanece deshabilitado después de intentar seleccionar acciones con scroll.');
}

async function clickFinishWhenEnabled(page) {
  const finishButton = page.getByRole('button', {name: 'Finish'}).first();
  await waitForActionLibraryReady(page, 45000);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await finishButton.count()) > 0 && (await finishButton.isEnabled())) {
      await finishButton.click({timeout: 15000});
      return;
    }

    await selectActionLibraryCheckboxWithScroll(page, {requireFinishEnabled: true});
    await page.waitForTimeout(350);
  }

  throw new Error('El botón Finish permanece deshabilitado después de intentar seleccionar acciones con scroll.');
}


async function waitForMaintenanceJob() {
  const waitMs = Number(process.env.METADELTA_VLOCITY_JOB_WAIT_MS ?? 180000);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function installOrgDomainGuard(page) {
  const base = process.env.METADELTA_BASE_URL;
  if (!base) {
    return;
  }

  const baseOrigin = new URL(base).origin;
  page.context().on('page', async (popup) => {
    try {
      await popup.waitForLoadState('domcontentloaded', {timeout: 15000});
      const current = popup.url();
      if (!current || current.startsWith(baseOrigin) || current.startsWith('about:blank')) {
        return;
      }
      const target = new URL(current);
      const startURL = target.searchParams.get('startURL');
      if (startURL) {
        const decoded = decodeURIComponent(startURL);
        const normalized = decoded.replace(new RegExp('^https?://[^/]+', 'i'), baseOrigin);
        const nextPath = normalized.startsWith(baseOrigin) ? normalized.slice(baseOrigin.length) : normalized;
        await popup.goto(baseOrigin + (nextPath.startsWith('/') ? nextPath : '/' + nextPath));
      } else {
        await popup.goto(baseOrigin + target.pathname + target.search + target.hash);
      }
    } catch (error) {
      // noop
    }
  });
}

let setupSectionReady = false;

function markSetupSectionReady() {
  setupSectionReady = true;
}

function isSetupSectionReady() {
  return setupSectionReady;
}

async function ensureSetupCheckbox(page, label, sectionName) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let vf = null;
    try {
      await frameLocator.waitFor({timeout: 15000});
      vf = await frameLocator.contentFrame();
    } catch (error) {
      vf = null;
    }
    if (vf) {
      const checkbox = vf.getByRole('checkbox', {name: label});
      if ((await checkbox.count()) > 0) {
        return checkbox;
      }
    }
    const setupSearch = page.getByRole('searchbox', {name: 'Search Setup'});
    if ((await setupSearch.count()) > 0) {
      await setupSearch.fill(sectionName);
      await setupSearch.press('Enter');
    }
    const sectionLinks = page.getByRole('link', {name: sectionName});
    if ((await sectionLinks.count()) > 0) {
      const targetLink = (await sectionLinks.count()) > 1 ? sectionLinks.last() : sectionLinks.first();
      await targetLink.scrollIntoViewIfNeeded();
      await targetLink.click({timeout: 15000, force: true});
    }
    await page.waitForTimeout(1000);
    vf = await frameLocator.contentFrame();
    if (vf) {
      const checkbox = vf.getByRole('checkbox', {name: label});
      if ((await checkbox.count()) > 0) {
        return checkbox;
      }
    }
  }
  console.log(
    '⚠️ No se encontró el checkbox "' +
      label +
      '" en la sección "' +
      sectionName +
      '". Se omite este paso.'
  );
  return null;
}

async function clickModalStartIfPresent(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const modalStart = vf
    .locator('section[role="dialog"]')
    .getByRole('button', {name: /Start/i})
    .first();
  const footerStart = vf
    .locator('.slds-modal__footer')
    .getByRole('button', {name: /Start/i})
    .first();
  if ((await modalStart.count()) > 0) {
    await modalStart.click({force: true});
    await modalStart.evaluate((el) => el.click());
    return;
  }
  if ((await footerStart.count()) > 0) {
    await footerStart.click({force: true});
    await footerStart.evaluate((el) => el.click());
  }
}

async function ensureStartTriggered(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  try {
    await frameLocator.waitFor({timeout: 15000});
    const vf = await frameLocator.contentFrame();
    if (!vf) {
      return;
    }
    const inProgress = vf.getByText('InProgress');
    const success = vf.getByText('Success').first();
    const modalStart = vf
      .locator('section[role="dialog"]')
      .getByRole('button', {name: /Start/i})
      .first();
    const footerStart = vf
      .locator('.slds-modal__footer')
      .getByRole('button', {name: /Start/i})
      .first();
    const startButton = vf.getByRole('button', {name: /Start/i}).first();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const hasStatus =
        (await inProgress.count()) > 0 || (await success.count()) > 0;
      if (hasStatus) {
        return;
      }
      if ((await modalStart.count()) > 0) {
        await modalStart.click({force: true});
        await modalStart.evaluate((el) => el.click());
      } else if ((await footerStart.count()) > 0) {
        await footerStart.click({force: true});
        await footerStart.evaluate((el) => el.click());
      } else if ((await startButton.count()) > 0) {
        await startButton.click({force: true});
        await startButton.evaluate((el) => el.click());
      } else {
        return;
      }
      await vf.page().waitForTimeout(1000);
    }
  } catch (error) {
    // noop: si no se puede validar, dejamos que el flujo continúe.
  }
}
// METADELTA_FLOW_SPECIFIC_HELPERS_END
// METADELTA_HELPERS_END
`;
  }

  validatePatchedTestStructure(contents, patchedPath) {
    const failures = [];

    const playwrightImportCount = (contents.match(/import\s+\{[^}]*\}\s+from\s+['"]@playwright\/test['"];/g) ?? []).length;
    if (playwrightImportCount !== 1) {
      failures.push(`Se esperaba exactamente 1 import de @playwright/test y se encontraron ${playwrightImportCount}.`);
    }

    const orchestratorImportCount = (contents.match(/import\s+\{[^}]*\brunTaskOrchestrator\b[^}]*\}\s+from\s+['"]\.\/metadelta-task-orchestrator-routes\.js['"];/g) ?? []).length;
    if (orchestratorImportCount !== 1) {
      failures.push(`Se esperaba exactamente 1 import de runTaskOrchestrator y se encontraron ${orchestratorImportCount}.`);
    }

    const baseUrlDeclarationCount = (contents.match(/\bconst\s+baseUrl\s*=/g) ?? []).length;
    if (baseUrlDeclarationCount !== 1) {
      failures.push(`Se esperaba exactamente 1 declaración global de const baseUrl y se encontraron ${baseUrlDeclarationCount}.`);
    }

    const testBlockCount = (contents.match(/(^|[\s;])test\(/gm) ?? []).length;
    if (testBlockCount !== 1) {
      failures.push(`Se esperaba exactamente 1 bloque test( y se encontraron ${testBlockCount}.`);
    }

    const helperBeginCount = (contents.match(/\/\/\s*METADELTA_HELPERS_BEGIN/g) ?? []).length;
    const helperEndCount = (contents.match(/\/\/\s*METADELTA_HELPERS_END/g) ?? []).length;
    if (helperBeginCount !== 1 || helperEndCount !== 1) {
      failures.push(
        `Se esperaba exactamente 1 bloque de helpers marcado (BEGIN/END) y se encontraron BEGIN=${helperBeginCount}, END=${helperEndCount}.`
      );
    }

    if (failures.length > 0) {
      throw new Error(
        `El archivo temporal parcheado no pasó validación estructural (${patchedPath}).\n- ${failures.join('\n- ')}`
      );
    }
  }

  detectLegacyOrPartialHelperIssue(contents) {
    const markerCounts = {
      helperBegin: (contents.match(/\/\/\s*METADELTA_HELPERS_BEGIN/g) ?? []).length,
      helperEnd: (contents.match(/\/\/\s*METADELTA_HELPERS_END/g) ?? []).length,
      technicalBegin: (contents.match(/\/\/\s*METADELTA_TECHNICAL_HELPERS_BEGIN/g) ?? []).length,
      technicalEnd: (contents.match(/\/\/\s*METADELTA_TECHNICAL_HELPERS_END/g) ?? []).length,
      flowBegin: (contents.match(/\/\/\s*METADELTA_FLOW_SPECIFIC_HELPERS_BEGIN/g) ?? []).length,
      flowEnd: (contents.match(/\/\/\s*METADELTA_FLOW_SPECIFIC_HELPERS_END/g) ?? []).length,
    };

    const hasCompleteMainBlock = markerCounts.helperBegin === 1 && markerCounts.helperEnd === 1;
    const hasAnyMarker = Object.values(markerCounts).some((count) => count > 0);

    if (markerCounts.helperBegin !== markerCounts.helperEnd) {
      return `Markers principales desbalanceados: BEGIN=${markerCounts.helperBegin}, END=${markerCounts.helperEnd}.`;
    }

    if (markerCounts.technicalBegin !== markerCounts.technicalEnd) {
      return `Markers técnicos desbalanceados: BEGIN=${markerCounts.technicalBegin}, END=${markerCounts.technicalEnd}.`;
    }

    if (markerCounts.flowBegin !== markerCounts.flowEnd) {
      return `Markers de flujo desbalanceados: BEGIN=${markerCounts.flowBegin}, END=${markerCounts.flowEnd}.`;
    }

    const helperSignals = [
      'gotoWithRetry',
      'openSetupPopup',
      'forceFullPageRefresh',
      'reopenSetupAfterEinsteinToggle',
      'clickCheckboxFaux',
    ];

    const detectedSignals = helperSignals.filter((name) =>
      new RegExp(`\\basync\\s+function\\s+${name}\\s*\\(`).test(contents)
    );

    if (hasCompleteMainBlock) {
      return null;
    }

    if (hasAnyMarker) {
      return `Se detectaron markers parciales o fuera de bloque principal: ${JSON.stringify(markerCounts)}.`;
    }

    if (detectedSignals.length > 0) {
      return `Se detectaron funciones helper conocidas sin bloque marcado: ${detectedSignals.join(', ')}.`;
    }

    return null;
  }

  hasInjectedHelperBlock(contents) {
    return /\/\/\s*METADELTA_HELPERS_BEGIN[\s\S]*\/\/\s*METADELTA_HELPERS_END/m.test(contents);
  }

  injectHelperBlockIfNeeded(contents) {
    if (this.hasInjectedHelperBlock(contents)) {
      return contents;
    }
    const helper = this.getPatchedTestHelpersBlock();
    return `${helper}\n${contents}`;
  }

  writeValidatedPatchedTestFile(patchedPath, contents) {
    this.validatePatchedTestStructure(contents, patchedPath);
    fs.writeFileSync(patchedPath, contents, 'utf8');
    return patchedPath;
  }

  shouldPreserveLegacyCriticalFlowSelectors(contents) {
    return /Agentforce Agents|Vlocity CMT Administration|Einstein Setup/.test(contents);
  }

  shouldNormalizeVisualforceFrames() {
    const routesPath = path.resolve(process.cwd(), 'tests', 'metadelta-task-orchestrator-routes.js');
    if (!fs.existsSync(routesPath)) {
      return true;
    }
    const contents = fs.readFileSync(routesPath, 'utf8');
    const normalizeVisualforce = !/normalizeVisualforceFrame\s*:\s*false/.test(contents);
    const normalizeGeneric = !/normalizeGenericButtonSelector\s*:\s*false/.test(contents);
    return normalizeVisualforce || normalizeGeneric;
  }

  shouldNormalizeGenericButtonSelectors() {
    const routesPath = path.resolve(process.cwd(), 'tests', 'metadelta-task-orchestrator-routes.js');
    if (!fs.existsSync(routesPath)) {
      return true;
    }
    const contents = fs.readFileSync(routesPath, 'utf8');
    return !/normalizeGenericButtonSelector\s*:\s*false/.test(contents);
  }

  ensureRoutesFile() {
    const routesPath = path.resolve(process.cwd(), 'tests', 'metadelta-task-orchestrator-routes.js');
    if (fs.existsSync(routesPath)) {
      return;
    }
    const contents = `export const orchestratorOptions = {
  normalizeVisualforceFrame: true,
  normalizeGenericButtonSelector: true,
};

export async function runTaskOrchestrator(page) {
  const routes = [
    {
      name: 'Lightning App Launcher abierto',
      check: async () => await isAppLauncherOpen(page),
      run: async () => {
        await page.waitForTimeout(250);
      },
    },
    {
      name: 'Abrir App Launcher si está disponible',
      check: async () => await hasAppLauncherButton(page),
      run: async () => {
        const launcherButton = page.getByRole('button', {name: 'App Launcher'});
        await launcherButton.first().click({timeout: 5000});
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'Esperar buscador del App Launcher',
      check: async () => await hasAppLauncherSearch(page),
      run: async () => {
        await page.getByRole('combobox', {name: 'Search apps and items...'}).waitFor({timeout: 10000});
      },
    },
    {
      name: 'Seleccionar opción Vlocity CMT Administration',
      check: async () => await hasAppLauncherOption(page),
      run: async () => {
        await clickAppLauncherOption(page);
      },
    },
    {
      name: 'Esperar Visualforce para Maintenance Jobs',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await waitForMaintenanceJobsLink(page);
      },
    },
    {
      name: 'Click Maintenance Jobs en Visualforce',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await clickMaintenanceJobsLink(page);
      },
    },
    {
      name: 'Cerrar modales en Visualforce',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await closeVisualforceModals(page);
      },
    },
    {
      name: 'Normalizar botón genérico en Visualforce',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await normalizeGenericButtonSelector(page);
      },
    },
    {
      name: 'Click Start seguro en Visualforce',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await clickSafeStartButton(page);
      },
    },
    {
      name: 'Fallback Start con force click',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await forceClickStartButton(page);
      },
    },
  ];

  for (const route of routes) {
    const shouldRun = await route.check();
    if (shouldRun) {
      await route.run();
    }
  }
}

async function hasAppLauncherButton(page) {
  try {
    return (await page.getByRole('button', {name: 'App Launcher'}).count()) > 0;
  } catch (error) {
    return false;
  }
}

async function hasAppLauncherSearch(page) {
  try {
    return (await page.getByRole('combobox', {name: 'Search apps and items...'}).count()) > 0;
  } catch (error) {
    return false;
  }
}

async function hasAppLauncherOption(page) {
  try {
    return (await page.getByRole('option', {name: 'Vlocity CMT Administration'}).count()) > 0;
  } catch (error) {
    return false;
  }
}

async function isAppLauncherOpen(page) {
  try {
    return await page
      .getByRole('combobox', {name: 'Search apps and items...'})
      .isVisible({timeout: 1000});
  } catch (error) {
    return false;
  }
}

async function clickAppLauncherOption(page) {
  const option = page.getByRole('option', {name: 'Vlocity CMT Administration'});
  await option.waitFor({timeout: 15000});
  await option.first().click({timeout: 5000});
  await page.waitForTimeout(500);
}

async function hasVisualforceFrame(page) {
  try {
    return (await page.locator('iframe[name^="vfFrameId_"]').count()) > 0;
  } catch (error) {
    return false;
  }
}

async function waitForMaintenanceJobsLink(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  await vf.getByRole('link', {name: 'Maintenance Jobs'}).waitFor({timeout: 15000});
}

async function clickMaintenanceJobsLink(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const link = vf.getByRole('link', {name: 'Maintenance Jobs'});
  await link.waitFor({timeout: 15000});
  try {
    await link.click({timeout: 5000});
  } catch (error) {
    await vf.page().waitForTimeout(1000);
    await link.click({timeout: 5000});
  }
}

async function closeVisualforceModals(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const backdrop = vf.locator('.slds-backdrop--open');
  const modal = vf.locator('.slds-modal.slds-fade-in-open');
  if ((await backdrop.count()) > 0 || (await modal.count()) > 0) {
    const closeButton = vf.getByRole('button', {name: /Close|Cancel|OK|Done/i});
    if ((await closeButton.count()) > 0) {
      await closeButton.first().click({timeout: 5000});
    }
  }
}

async function normalizeGenericButtonSelector(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const buttons = vf.locator('button:nth-child(2)');
  const count = await buttons.count();
  if (count > 1) {
    const startButton = vf.getByRole('button', {name: /Start/i});
    if ((await startButton.count()) > 0) {
      await startButton.first().click({timeout: 5000});
    }
  }
}

async function clickSafeStartButton(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  await closeVisualforceModals(page);
  const startButton = vf.getByRole('button', {name: /Start/i}).first();
  if ((await startButton.count()) === 0) {
    return;
  }
  try {
    await startButton.click({timeout: 5000});
  } catch (error) {
    await closeVisualforceModals(page);
    await startButton.click({timeout: 5000});
  }
}

async function forceClickStartButton(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const startButton = vf.getByRole('button', {name: /Start/i}).first();
  if ((await startButton.count()) === 0) {
    return;
  }
  await startButton.click({timeout: 5000, force: true});
}
`;
    fs.writeFileSync(routesPath, contents, 'utf8');
  }

}

export default TaskPlay;
