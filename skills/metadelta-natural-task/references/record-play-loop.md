# Record-to-play closed loop

Read this reference whenever a natural-language request must become a new durable MetaDelta task.

## Build the task brief

Translate the request into this internal shape without requiring JSON from the user:

```json
{
  "org": "alias",
  "goal": "observable end state",
  "navigation": ["ordered destinations"],
  "inputs": [{"control": "label or role", "value": "requested value"}],
  "preSave": "observable prepared state",
  "mutation": "exact persistent action",
  "success": "observable saved state",
  "mode": "create | dry-run | apply"
}
```

Separate requested intent from literal phrasing. Correct obvious spelling in navigation labels only after verifying the live UI; never silently substitute a missing Salesforce value.

## Capture and inspect

Use the Playwright runtime already resolved by MetaDelta to create a temporary instrumented inspection probe. Run it from the terminal so Codex can autonomously:

- navigate through the authenticated org;
- enumerate pages, frames, accessible roles, labels, and locator counts;
- read current visible state and control attributes;
- capture redacted screenshots, traces, and request/page errors;
- perform reversible navigation and form preparation while stopping before persistence.

This path does not require a separate computer-control tool, MCP browser bridge, or direct manipulation of a Codegen window. It is the same mechanism used to inspect complex Lightning and Visualforce state through Playwright.

Run `sf metadelta task record --org <alias>` when Codegen provides useful bootstrap selectors, a human-visible capture surface, or a raw trace of a manually demonstrated segment. The raw recording is disposable evidence. It may contain hardcoded hosts, generated iframe names, redundant clicks, positional selectors, and missing waits. Do not pass it directly to apply mode and do not make successful autonomous inspection depend on GUI control of Codegen.

Use `sf metadelta task play --header` as the visible execution surface for the evolving durable test. Headless playback is equally valid when diagnostics and assertions provide enough evidence.

## Reconstruct the durable source

Create `tests/<safe-org>-<short-goal>.ts` and preserve it across playback. Reconstruct intent instead of mechanically editing every recorded click:

- use `METADELTA_BASE_URL` and relative Salesforce paths;
- scope locators to the correct page, frame, dialog, section, table, or row;
- replace generated IDs and iframe names with verified stable characteristics;
- remove clicks that merely focus a control before `fill`, `selectOption`, or a semantic action;
- assert readiness after every navigation or workspace replacement;
- classify authoritative state before every state-changing step; skip and log already-satisfied steps, prepare only missing changes, and stop on unknown/conflicting state;
- define the persistence button once and put every persistent click behind `METADELTA_ALLOW_SAVE`;
- assert the prepared state before the gate and the saved state after it.

## Validate and dry-run

From the skill directory:

```bash
node scripts/validate-task.mjs /absolute/path/to/tests/<task>.ts
```

Then from the project that owns `tests/`:

```bash
METADELTA_ALLOW_SAVE=false sf metadelta task play --org <alias> --tstname <task>.ts --header
```

Use `--header` when a visible browser is available and observation helps. A successful dry run must emit `DRY_RUN_READY_TO_SAVE` only after assertions prove the requested unsaved state.

Do not treat MetaDelta's `.metadelta.*` patched file as the deliverable. Copy back only deliberate, reviewed repairs into the durable source.

## Repair loop

Classify a failure before editing:

- wrong page or popup: repair navigation and page ownership;
- control absent: enumerate frames and loading state;
- multiple matches: add semantic scope;
- detached locator: reacquire it after the state transition;
- timing: wait for the next required state;
- requested value absent or duplicated: stop and report the data ambiguity;
- disabled persistent control: report the prerequisite; never force-enable it.

Record the cause and changed hypothesis. Retry at most twice for the same cause and never rerun an unchanged test after a deterministic failure.

## Apply and verify

Immediately before apply, state the exact persistent action and its target. After authorization:

```bash
METADELTA_ALLOW_SAVE=true sf metadelta task play --org <alias> --tstname <task>.ts --header
```

Verify the visible success signal and, when practical, reload or revisit the authoritative list to read the saved value back.

## Worked interpretation: add a picklist value

Natural request:

> Open Setup, Object Manager, find Order Product, open Fields & Relationships, open Async Operation, find Values, click New, enter Test.

Interpretation:

- navigation: Setup -> Object Manager -> Order Product -> Fields & Relationships -> Async Operation;
- reversible preparation: inspect Values, confirm `Test` does not already exist, open New, enter `Test`;
- pre-save assertion: the New Picklist Value form is visible, input contains `Test`, and Save is enabled;
- persistent mutation: click Save to create the picklist value;
- success: `Test` appears exactly once in the field's Values list after save/read-back;
- dry run: stop before Save and emit `DRY_RUN_READY_TO_SAVE`.

Do not click New if `Test` already exists. Assert that it appears exactly once, emit `METADELTA_ALREADY_SATISFIED step=async-operation-value-test` and `METADELTA_TASK_ALREADY_SATISFIED`, then exit successfully without opening the New form.
