# Public examples and diagnostics

Use fictional organization aliases (for example, `ExampleOrg-qa`), invented records, and reserved example domains in documentation, fixtures, and demonstrations. Clearly label synthetic data; do not describe it as a real execution.

Do not commit customer or employer names, organization-specific hosts, credentials, authentication files, raw support conversations, runtime logs, local session identifiers, or recordings of customer environments. Preserve project authorship, attribution, and applicable third-party licenses.

Use `docs/examples/task-orchestrator.json` as a sanitized starting template. Its timestamps are synthetic fixture values and its error history is intentionally empty. Keep actual diagnostic output local. Ignore rules do not protect already tracked files: inspect the staged diff and generated artifacts before publishing.

For screenshots or recordings, use an isolated demo environment with fictional data and review every frame before adding them. Prefer text examples when a recording is unnecessary.

A cleanup commit updates current files only. It does not remove earlier commits, published package versions, pull-request attachments, caches, forks, or clones. Assess historical exposure separately, preserving an access-controlled remediation record.
