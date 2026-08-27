# Durable task contract

Use this contract while generating, repairing, validating, or executing a MetaDelta task.

## Source and execution artifacts

- **Raw capture:** output from `task record`; diagnostic evidence only.
- **Durable source:** reviewed TypeScript under `tests/<org>-<goal>.ts`; the only deliverable to edit and preserve.
- **Playback artifact:** `.metadelta.*` file created by `task play`; temporary execution evidence, never the source of record.

## Generated-test requirements

- Use `@playwright/test` and TypeScript.
- Read the starting origin from `METADELTA_BASE_URL`; use relative paths for navigation.
- Fail clearly when the runtime URL is absent.
- Use a descriptive test title and a bounded timeout appropriate for Lightning.
- Use `expect` for shell readiness, important intermediate state, the pre-save state, and final verification.
- Attach `pageerror` and `requestfailed` diagnostics when investigating a failure; redact query strings, tokens, and origins when reporting them.
- Scope every locator to the relevant page, frame, dialog, section, table, or row.
- Avoid fixed sleeps, generated IDs/frame names, hardcoded Salesforce origins, and unexplained positional locators.
- Read the authoritative current state before every state-changing step. Repeated playback must skip satisfied mutations and must never create duplicates or toggle a correct value away from the requested state.

## State classification and no-op behavior

Classify each requested state-changing step before acting:

- **already satisfied:** assert the current state, emit `METADELTA_ALREADY_SATISFIED step=<stable-step-name>`, skip its edit/create action, and continue;
- **change required:** prepare only the missing change and keep persistence behind the save gate;
- **unknown:** emit `METADELTA_STATE_UNKNOWN step=<stable-step-name>` and stop without mutation;
- **conflicting:** emit `METADELTA_STATE_CONFLICT step=<stable-step-name>` and stop without choosing a substitute.

If all requested states are already satisfied, emit `METADELTA_TASK_ALREADY_SATISFIED` and exit successfully without opening an edit/create form. Navigation required to verify state is not a mutation and may still execute.

For a partially satisfied multi-step task, skip satisfied mutations and prepare only missing ones. Post-save verification must assert the complete requested end state, including values that were already correct.

## Mutation boundary

Define the persistent action once and guard it:

```ts
await expect(saveButton).toBeEnabled();
await expect(valueInput).toHaveValue('Test');

if (process.env.METADELTA_ALLOW_SAVE !== 'true') {
  console.log('DRY_RUN_READY_TO_SAVE');
  return;
}

await saveButton.click();
await expect(successIndicator).toBeVisible();
```

`METADELTA_ALLOW_SAVE=true` enables the code path but does not itself authorize a Salesforce change. Obtain valid user authorization immediately before executing that path.

Treat `Save`, `Submit`, `Activate`, `Delete`, `Finish`, confirmation of a destructive modal, and equivalent actions as persistent. When uncertain, place the action behind the gate.

## Pre-save and post-save evidence

A dry run is successful only if it proves the requested form state and emits `DRY_RUN_READY_TO_SAVE`. Merely reaching the page or finding the Save button is insufficient.

An apply is successful only if it observes the documented success condition. Prefer read-back from the authoritative list or form after reload.

## Retry and repair

- Inspect frames and loading state before changing text matching.
- Resolve multiple matches through semantic scope, not `.first()` without evidence.
- Reacquire detached elements after state transitions.
- Wait on observable state instead of accumulating sleeps.
- Stop after two failures with the same cause and preserve redacted diagnostics.
