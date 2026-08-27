#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node validate-task.mjs <playwright-test.ts>');
  process.exit(2);
}

const file = path.resolve(process.cwd(), input);
if (!fs.existsSync(file)) {
  console.error(`ERROR file_not_found ${file}`);
  process.exit(2);
}

const source = fs.readFileSync(file, 'utf8');
const errors = new Set();
const warnings = new Set();
const addError = (code) => errors.add(code);
const addWarning = (code) => warnings.add(code);

const secretChecks = [
  [/secur\/frontdoor\.jsp\?sid=/i, 'embedded_frontdoor_session'],
  [/(?:access[_-]?token|client[_-]?secret|password|api[_-]?key)\s*[:=]\s*['"][^'"]+/i, 'possible_embedded_secret'],
];
for (const [pattern, code] of secretChecks) {
  if (pattern.test(source)) addError(code);
}

if (!/\.tsx?$/.test(file)) addError('test_file_must_be_typescript');
if (path.basename(file).startsWith('.metadelta.')) addError('temporary_playback_artifact_is_not_durable_source');
if (/__METADELTA_[A-Z0-9_]+__/.test(source)) addError('unresolved_template_placeholder');
if (!/from\s+['"]@playwright\/test['"]/.test(source)) addError('missing_playwright_test_import');
if (!/\bexpect\s*\(/.test(source)) addError('missing_playwright_assertions');
if (!/test\.setTimeout\s*\(\s*\d+\s*\)/.test(source)) addError('missing_bounded_test_timeout');

const testTitle = source.match(/\btest\s*\(\s*(['"])(.*?)\1/)?.[2]?.trim();
if (!testTitle || /^(?:test|example|untitled)$/i.test(testTitle)) addError('missing_descriptive_test_title');

if (/https?:\/\/[^\s'"\x60]*(?:salesforce\.com|force\.com|salesforce-setup\.com)/i.test(source)) {
  addError('hardcoded_salesforce_origin');
}
if (/page\.goto\s*\(\s*['"]\//.test(source)) addWarning('relative_goto_without_runtime_origin');
if (!/METADELTA_BASE_URL/.test(source)) addError('missing_runtime_base_url');

if (/vfFrameId_\d+/.test(source)) addError('dynamic_visualforce_frame_name');
if (/iframe\[name\s*=\s*['"]vfFrameId_/.test(source)) addWarning('generated_visualforce_frame_selector');
if (/\.getBy(?:Text|Role|Label|Placeholder)\([^\n]+\)\.first\(\)/.test(source)) {
  addWarning('unexplained_positional_semantic_locator');
}
if (/\.(?:first|last|nth)\s*\(/.test(source)) addWarning('positional_locator_requires_inspection_evidence');
if (/waitForTimeout\s*\(/.test(source)) addWarning('fixed_timeout_present');
if (/\.click\s*\(\s*\{[^}]*force\s*:\s*true/.test(source)) addWarning('forced_click_requires_inspection_evidence');

const persistentAction = /(?:getByRole|getByText|locator)\([^\n]*(?:Save|Submit|Activate|Delete|Finish|Guardar|Enviar|Activar|Eliminar|Finalizar)[^\n]*\)[^\n]*\.click\s*\(/i.test(source);
if (persistentAction && !/METADELTA_ALLOW_SAVE/.test(source)) addError('persistent_action_without_dry_run_gate');
if (persistentAction && !/DRY_RUN_READY_TO_SAVE/.test(source)) addError('persistent_action_without_dry_run_signal');
if (persistentAction && !/METADELTA_ALREADY_SATISFIED/.test(source)) addError('persistent_action_without_idempotent_noop_signal');
if (/METADELTA_ALLOW_SAVE/.test(source) && !/DRY_RUN_READY_TO_SAVE/.test(source)) addError('save_gate_without_dry_run_signal');

if (/DRY_RUN_READY_TO_SAVE/.test(source)) {
  if (!/METADELTA_ALLOW_SAVE\s*!==?\s*['"]true['"]/.test(source)) addWarning('dry_run_gate_shape_not_recognized');
  if (!/toHaveValue|toBeChecked|toContainText|toHaveText|toBeEnabled|toBeVisible/.test(source)) {
    addError('dry_run_signal_without_pre_save_assertion');
  }
}

if (/getByRole\(\s*['"]button['"]\s*,\s*\{[^}]*name\s*:\s*['"]New['"]/i.test(source) && !/METADELTA_ALREADY_SATISFIED/.test(source)) {
  addError('creation_flow_without_idempotent_noop_signal');
}

for (const code of errors) console.error(`ERROR ${code}`);
for (const code of warnings) console.warn(`WARN ${code}`);

if (errors.size) process.exit(1);
console.log(`OK ${path.basename(file)}${warnings.size ? ` (${warnings.size} warning(s))` : ''}`);
