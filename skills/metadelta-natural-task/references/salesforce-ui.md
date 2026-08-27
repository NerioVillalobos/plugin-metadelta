# Salesforce UI routing

Read this reference when a procedure crosses Lightning applications, Visualforce, managed-package pages, modals, or frames.

## Inspection order

1. Wait for the Lightning navigation shell to become usable.
2. After every navigation that replaces the workspace, enumerate `page.frames()` and record only redacted origins/pathnames plus a short body-text sample.
3. Find the frame containing the requested control by content and stable URL characteristics.
4. Build locators inside that frame and check their count before acting.
5. Verify the resulting state inside the same frame unless navigation establishes a new context.

## Field Service Settings

Observed in the `TDV_preview` org on 2026-08-21:

- Lightning route: `/lightning/n/FSL__Field_Service_Settings`
- The settings content is hosted by the FSL Visualforce frame whose path contains `/apex/vf066_settings`.
- Its generated frame name resembles `vfFrameId_<number>` and is not stable.
- Menu text may also exist as a content heading, so an unscoped exact-text locator can produce a strict-mode collision.

The frame's navigated URL is stable enough for verification, but the host `iframe` element does not necessarily retain that URL in its HTML `src` attribute. In this observed legacy component, `frameLocator('main iframe')` also failed to reach content that was accessible through the loaded `Frame` object. Resolve and use the frame by its navigated URL:

```ts
await expect.poll(() => page.frames().some(frame =>
  frame !== page.mainFrame() && frame.url().includes('/apex/vf066_settings'),
)).toBe(true);

const fieldService = page.frames().find(frame =>
  frame !== page.mainFrame() && frame.url().includes('/apex/vf066_settings'),
);
if (!fieldService) throw new Error('The FSL settings frame did not load');
```

Scope menu entries to their actual menu container or verified element type. For the observed legacy FSL navigation, this pattern was verified:

```ts
const workflowMenu = fieldService.locator('span').filter({
  hasText: /^Service Appointment Workflow$/,
}).first();

await expect(workflowMenu).toBeVisible();
await workflowMenu.click();
```

`.first()` is acceptable here only after inspection confirms the first matching `span` is the visible sidebar entry. Prefer a stable menu container or role when the current DOM exposes one.

## Status-transition tasks

For requests involving Service Appointment Status Transitions:

1. Open `Service Appointment Workflow` inside the FSL frame.
2. Select the `Status Transitions` tab using its verified role or scoped tab container.
3. Inspect the actual control topology before deciding whether the UI represents pairs as rows, a matrix, dual lists, or picklists. Do not infer this from the natural-language arrows.
4. Normalize source and destination labels only after reading the available Salesforce options.
5. Populate the requested mappings, assert every row/value, and stop before `Save` during dry-run.
6. After authorized save, wait for the visible success signal and read the mappings back.

The labels and English API/status values can vary by org configuration and language. The user's supplied mapping is authoritative, but the skill must report any missing or duplicate option rather than silently choosing a substitute.

## Field Service Scheduling / General Logic

Observed in `TDV_preview` on 2026-08-21:

- Open the visible sidebar `span` whose exact text is `Scheduling`; the initial tab is General Logic.
- Work Order Priority Field is the visible wrapper `custom-settings-wrapper[value-field-name="'WO_Priority_Field__c'"]` and its descendant `select` offers `None` and `Scheduling Priority`.
- Scheduling Pin Criteria is `multi-select-dropdown[type="scheduling"]`. Its isolate scope returned `selectedStatuses = null` and `options = null`, but that was inconclusive and caused a false result. The authoritative value was verified at `settings.LogicSettings.FSL__Pinned_Statuses_SF__c` on the inherited Angular scope; it contained the comma-separated statuses. For this legacy component, update that local model, trigger an Angular digest, and verify the model again. Never interpret a null isolate binding as an empty selection.
- Use all-or-none scheduling for related appointments is `custom-settings-wrapper[value-field-name="'Fail_On_Schedule__c'"] input[type="checkbox"]`. It was disabled by `sharingObjectSettingsStatus != 'Private'`. Do not force-click or remove the disabled attribute; report the prerequisite instead.
