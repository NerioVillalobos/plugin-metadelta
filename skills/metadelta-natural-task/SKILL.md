---
name: metadelta-natural-task
description: Convert natural-language Salesforce UI procedures into inspected, validated, durable Playwright tasks through the MetaDelta `task record` and `task play` workflow. Use for generating, repairing, dry-running, or safely applying Salesforce UI tasks, especially across Lightning, Setup, Visualforce, iframes, duplicated labels, or unstable recorded selectors. Do not use for metadata-only deployments without a UI procedure.
---

# MetaDelta Natural Task

Turn the requested Salesforce outcome into a deterministic, reusable UI task. A raw Codegen recording is evidence, never the final deliverable.

## Required closed loop

1. Parse the natural-language request into the target org, observable goal, ordered navigation, inputs, persistent mutation, success signal, and requested mode. Ask only when an ambiguity could change Salesforce data.
2. Verify the org alias and local MetaDelta/Playwright runtime without printing tokens or frontdoor URLs.
3. Use the installed Playwright runtime as the autonomous inspection driver. Generate a temporary instrumented probe that can navigate, enumerate pages/frames, read accessible controls and visible state, take screenshots/traces, and exercise only reversible preparation. This terminal-driven path does not require direct GUI-control tooling.
   - Use `sf metadelta task record --org <alias>` when its Codegen output or visible browser adds useful capture evidence. Preserve that raw recording separately, but do not block autonomous inspection merely because Codex cannot manipulate the Codegen window directly.
   - `record` is a bootstrap/observation aid; Playwright probes are a valid first-class inspection mechanism, and `task play --header` is the visible playback of the evolving durable test.
4. Inspect the live UI before choosing selectors. Identify page/frame boundaries, semantic roles, duplicate labels, loading states, current values, and the pre-save and post-save success signals. Before every state-changing step, read the authoritative current state and classify it as already satisfied, change required, unknown, or conflicting. Read [references/salesforce-ui.md](references/salesforce-ui.md) for Salesforce routing and frames. Keep probe output redacted and delete or isolate temporary inspection artifacts after extracting durable evidence.
5. Rebuild the recording as a durable TypeScript test under `tests/<org>-<goal>.ts`. Never use a `.metadelta.*` playback artifact as the durable source. Read [references/task-contract.md](references/task-contract.md) for the generated-test contract and mutation classification.
6. Run `node scripts/validate-task.mjs <test-file>` from this skill directory. Resolve every error and make an explicit decision on each warning.
7. Execute the durable source with `METADELTA_ALLOW_SAVE=false sf metadelta task play --org <alias> --tstname <file>`. Reach the exact pre-save condition, emit `DRY_RUN_READY_TO_SAVE`, and exit without persistence.
8. On failure, inspect the redacted diagnostic, frames, visible state, screenshot/trace, and failing locator. Repair the durable source and retry. Stop after two failures with the same cause; do not repeat an unchanged test.
9. Preserve the validated durable source that passed dry run and report its path and exact playback command. Temporary `.metadelta.*` files are execution evidence only.
10. Apply only when the user has authorized the exact mutation. Run with `METADELTA_ALLOW_SAVE=true`, verify a concrete success condition, and when practical reload/read back the value.

For the detailed record-to-play protocol and evidence requirements, read [references/record-play-loop.md](references/record-play-loop.md).

## Operating modes

- **Create/repair:** Inspect and generate the durable test; do not persist Salesforce changes.
- **Dry run:** Validate and play through reversible preparation, stopping immediately before persistence.
- **Apply:** After exact authorization, cross the prepared persistence boundary and verify the saved state.

Opening a modal, selecting a tentative option, or filling an unsaved form may be reversible preparation. `Save`, `Submit`, `Activate`, `Delete`, `Finish`, or an equivalent action is persistent. If uncertain, treat the action as persistent.

## Completion criteria

Do not call a task ready merely because it compiles, Codegen produced a file, or `task play` created a patched temporary file. It is ready only when:

- the durable source passes the skill validator;
- a playback in the target org reaches the asserted pre-save state without persistence;
- selectors were verified against the actual UI and do not depend on generated frame names or environment-specific origins;
- requested values and duplicate/no-op behavior are explicit;
- the exact pending mutation and post-save success signal are documented.

## Reliability and safety

- Never embed Salesforce session IDs, access tokens, frontdoor URLs, passwords, API keys, or org-specific origins.
- Enumerate frames after navigation to container-style Salesforce pages. Never select `vfFrameId_<number>`.
- Resolve locator collisions by semantic scope and verified element type; do not hide ambiguity with unexplained `.first()` or `.nth()`.
- Treat `null`, empty scope, hidden containers, or missing options as unknown until verified from a visible control or authoritative UI model.
- Prefer assertions and state-based waits. Fixed sleeps require a documented, observed timing reason and a bound.
- Make every state-changing step idempotent. If the requested state is already satisfied, emit `METADELTA_ALREADY_SATISFIED step=<stable-step-name>`, skip that mutation, and continue. If the entire goal is already satisfied, emit `METADELTA_TASK_ALREADY_SATISFIED` and exit successfully without opening an edit/create form.
- Never infer satisfaction from missing, hidden, null, or partial state. Emit `METADELTA_STATE_UNKNOWN step=<stable-step-name>` or `METADELTA_STATE_CONFLICT step=<stable-step-name>` and stop without mutation when the authoritative state cannot confirm the requested outcome.
- Treat `ERR_BLOCKED_BY_ORB` or aborted asset requests as noise only when the required UI and success signal still work.
