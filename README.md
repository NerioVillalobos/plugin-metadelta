> **Last update / Última actualización:** 2026-02-13 — `@nervill/metadelta` 0.9.6

# Metadelta Salesforce CLI Plugin

- [English](#english)
- [Español](#español)

## English

Metadelta is a custom Salesforce CLI plugin that offers seven complementary workflows:

* `sf metadelta find` inspects a target org and reports metadata components modified by a specific user within a recent time window, optionally generating manifest files for deployment or Vlocity datapack migration. When it writes `package.xml`, the command stamps the file with the API version detected from the target org.
* `sf metadelta findtest` reviews Apex classes inside a local SFDX project, confirms the presence of their corresponding test classes, and can validate existing `package.xml` manifests prior to a deployment. Generated or updated manifests inherit the API version reported by the target org when available.
* `sf metadelta manual collect` aggregates manual-step markdown documents stored under `docs/`, renders a consolidated index/banner per story, and offers a sprint-aware mode that only includes the files still pending merge into the base branch.
* `sf metadelta merge` scans manifest XML files whose names contain a given substring, deduplicates their metadata members, and builds a consolidated `globalpackage.xml` (or a custom output filename).
* `sf metadelta postvalidate` re-retrieves the manifests you deployed (Core `package.xml` and/or Vlocity YAML), downloads the corresponding components into a temporary folder, and compares them to your local sources with a colorized diff table.
* `sf metadelta cleanps` extracts a focused copy of a permission set by keeping only the entries that match a fragment or appear in a curated allowlist.
* `sf metadelta access` exports aliases, captures encrypted auth URLs, and restores secure org access across Windows/Linux/WSL with an MFA checkpoint.

Created by **Nerio Villalobos** (<nervill@gmail.com>).

### Index

- [Installation](#installation)
- [`sf metadelta find`](#usage)
- [`sf metadelta cleanps`](#cleanps-command)
- [`sf metadelta findtest`](#findtest-command)
- [`sf metadelta manual collect`](#manual-collect-command)
- [`sf metadelta merge`](#merge-command)
- [`sf metadelta postvalidate`](#postvalidate-command)
- [`sf metadelta access`](#access-command)

### Installation

1. Install the Salesforce CLI (requires version `2.102.6` or later):
   ```bash
   npm install --global @salesforce/cli@2.102.6
   ```
2. Install the plugin directly from GitHub using the Salesforce CLI:
   ```bash
   sf plugins install github:NerioVillalobos/plugin-metadelta.git
   ```
   Confirm installation with `sf plugins`, which should list `@nervill/metadelta 0.9.6`.

3. (Optional, for local development) Clone this repository and install dependencies:
   ```bash
   git clone <repo-url>
   cd plugin-metadelta
   npm install
   ```
4. Link the plugin to your local Salesforce CLI:
   ```bash
   sf plugins link .
   ```
   Confirm installation with `sf plugins`, which should list `@nervill/metadelta 0.9.6 (link)`.

### Usage

Run the command from any directory after linking:

```bash
sf metadelta find --org <alias_or_username> [flags]
```

The plugin compares metadata changes for the specified user and prints a table of modified components. When requested, it also produces manifest files under the `manifest/` directory.

### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--org`, `-o` | **Required.** Alias or username of the target org. | N/A |
| `--metafile` | Path to a JSON file listing the metadata types to override the default selection. | Built‑in list |
| `--days` | Number of days in the past to inspect for modifications. | `3` |
| `--namespace` | Vlocity namespace to query datapacks (enables Vlocity datapack checks). | None |
| `--xml` | When set, generates `manifest/package-<branch_or_org>[-v#].xml` containing found metadata. The resulting file uses the API version fetched from the specified org when available. | `false` |
| `--yaml` | When set, generates `manifest/package-vlocity-<branch_or_org>[-v#].yaml` with Vlocity datapack entries. | `false` |
| `--audit` | Full name of the user to audit. If omitted, the command uses the org user associated with the provided alias. | Authenticated user |

#### Using a custom metadata file

By default, the command builds its metadata type list by running `sf force:mdapi:describemetadata --target-org` so it stays synchronized with the connected org. If the describe call fails, a built-in fallback list is used. The resulting list is further filtered to include only types that expose both `lastModifiedByName` and `lastModifiedDate`, avoiding unnecessary queries. A maximum of five metadata types are processed in parallel to limit resource usage.

The `--metafile` flag allows you to override the built‑in metadata list. Provide a JSON **(.json)** file that either contains a top-level array or an object with a `metadataTypes` array. The file must contain plain JSON (no `module.exports =` wrappers) and use UTF-8 encoding.

Create a file—for example `mismetadatos.json`—with the following content:

```json
{
  "metadataTypes": [
    "Bot", "BotVersion", "CustomPermission", "FlexiPage", "Flow",
    "GenAiFunction", "GenAiPlanner", "GenAiPlugin", "GenAiPlannerBundle",
    "PermissionSet", "Profile", "StaticResource", "PermissionSetGroup"
  ]
}
```

Minimal example using an array:

```json
[
  "ApexClass",
  "Flow"
]
```

Reference the file when running the command (prefix with `./` when the file lives in the current folder):

```bash
sf metadelta find --org myOrg --metafile ./mismetadatos.json
```

> **Tip:** If you previously used a `.js` file with `module.exports`, rename it to end with `.json` and remove the assignment wrapper so only the JSON structure remains.
>
> **Note:** When the path to your metafile contains spaces or special characters, wrap it in quotes (for example, `--metafile "./metadata lists/mismetadatos.json"`).

### Examples

- Basic scan for the default user:
  ```bash
  sf metadelta find --org myOrg
  ```
- Audit a different user for the last seven days and create a package.xml:
  ```bash
  sf metadelta find --org myOrg --audit "Jane Doe" --days 7 --xml
  ```
- Check Vlocity datapacks with a custom namespace and output a Vlocity package file:
  ```bash
  sf metadelta find --org myOrg --namespace myns --yaml
  ```

### `postvalidate` command

Validates a deployment by re‑retrieving the manifests you used (XML for Salesforce Core and/or YAML for Vlocity) into a temporary folder, comparing the downloaded files against your local sources, and rendering a colorized `Component | Name | Diff` table with `✓` for matches and `✗` for differences.

**What it does**

1. Creates a temporary retrieve directory and hides the raw command output behind a spinner while the retrieves run.
2. For Salesforce Core (`--xml`), runs `sf project retrieve start --manifest <xml> --target-org <org> --output-dir <tempDir>`.
3. For Vlocity (`--yaml`), runs `vlocity --sfdx.username <org> -job <yaml> packExport --maxDepth 0` into the same temp directory.
4. Maps retrieved Core files back to your repo using `sfdx-project.json` package directories (including `main/default`), and datapacks against the directory you pass in `--vlocity-dir` (default `Vlocity`).
5. Compares folder-to-folder ignoring whitespace, blank lines, XML/JS/YAML comments, Vlocity `GlobalKey` lines, and skips noise files like `VlocityBuildErrors.log`, `VlocityBuildLog.yaml`, and the `vlocity-temp/` directory.
6. Prints a box-style table with colored headers and status symbols, then deletes the temporary folder.

**Flags**

| Flag | Description | Default |
|------|-------------|---------|
| `--xml` | Path to the `package.xml` used for the Core deployment. Requires `--org`. | None |
| `--yaml` | Path to the Vlocity manifest used for the datapack deployment. Requires `--org`. | None |
| `--org`, `-o` | Alias or username for both Core and Vlocity retrieves. | CLI default |
| `--vlocity-dir` | Local folder that stores your datapacks. Also probed when manifests contain a `Vlocity/` prefix. | `Vlocity` |

> Provide at least one manifest (`--xml` or `--yaml`). When both are present, the retrieves share the same temp folder and a single comparison pass.

**Usage examples**

- Core only:
  ```bash
  sf metadelta postvalidate --xml manifest/SP1.2.11.0.xml --org SFOrg-prod
  ```
- Vlocity only from a custom folder:
  ```bash
  sf metadelta postvalidate --yaml manifest/vlo-manifest.yaml --org SFOrg-Demo02 --vlocity-dir Vlocity
  ```
- Core + Vlocity in one run:
  ```bash
  sf metadelta postvalidate --xml manifest/package.xml --yaml manifest/vlocity.yaml --org my-env --vlocity-dir Vlocity
  ```

Run the command from the Salesforce project root so Core retrieves line up with your `packageDirectories` structure. Datapacks are resolved relative to the current directory first and then to `--vlocity-dir`.

### `access` command

Metadelta Access is an **Org Access Replication Tool** with applied security controls. It automates a formerly manual process to export aliases, protect auth URLs, and restore org access across machines with MFA + passphrase encryption.

Use Metadelta Access to transfer org login access securely between machines:

```bash
sf metadelta access --all --output docs
```

Core flow:

1. `--all` or `--prefix <text>` creates `<output>/<name>/accessbackup.dat` with connected aliases and usernames and also creates `accessbackup.dat.mfa`.
   During this step, the command tries to print an ASCII QR in the terminal (when Python `qrcode` is available); it always prints Secret + URI as fallback.
2. `--capture <folder>` asks for MFA + passphrase, reads each alias auth URL (`sf org display --verbose`), encrypts it, and rewrites `accessbackup.dat` with encrypted payloads.
3. `--addaccess <folder>` asks for MFA + passphrase, decrypts each entry, and restores auth using `sfdx auth:sfdxurl:store -f <file> -a <alias>` (fallback: `sf org login sfdx-url` when available).

> Important: `--addaccess` only works after `--capture` has encrypted the file. If `accessbackup.dat` still contains `alias;username` rows, run capture first.
> Usage reminder: pass the folder as the value of the flag, for example `sf metadelta access --addaccess docs/FolderName` (do not duplicate the flag).

The command is implemented in Node.js only (no Python runtime/dependencies), so it works the same on Windows, Linux, and WSL as long as Salesforce CLI is installed.

#### Platform requirements (Windows / macOS / Linux / WSL)

To run `sf metadelta access` reliably, ensure the following prerequisites are available:

1. **Salesforce CLI**
   - Required on all platforms.
   - Verify with:
     ```bash
     sf --version
     ```
2. **Authenticated org session(s)**
   - Export/capture depends on active org sessions in your local CLI auth store.
   - Verify with:
     ```bash
     sf org list
     ```
3. **Node.js environment compatible with this plugin**
   - The plugin requires Node.js 18+ (as declared in `package.json`).
4. **Legacy `sfdx` binary (recommended for replication restore)**
   - Primary restore command uses `sfdx auth:sfdxurl:store`.
   - If unavailable, the command attempts `sf org login sfdx-url` fallback.
5. **Optional ASCII QR rendering dependency**
   - If Python + `qrcode` module exists, the command prints an ASCII QR in terminal during MFA creation.
   - Without it, Secret + URI are still printed and can be entered manually in your authenticator app.

Platform notes:

- **Windows (PowerShell/CMD):** keep Salesforce CLI binaries available in `PATH` and prefer running from a regular user terminal with profile initialization enabled.
- **macOS/Linux:** ensure `sf` (and optionally `sfdx`) resolve from the same shell session where you run the plugin.
- **WSL:** if mixing Windows and WSL auth contexts, validate where your CLI auth store is located and run export/restore in the same environment when possible.

#### Responsibility and security notice

By using `metadelta access` and all other commands in this plugin, you acknowledge that:

- You are responsible for complying with your organization’s security policies.
- You are responsible for protecting MFA secrets, passphrases, backup files, and generated auth artifacts.
- You should only run these commands in trusted environments and with authorized org access.
- The maintainers/authors are not responsible for misuse, credential leakage, or operational impact caused by incorrect handling.

Use the tool carefully, rotate credentials when needed, and treat backup files as sensitive secrets.

### `cleanps` command

Generate a trimmed permission-set file with:

```bash
sf metadelta cleanps --permissionset <name> --prefix <fragment> [flags]
```

The command locates the default package directory declared in `sfdx-project.json`, reads the matching permission-set XML under `<packageDir>/main/default/permissionsets`, and produces a filtered copy inside `<project-root>/cleanps/` (the folder is created automatically when missing).

#### Cleaning workflow

1. **Prefix-driven matches.** Every candidate entry is evaluated against the fragment provided through `--prefix`. If any relevant value (such as the object name, record type, or tab API name) contains that fragment, the entire node is kept.
2. **Allowlist overrides.** When you pass `--exclude <file>`, the command loads each non-empty line of the text file (relative paths are resolved from the project root). Any entry whose relevant value equals one of those lines is preserved even when it does not contain the prefix. Use this to retain standard objects or tabs that complement your custom solution.
3. **Section-aware filtering.** The cleaner scans the following sections: `applicationVisibilities`, `classAccesses`, `customPermissions`, `fieldPermissions`, `objectPermissions`, `pageAccesses`, `recordTypeVisibilities`, `tabSettings`, and `userPermissions`. For composite fields such as `fieldPermissions` and `recordTypeVisibilities`, both the full API name (`Account.Field__c`) and its components (`Account`, `Field__c`) are checked against the prefix and allowlist so you can keep entire objects or individual fields.
4. **Preserve untouched metadata.** Elements outside of the filtered sections (labels, descriptions, activation flags, etc.) are copied verbatim from the source permission set.

The default output file follows the pattern `<PermissionSet>_<prefix>_filtered.permissionset-meta.xml`. Use `--output` to provide a custom name (the `.xml` extension is appended automatically when omitted).

#### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--permissionset`, `-p` | **Required.** File name (with or without `.permissionset-meta.xml`) located under the project’s permission-set folder. | N/A |
| `--prefix`, `-f` | **Required.** Fragment that must appear in an entry for it to remain in the cleaned file. | N/A |
| `--exclude`, `-e` | Path to a newline-delimited text file containing exact values that must always be kept. | None |
| `--output`, `-o` | Name of the XML file written under `cleanps/`. | `<PermissionSet>_<prefix>_filtered.permissionset-meta.xml` |
| `--project-dir` | Optional root directory that holds `sfdx-project.json`. When omitted, the command walks up from the current working directory. | Auto-detected |

### `findtest` command

Analyse Apex classes and their associated tests with:

```bash
sf metadelta findtest [flags]
```

By default the command looks for `sfdx-project.json` in the current directory (or its parents) and inspects the `force-app/main/default/classes` folder.

> **Tip:** After pulling plugin updates, run `sf plugins link .` again so the Salesforce CLI registers the new `findtest` command.

When `--xml-name` points to a manifest that needs to be updated (for example to add detected tests), the command refreshes its `<version>` node with the API version reported by the target org when `--org`/`--target-org` is supplied.

#### Quick start

| Scenario | Example |
|----------|---------|
| Show the Apex ↔︎ test mapping in the console | `sf metadelta findtest` |
| Restrict the report to the Apex classes listed in a manifest (analysis only) | `sf metadelta findtest --xml-name manifest/package.xml` |
| Validate a manifest against a specific org while keeping a dry-run deploy | `sf metadelta findtest --xml-name manifest/package.xml --org SFOrg-devoss` |
| Execute the deployment helper without --dry-run | `sf metadelta findtest --xml-name manifest/package.xml --org SFOrg-devoss --run-deploy` |
| Run a production-ready deployment that skips `-l` when no Apex tests are found | `sf metadelta findtest --xml-name manifest/package.xml --org SFOrg-devoss --run-deploy-prod` |
| Ignore the manifest and inspect only local sources | `sf metadelta findtest --only-local` |
| Include managed-package classes explicitly | `sf metadelta findtest --xml-name manifest/package.xml --no-ignore-managed` |

> **Note:** The deployment helper (dry-run or live deploy) requires `--org` or `--target-org`. Without either flag, the command only analyses manifests and local sources—even when `--xml-name` is provided.

#### Manual-step documentation detection

When you provide `--xml-name` (or `--deploy`), the command cross-checks the manifest name against files inside the project’s `docs/` directory. If it finds documentation that references the manifest identifier (for example `docs/OSS-FSL-5044-PRE.md` for `manifest/OSSFSL-5044.xml`), the console shows a prominent warning so you can review and run those manual steps before or instead of the deployment.

If the manifest file itself is missing but matching documentation exists under `docs/`, the command stops and reminds you to follow the documented manual procedure without using `--dry-run` or `--run-deploy`. When neither the manifest nor related documentation exist, it reports the missing XML file as an error.

#### How Apex tests are detected

`sf metadelta findtest` splits Apex sources into functional classes and tests by applying a case-insensitive name pattern (`TEST_NAME_PATTERN`) while scanning the target directory. Non-matching `.cls` files become candidates for validation, whereas files whose names contain `test`, `_test`, `testclass`, or similar suffixes are treated as potential test classes.

Once the functional and test pools are separated, the command evaluates each class with the following steps:

1. **Direct suffix match.** `findtest` attempts to append each of the known test suffixes (`Test`, `_Test`, `TestClass`, etc.) to the Apex class name and looks for an exact match. The comparison also tolerates trigger handler patterns by trimming a trailing `Handler` before trying the suffixes, so classes like `MyTriggerHandler` can pair with tests named `MyTriggerTest`.
2. **Content analysis.** When there is no direct match, the command opens every potential test class and looks for evidence that it exercises the Apex class: instantiations (`new MyClass`), static member access (`MyClass.someMethod(`), or variable declarations (`MyClass variable;`). The best-scoring candidate is reported as a low-confidence suggestion, leaving the final decision to you.
3. **Manifest reconciliation.** If a manifest is provided, the command normalizes every `<members>` entry (ignoring whitespace, nil markers, and letter casing) before comparing it against the inferred tests. This prevents duplicate insertions and ensures that existing test names are respected even when the XML formatting varies.

#### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--project-dir` | Path to the Salesforce project root (folder that contains `sfdx-project.json`). If omitted, the command walks up from the current directory until it finds it. | Current project |
| `--source-dir` | Relative or absolute path to the Apex classes directory. | `force-app/main/default/classes` |
| `--xml-name` | Relative or absolute path to an existing `package.xml`. When provided, the console report starts from the Apex classes declared in that manifest and the same file is used for deployment validation. | N/A |
| `--org` | Alias or username to use with the deployment helper. Mirrors `--target-org` but is shorter to type. | CLI default |
| `--target-org` | Alias or username passed to `sf project deploy start` (same behaviour as `--org`). | CLI default |
| `--run-deploy` | Executes the deployment helper without appending `--dry-run`. When omitted, the helper always adds `--dry-run` to keep the validation non-destructive. | `false` |
| `--run-deploy-prod` | Production deployment helper that omits the `-l` flag when the manifest lacks Apex classes and uses `-l RunSpecifiedTests` with the detected test names when they exist. | `false` |
| `--only-local` | Ignores the manifest (if any) and analyses only the Apex classes present in the local repository. | `false` |
| `--ignore-managed`, `--no-ignore-managed` | Skip (`true`) or include (`false`) classes whose names start with `namespace__`. | `true` |
| `--ignore-communities`, `--no-ignore-communities` | Skip (`true`) or include (`false`) the built-in Communities controllers (ChangePasswordController, etc.). | `true` |
| `--verbose` | Print detailed warnings for every class filtered out or missing locally. | `false` |
| `--json` | Emit a JSON summary with filtering metrics (`inputCount`, `filteredCount`, `finalCount`, and ignored/missing lists). | `false` |

#### Output

Every run starts with a summary line detailing how many classes came from the manifest (or filesystem), how many were filtered out, and how many remain in the local repository. The detailed mapping preserves the original script format (`ApexClass → ApexTest`). When a manifest is provided, the command automatically ignores managed-package entries (`namespace__*`) and common Communities controllers unless you opt back in; only classes that exist locally are considered for test discovery. Use `--verbose` to list the filtered names and `--json` to capture the underlying metrics programmatically.

Only test classes whose names match the Apex class directly (`MyClassTest`, `MyClass_Test`, `MyClassTests`, …) are considered reliable and appear in the mapping. Potential matches detected heuristically are reported as warnings for review and are **not** added to manifests or deployment commands automatically.

### `manual collect` command

Build a consolidated runbook of manual steps by parsing markdown files stored under a directory such as `docs/`. Valid filenames follow the `OSS-FSL-<story>-<PRE|POST>.md` pattern—files that start with `OSSFSL` are normalized automatically. Run the command with:

```bash
sf metadelta manual collect --docs ./docs --output ./docs/MANUAL-STEPS.md --all
```

By default (or when passing `--all`) the command gathers every matching `.md`, sorts entries so `PRE` steps appear before `POST`, orders them chronologically (filesystem `mtime` unless `--order-by git` is provided), and emits a markdown file with an index, a metadata banner, and the original content per story.

Enable partial mode to limit the output to the stories that are still pending merge between a sprint branch and its base branch. The command runs `git diff --name-only <base>..<sprint> -- <docs>` behind the scenes and filters the list to keep only the manual-step markdown files:

```bash
sf metadelta manual collect \
  --docs ./docs \
  --output ./docs/MANUAL-STEPS.md \
  --partial \
  --sprint-branch SP1/main \
  --base-branch master \
  --sprint-name SP1 \
  --order-by git
```

If no qualifying files remain in the requested range the command stops with a friendly message so you can confirm whether the sprint actually merged any documentation. Leaving out both `--partial` and `--all` behaves the same as `--all` for convenience.

#### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--docs`, `-d` | **Required.** Directory that hosts the manual-step `.md` files. | N/A |
| `--output`, `-o` | **Required.** Destination markdown file that will contain the consolidated content. | N/A |
| `--partial` | Restricts the output to the files pending merge between the base branch and the sprint branch. Requires `--sprint-branch`. | `false` |
| `--all` | Forces the command to include every manual-step file in `--docs`. (This is also the default behaviour when `--partial` is not set.) | `false` |
| `--sprint-branch` | Sprint branch used in partial mode. | N/A |
| `--sprint-name` | Optional label shown in the markdown header/banner. | None |
| `--base-branch` | Base branch used to compute the diff range when `--partial` is active. | `master` |
| `--order-by` | Source for the ordering timestamp. Use `git` to rely on commit dates instead of file modification times. | `mtime` |

### `merge` command

Combine multiple manifest fragments into a single package with:

```bash
sf metadelta merge --xml-name <substring> [flags]
```

By default the command looks inside the `manifest/` directory for XML files whose filenames contain the provided substring. It merges their `<types>` entries, deduplicating members per metadata type and keeping the highest API version found across the inputs. Each `<members>` node in the resulting manifest now carries an inline `<!-- source -->` comment listing the contributing manifest filenames (without the `.xml` suffix) so you can trace every component. The result is saved to `manifest/globalpackage.xml`, unless you override the filename.

When you add `--partial --sprint-branch <name> [--base-branch master]`, the command limits its search to manifest files that are still pending merge between the specified sprint branch and its base branch. Internally it runs `git diff --name-only <base>..<sprint> -- manifest/` (respecting `--directory`) and keeps only the matching XML files. If the diff is empty the command stops with a clear message so you can adjust the range or fallback to a full merge.

#### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--xml-name`, `-x` | **Required.** Substring that matching manifest filenames must contain. | N/A |
| `--directory`, `-d` | Directory that holds the manifest XML files to merge. | `manifest` |
| `--output`, `-o` | Name of the combined manifest file to generate. | `globalpackage.xml` |
| `--partial` | Restricts the merge to manifest files pending merge between the base branch and the sprint branch. Requires `--sprint-branch`. | `false` |
| `--sprint-branch` | Sprint branch that contains the manifests you want to consolidate. | N/A |
| `--base-branch` | Base branch already deployed to production. Used to compute the diff in partial mode. | `master` |

#### Example

To merge every manifest whose filename contains `OSSFSL` into `manifest/globalpackage.xml`:

```bash
sf metadelta merge --xml-name OSSFSL

To restrict the merge to manifests that have not been merged back into `master` yet:

```bash
sf metadelta merge --xml-name OSSFSL --partial --sprint-branch SP1/main --base-branch master
```
```

#### Deployment flow (existing `package.xml`)

When you provide a manifest file (by pointing `--xml-name` to an existing file), the command:

1. Reads the existing `package.xml` (the file must already exist).
2. Checks for `<types><name>ApexClass</name></types>` entries. If none are present, it reports the absence of Apex classes. When `--org`/`--target-org` is provided, the command still invokes `sf project deploy start --manifest <file> -l NoTestRun` (adding `--dry-run` unless you include `--run-deploy`). Without an org, the workflow stops after the report.
3. Builds the evaluation list by intersecting the manifest with the local filesystem, optionally removing managed-package members and Communities controllers. Use `--verbose` to list the skipped entries.
4. Finds the associated test classes for each remaining Apex entry. Direct name matches (`MyClassTest`, `MyClass_Test`, `MyClassTests`, …) are appended to the manifest. Name-only heuristics are surfaced as warnings so you can double-check coverage manually.
5. If any Apex class lacks an associated test, only has a heuristic match, or a required test file is missing, the command reports the names and skips `sf project deploy start` so you can fix the manifest or restore the files.
6. Otherwise, it executes `sf project deploy start --manifest <file> -l RunSpecifiedTests -t <Test1> -t <Test2> …` (or `-l NoTestRun` if no tests were detected). The command appends `--dry-run` unless you pass `--run-deploy`. Use `--org`/`--target-org` to override the CLI default org.

### Output

The command prints each matching component with its type, full name, last modified date, and modifier. When `--xml` or `--yaml` are set, the corresponding manifest files are created inside the `manifest/` directory. If the command runs inside a Git repository, the manifest filename uses the current branch name; otherwise it falls back to the provided org alias. Existing files are preserved by adding incremental `-v1`, `-v2`, … suffixes.

### Uninstalling

To unlink the plugin from your Salesforce CLI:
```bash
sf plugins unlink @nervill/metadelta
```

### License

This project is released under the [ISC License](LICENSE).

## Español

Metadelta es un plugin personalizado de Salesforce CLI que ofrece siete flujos complementarios:

* `sf metadelta find` inspecciona una org de destino y reporta los componentes de metadatos modificados por un usuario específico durante un rango de tiempo reciente, generando opcionalmente manifiestos para despliegues o migraciones de paquetes de Vlocity. Al crear `package.xml`, la versión del manifiesto coincide con la versión de API detectada en la org de destino.
* `sf metadelta findtest` revisa las clases Apex dentro de un proyecto SFDX local, confirma la presencia de sus clases de prueba correspondientes y puede validar `package.xml` existentes antes de un despliegue. Los manifiestos generados o actualizados usan la versión de API que reporte la org de destino cuando esté disponible.
* `sf metadelta manual collect` consolida los documentos de pasos manuales almacenados en `docs/`, agrega índice y banner informativo y ofrece un modo parcial que solo incluye los archivos aún pendientes de merge en la rama base.
* `sf metadelta merge` busca archivos de manifiesto cuyos nombres contengan una subcadena específica, unifica sus miembros de metadatos sin duplicados y construye un `globalpackage.xml` consolidado (o el nombre de archivo que indiques).
* `sf metadelta postvalidate` vuelve a recuperar los manifiestos que desplegaste (`package.xml` de Core y/o YAML de Vlocity), descarga los componentes correspondientes en una carpeta temporal y los compara con tus fuentes locales mostrando una tabla de diferencias colorizada.
* `sf metadelta cleanps` genera una copia depurada de un permission set conservando solo los nodos que coincidan con un fragmento o con una lista permitida.
* `sf metadelta access` exporta aliases, captura auth URLs cifradas y restaura accesos de forma segura entre Windows/Linux/WSL con validación MFA.

Creado por **Nerio Villalobos** (<nervill@gmail.com>).

### Índice

- [Instalación](#instalación)
- [`sf metadelta find`](#uso)
- [`sf metadelta cleanps`](#comando-cleanps)
- [`sf metadelta findtest`](#comando-findtest)
- [`sf metadelta manual collect`](#comando-manual-collect)
- [`sf metadelta merge`](#comando-merge)
- [`sf metadelta postvalidate`](#comando-postvalidate)
- [`sf metadelta access`](#comando-access)

### Instalación

1. Instala Salesforce CLI (requiere versión `2.102.6` o superior):
   ```bash
   npm install --global @salesforce/cli@2.102.6
   ```
2. Clona este repositorio e instala las dependencias:
   ```bash
   git clone <repo-url>
   cd plugin-metadelta
   npm install
   ```
3. Vincula el plugin con tu Salesforce CLI local:
   ```bash
   sf plugins link .
   ```
   Confirma la instalación con `sf plugins`, que debe mostrar `@nervill/metadelta`.

### Uso

Ejecuta el comando desde cualquier directorio después de vincularlo:

```bash
sf metadelta find --org <alias_o_usuario> [banderas]
```

El plugin compara los cambios de metadatos para el usuario especificado y muestra una tabla de componentes modificados. Cuando se solicita, también produce archivos de manifiesto en el directorio `manifest/`.

### Banderas

| Bandera | Descripción | Valor por defecto |
|--------|-------------|-------------------|
| `--org`, `-o` | **Requerido.** Alias o usuario de la org de destino. | N/A |
| `--metafile` | Ruta a un archivo JSON con la lista de tipos de metadatos que reemplazan la selección predeterminada. | Lista integrada |
| `--days` | Número de días hacia atrás a inspeccionar por modificaciones. | `3` |
| `--namespace` | Namespace de Vlocity para consultar datapacks (habilita las revisiones de datapacks). | Ninguno |
| `--xml` | Si se especifica, genera `manifest/package-<rama_o_org>[-v#].xml` con los metadatos encontrados. El archivo resultante utiliza la versión de API obtenida de la org indicada cuando está disponible. | `false` |
| `--yaml` | Si se especifica, genera `manifest/package-vlocity-<rama_o_org>[-v#].yaml` con entradas de datapacks de Vlocity. | `false` |
| `--audit` | Nombre completo del usuario a auditar. Si se omite, el comando utiliza el usuario asociado al alias proporcionado. | Usuario autenticado |

#### Uso de un archivo de metadatos personalizado

Por defecto, el comando construye la lista de tipos de metadatos ejecutando `sf force:mdapi:describemetadata --target-org`, de modo que se mantenga sincronizada con la org conectada. Si la llamada de describe falla, se utiliza una lista integrada de respaldo. La lista resultante se filtra para conservar solo los tipos que exponen `lastModifiedByName` y `lastModifiedDate`, evitando consultas innecesarias. Además, se procesan como máximo cinco tipos de metadatos en paralelo para no saturar la memoria.

La bandera `--metafile` permite reemplazar la lista integrada de tipos de metadatos. Crea un archivo JSON **(.json)** que contenga un arreglo en la raíz o un objeto con la propiedad `metadataTypes`. El archivo debe incluir únicamente JSON plano (sin `module.exports =`) y usar codificación UTF-8.

Crea un archivo—for ejemplo `mismetadatos.json`—con el siguiente contenido:

```json
{
  "metadataTypes": [
    "Bot", "BotVersion", "CustomPermission", "FlexiPage", "Flow",
    "GenAiFunction", "GenAiPlanner", "GenAiPlugin", "GenAiPlannerBundle",
    "PermissionSet", "Profile", "StaticResource", "PermissionSetGroup"
  ]
}
```

Ejemplo minimalista usando un arreglo directo:

```json
[
  "ApexClass",
  "Flow"
]
```

Luego ejecuta el comando haciendo referencia al archivo (agrega `./` si está en la carpeta actual):

```bash
sf metadelta find --org miOrg --metafile ./mismetadatos.json
```

> **Consejo:** Si antes utilizabas un archivo `.js` con `module.exports`, cámbiale la extensión a `.json` y elimina la asignación para que solo quede la estructura JSON.
>
> **Nota:** Si la ruta al archivo contiene espacios o caracteres especiales, enciérrala entre comillas (por ejemplo, `--metafile "./listas metadata/mismetadatos.json"`).

### Ejemplos

- Escaneo básico para el usuario por defecto:
  ```bash
  sf metadelta find --org miOrg
  ```
- Auditar a un usuario diferente por los últimos siete días y crear un package.xml:
  ```bash
  sf metadelta find --org miOrg --audit "Jane Doe" --days 7 --xml
  ```
- Revisar datapacks de Vlocity con un namespace personalizado y generar un archivo de paquete de Vlocity:
  ```bash
  sf metadelta find --org miOrg --namespace miNS --yaml
  ```

### Comando `access`

Metadelta Access es una **herramienta de replicación de accesos de orgs (Org Access Replication Tool)** con controles de seguridad aplicados. Automatiza un proceso que antes era manual para exportar aliases, proteger auth URLs y restaurar accesos entre equipos usando MFA + cifrado con passphrase.

Metadelta Access permite mover accesos de orgs entre equipos de forma segura:

```bash
sf metadelta access --all --output docs
```

Flujo principal:

1. `--all` o `--prefix <texto>` genera `<output>/<nombre>/accessbackup.dat` con aliases conectados y usuarios, y crea `accessbackup.dat.mfa`.
   En este paso, el comando intenta mostrar un QR ASCII en terminal (si Python `qrcode` está disponible); siempre imprime Secret + URI como respaldo.
2. `--capture <carpeta>` solicita MFA + passphrase, obtiene cada auth URL (`sf org display --verbose`), la cifra y reemplaza `accessbackup.dat` con datos cifrados.
3. `--addaccess <carpeta>` solicita MFA + passphrase, descifra cada registro y restaura el acceso con `sfdx auth:sfdxurl:store -f <archivo> -a <alias>` (fallback: `sf org login sfdx-url` si está disponible).

> Importante: `--addaccess` solo funciona después de ejecutar `--capture` para cifrar el archivo. Si `accessbackup.dat` aún tiene filas `alias;usuario`, primero ejecuta capture.
> Recordatorio de uso: pasa la carpeta como valor de la bandera, por ejemplo `sf metadelta access --addaccess docs/FolderName` (sin duplicar la bandera).

El comando está implementado solo con Node.js (sin dependencias de Python), por lo que funciona igual en Windows, Linux y WSL siempre que Salesforce CLI esté instalado.

#### Requisitos por plataforma (Windows / macOS / Linux / WSL)

Para ejecutar `sf metadelta access` de forma confiable, verifica estos prerrequisitos:

1. **Salesforce CLI**
   - Requerido en todas las plataformas.
   - Validar con:
     ```bash
     sf --version
     ```
2. **Sesiones autenticadas de org**
   - La exportación/captura depende de sesiones activas en el almacén local de autenticación del CLI.
   - Validar con:
     ```bash
     sf org list
     ```
3. **Entorno Node.js compatible con el plugin**
   - El plugin requiere Node.js 18+ (declarado en `package.json`).
4. **Binario legacy `sfdx` (recomendado para la restauración)**
   - El comando principal de restauración usa `sfdx auth:sfdxurl:store`.
   - Si no está disponible, el comando intenta `sf org login sfdx-url` como fallback.
5. **Dependencia opcional para QR ASCII**
   - Si existe Python + módulo `qrcode`, se imprime un QR ASCII en terminal al crear el MFA.
   - Si no existe, igual se imprime Secret + URI para registro manual en la app autenticadora.

Notas por plataforma:

- **Windows (PowerShell/CMD):** asegúrate de que los binarios de Salesforce CLI estén en `PATH` y ejecuta desde una terminal de usuario con inicialización de perfil activa.
- **macOS/Linux:** confirma que `sf` (y opcionalmente `sfdx`) se resuelvan en la misma sesión de shell donde ejecutas el plugin.
- **WSL:** si mezclas contextos de autenticación entre Windows y WSL, valida dónde se guarda la autenticación y procura ejecutar exportación/restauración en el mismo entorno.

#### Aviso de responsabilidad y seguridad

Al usar `metadelta access` y el resto de comandos del plugin, aceptas que:

- Eres responsable de cumplir las políticas de seguridad de tu organización.
- Eres responsable de proteger secretos MFA, passphrases, backups y archivos de autenticación generados.
- Debes ejecutar estos comandos únicamente en entornos confiables y con acceso autorizado a las orgs.
- Los autores/mantenedores no se responsabilizan por mal uso, fuga de credenciales o impactos operativos por manejo incorrecto.

Usa la herramienta con criterio, rota credenciales cuando corresponda y trata los archivos de respaldo como secretos sensibles.

### Comando `cleanps`

Genera una versión depurada de un permission set con:

```bash
sf metadelta cleanps --permissionset <nombre> --prefix <fragmento> [banderas]
```

El comando identifica el directorio de paquete predeterminado declarado en `sfdx-project.json`, lee el XML ubicado en `<packageDir>/main/default/permissionsets` y produce una copia filtrada dentro de `<raiz-del-proyecto>/cleanps/` (la carpeta se crea automáticamente si no existe).

#### Flujo de depuración

1. **Coincidencias por fragmento.** Cada entrada candidata se evalúa contra el fragmento recibido en `--prefix`. Si algún valor relevante (por ejemplo, el nombre del objeto, del tipo de registro o de la pestaña) contiene el fragmento, el nodo completo se conserva.
2. **Lista permitida opcional.** Al indicar `--exclude <archivo>`, el comando carga cada línea no vacía del archivo de texto (las rutas relativas se resuelven desde la raíz del proyecto). Cualquier entrada cuyo valor coincida exactamente con alguna de esas líneas se mantiene aunque no contenga el prefijo. Esto permite preservar objetos estándar o pestañas complementarias a tu solución.
3. **Filtrado por secciones.** El limpiador recorre las secciones `applicationVisibilities`, `classAccesses`, `customPermissions`, `fieldPermissions`, `objectPermissions`, `pageAccesses`, `recordTypeVisibilities`, `tabSettings` y `userPermissions`. En campos compuestos como `fieldPermissions` y `recordTypeVisibilities`, se evalúa tanto el nombre completo (`Account.Campo__c`) como sus componentes (`Account`, `Campo__c`) para que puedas conservar objetos completos o campos individuales.
4. **Metadatos restantes sin cambios.** Los elementos fuera de las secciones filtradas (etiquetas, descripciones, banderas de activación, etc.) se copian tal cual desde el permission set original.

El archivo de salida predeterminado sigue el patrón `<PermissionSet>_<prefix>_filtered.permissionset-meta.xml`. Usa `--output` para proporcionar un nombre personalizado (se agrega `.xml` automáticamente si se omite).

#### Banderas

| Bandera | Descripción | Valor por defecto |
|---------|-------------|-------------------|
| `--permissionset`, `-p` | **Requerida.** Nombre del archivo (con o sin `.permissionset-meta.xml`) ubicado en la carpeta de permission sets del proyecto. | N/A |
| `--prefix`, `-f` | **Requerida.** Fragmento que debe aparecer en una entrada para que permanezca en el archivo depurado. | N/A |
| `--exclude`, `-e` | Ruta a un archivo de texto (un valor por línea) con los nombres exactos que deben conservarse siempre. | Ninguno |
| `--output`, `-o` | Nombre del XML generado dentro de `cleanps/`. | `<PermissionSet>_<prefix>_filtered.permissionset-meta.xml` |
| `--project-dir` | Directorio raíz opcional que contiene `sfdx-project.json`. Si se omite, el comando recorre los padres del directorio actual hasta encontrarlo. | Detectado automáticamente |

### Comando `findtest`

Analiza las clases Apex y sus pruebas asociadas con:

```bash
sf metadelta findtest [banderas]
```

Por defecto el comando localiza `sfdx-project.json` en el directorio actual (o en sus padres) y revisa la carpeta `force-app/main/default/classes`.

> **Tip:** Después de actualizar el plugin ejecuta `sf plugins link .` nuevamente para que Salesforce CLI registre el comando `findtest`.

Cuando `--xml-name` apunta a un manifiesto que debe actualizarse (por ejemplo, para agregar pruebas detectadas), el comando reemplaza el nodo `<version>` con la versión de API reportada por la org indicada mediante `--org`/`--target-org`.

#### Guía rápida

| Escenario | Ejemplo |
|-----------|---------|
| Mostrar el mapeo Apex ↔︎ prueba en consola | `sf metadelta findtest` |
| Limitar el reporte a las clases Apex listadas en un manifiesto | `sf metadelta findtest --xml-name manifest/package.xml` |
| Validar un manifiesto contra una org específica manteniendo el dry-run | `sf metadelta findtest --xml-name manifest/package.xml --org SFOrg-devoss` |
| Ejecutar el asistente de despliegue sin agregar `--dry-run` | `sf metadelta findtest --xml-name manifest/package.xml --org SFOrg-devoss --run-deploy` |
| Desplegar a producción omitiendo `-l` cuando no hay clases Apex | `sf metadelta findtest --xml-name manifest/package.xml --org SFOrg-devoss --run-deploy-prod` |
| Ignorar el manifiesto y revisar solo el código local | `sf metadelta findtest --only-local` |
| Incluir clases de paquetes gestionados explícitamente | `sf metadelta findtest --xml-name manifest/package.xml --no-ignore-managed` |

#### Cómo se detectan las clases de prueba

`sf metadelta findtest` separa las clases Apex funcionales de las clases de prueba aplicando un patrón de nombre insensible a mayúsculas (`TEST_NAME_PATTERN`) mientras recorre el directorio indicado. Los archivos `.cls` que no coinciden con el patrón se consideran candidatos a validar; los que contienen `test`, `_test`, `testclass` u otros sufijos similares se tratan como posibles clases de prueba.

Para cada clase funcional, el comando intenta primero una coincidencia directa por sufijo (por ejemplo `AccountController` → `AccountControllerTest`, `AccountController_Test`, `AccountControllerTestClass`, etc.). Cuando encuentra una coincidencia directa, la relación se marca con confianza “exacta” y aparece en el mapeo mostrado en consola.

Si no existe una coincidencia directa, `findtest` recurre a una heurística basada en el contenido: abre cada clase de prueba candidata y busca instanciaciones, llamadas a métodos estáticos o declaraciones de variables que hagan referencia a la clase Apex (`new MiClase`, `MiClase.algunMetodo(`, `MiClase variable;`). El candidato con mayor puntaje se presenta como sugerencia de baja confianza para que revises o ajustes la cobertura manualmente.

#### Banderas

| Bandera | Descripción | Valor por defecto |
|--------|-------------|-------------------|
| `--project-dir` | Ruta al directorio raíz del proyecto Salesforce (donde vive `sfdx-project.json`). Si se omite, el comando recorre los directorios padres hasta encontrarlo. | Proyecto actual |
| `--source-dir` | Ruta relativa o absoluta a la carpeta que contiene las clases Apex a inspeccionar. | `force-app/main/default/classes` |
| `--xml-name` | Ruta relativa o absoluta a un `package.xml` existente. Al proporcionarla, el reporte parte de las clases Apex declaradas en el manifiesto y se usa el mismo archivo para validar despliegues. | N/A |
| `--org` | Alias o usuario de la org destino para el asistente de despliegue. Equivale a `--target-org` pero es más corto. | Org por defecto |
| `--target-org` | Alias o usuario pasado a `sf project deploy start` (mismo comportamiento que `--org`). | Org por defecto |
| `--run-deploy` | Ejecuta el asistente de despliegue sin agregar `--dry-run`. Si se omite, el asistente agrega `--dry-run` para mantener la validación no destructiva. | `false` |
| `--run-deploy-prod` | Asistente de despliegue para producción que omite la bandera `-l` cuando el manifiesto no contiene clases Apex y usa `-l RunSpecifiedTests` con las pruebas detectadas cuando sí existen. | `false` |
| `--only-local` | Ignora el manifiesto (si existe) y analiza únicamente las clases Apex presentes en el repositorio local. | `false` |
| `--ignore-managed`, `--no-ignore-managed` | Omite (`true`) o incluye (`false`) clases cuyos nombres comienzan con `namespace__`. | `true` |
| `--ignore-communities`, `--no-ignore-communities` | Omite (`true`) o incluye (`false`) los controladores estándar de Communities (ChangePasswordController, etc.). | `true` |
| `--verbose` | Muestra advertencias detalladas para cada clase filtrada o ausente localmente. | `false` |
| `--json` | Emite un resumen en formato JSON con métricas de filtrado (`inputCount`, `filteredCount`, `finalCount` y las listas ignoradas/faltantes). | `false` |

#### Salida

Cada ejecución inicia con una línea resumen indicando cuántas clases provienen del manifiesto (o del filesystem), cuántas se filtraron y cuántas existen en el repositorio local. El mapeo detallado mantiene el formato del script original (`ApexClass → ApexTest`). Al usar un manifiesto, el comando omite automáticamente las entradas de paquetes gestionados (`namespace__*`) y los controladores comunes de Communities, a menos que elijas incluirlos; solo se consideran las clases que existen localmente. Usa `--verbose` para listar los nombres filtrados y `--json` si necesitas capturar las métricas programáticamente.

Solo se consideran confiables las clases de prueba cuyo nombre coincide directamente con la clase Apex (`MiClaseTest`, `MiClase_Test`, `MiClaseTests`, …). Las coincidencias heurísticas se muestran como advertencias para revisión y **no** se agregan automáticamente al manifiesto ni a los comandos de despliegue.

### Comando `manual collect`

Genera un cuaderno consolidado de pasos manuales leyendo los archivos markdown ubicados en un directorio como `docs/`. Los nombres válidos siguen el patrón `OSS-FSL-<historia>-<PRE|POST>.md` (las variantes con `OSSFSL` se normalizan automáticamente). Ejecuta el comando así:

```bash
sf metadelta manual collect --docs ./docs --output ./docs/MANUAL-STEPS.md --all
```

De forma predeterminada (o al usar `--all`) el comando procesa todos los `.md` válidos, ordena las entradas colocando primero los pasos `PRE`, respeta el orden cronológico (según `mtime` salvo que indiques `--order-by git`) y genera un markdown con índice, banner de metadatos y el contenido original de cada historia.

Activa `--partial` para limitar el resultado a las historias que siguen pendientes de merge entre una rama de sprint y la rama base. Internamente se ejecuta `git diff --name-only <base>..<sprint> -- docs/` y se filtra la lista para conservar únicamente los documentos de pasos manuales:

```bash
sf metadelta manual collect \
  --docs ./docs \
  --output ./docs/MANUAL-STEPS.md \
  --partial \
  --sprint-branch SP1/main \
  --base-branch master \
  --sprint-name SP1 \
  --order-by git
```

Si el rango solicitado no contiene archivos válidos, el comando se detiene con un mensaje claro para que verifiques si el sprint efectivamente mergeó documentación. Omitir `--partial` y `--all` produce el mismo comportamiento que `--all` para mayor comodidad.

#### Banderas

| Bandera | Descripción | Valor por defecto |
|---------|-------------|-------------------|
| `--docs`, `-d` | **Requerida.** Directorio que contiene los `.md` de pasos manuales. | N/A |
| `--output`, `-o` | **Requerida.** Archivo markdown de salida que contendrá el consolidado. | N/A |
| `--partial` | Limita la salida a los archivos pendientes de merge entre la rama base y la rama de sprint. Requiere `--sprint-branch`. | `false` |
| `--all` | Fuerza la inclusión de todos los archivos válidos dentro de `--docs`. (También es el comportamiento predeterminado cuando no se usa `--partial`.) | `false` |
| `--sprint-branch` | Rama de sprint a considerar en modo parcial. | N/A |
| `--sprint-name` | Etiqueta opcional mostrada en el encabezado/banner del markdown. | Ninguno |
| `--base-branch` | Rama base utilizada para calcular el diff cuando `--partial` está activo. | `master` |
| `--order-by` | Fuente de la fecha utilizada para ordenar (`mtime` o `git`). | `mtime` |

### Comando `merge`

Combina múltiples fragmentos de manifiesto en un solo paquete con:

```bash
sf metadelta merge --xml-name <subcadena> [banderas]
```

Por defecto el comando revisa el directorio `manifest/` y ubica los archivos XML cuyo nombre contenga la subcadena proporcionada. Luego fusiona sus nodos `<types>`, elimina duplicados por tipo de metadato y conserva la versión de API más alta encontrada. Cada nodo `<members>` del manifiesto final incorpora un comentario `<!-- origen -->` con los nombres de los manifests que aportaron ese componente (sin la extensión `.xml`) para que puedas rastrear su procedencia. El resultado se guarda como `manifest/globalpackage.xml`, a menos que definas otro nombre.

Si agregas `--partial --sprint-branch <nombre> [--base-branch master]`, el comando limita su búsqueda a los manifests que siguen pendientes de merge entre la rama de sprint y la base. Internamente ejecuta `git diff --name-only <base>..<sprint> -- manifest/` (respetando `--directory`) y conserva solo los archivos XML que coinciden con la subcadena indicada. Cuando el diff no contiene coincidencias, se detiene con un mensaje claro para que ajustes el rango o vuelvas al modo completo.

#### Banderas

| Bandera | Descripción | Valor por defecto |
|---------|-------------|-------------------|
| `--xml-name`, `-x` | **Requerida.** Subcadena que deben contener los nombres de los manifiestos a combinar. | N/A |
| `--directory`, `-d` | Directorio que contiene los archivos XML de manifiesto a unir. | `manifest` |
| `--output`, `-o` | Nombre del archivo combinado que se generará. | `globalpackage.xml` |
| `--partial` | Limita la combinación a los manifests pendientes de merge entre la rama base y la rama de sprint. Requiere `--sprint-branch`. | `false` |
| `--sprint-branch` | Rama de sprint que contiene los manifests recientes. | N/A |
| `--base-branch` | Rama base que ya llegó a producción. Se usa para calcular el diff en modo parcial. | `master` |

#### Ejemplo

Para unir todos los manifiestos cuyo nombre contenga `OSSFSL` en `manifest/globalpackage.xml`:

```bash
sf metadelta merge --xml-name OSSFSL

Para combinar únicamente los manifests que aún no se fusionaron en `master`:

```bash
sf metadelta merge --xml-name OSSFSL --partial --sprint-branch SP1/main --base-branch master
```
```

#### Flujo de despliegue (package.xml existente)

Al indicar un manifiesto (apuntando `--xml-name` a un archivo existente), el comando:

1. Lee el `package.xml` existente (el archivo debe estar creado previamente).
2. Verifica si existen nodos `<types><name>ApexClass</name></types>`. Si no hay clases Apex, ejecuta `sf project deploy start --manifest <archivo> -l NoTestRun` y agrega `--dry-run` a menos que indiques `--run-deploy`.
3. Construye la lista a evaluar intersectando el manifiesto con el filesystem local y, opcionalmente, eliminando las clases de paquetes gestionados y los controladores de Communities. Usa `--verbose` para conocer qué elementos se omitieron.
4. Busca la clase de prueba asociada para cada entrada Apex restante. Se agregan al manifiesto las coincidencias directas (`MiClaseTest`, `MiClase_Test`, `MiClaseTests`, …). Las coincidencias basadas solo en similitud del nombre se muestran como advertencias para que verifiques la cobertura manualmente.
5. Si alguna clase Apex no tiene prueba asociada, solo cuenta con una coincidencia heurística o falta el archivo `.cls` requerido, el comando reporta los nombres y omite `sf project deploy start` para que puedas corregir el manifiesto o restaurar los archivos.
6. De lo contrario, ejecuta `sf project deploy start --manifest <archivo> -l RunSpecifiedTests -t <Prueba1> -t <Prueba2> …` (o `-l NoTestRun` si no se detectan pruebas). El comando agrega `--dry-run` a menos que indiques `--run-deploy`. Usa `--org`/`--target-org` para sobrescribir la org predeterminada.

### Salida

El comando imprime cada componente coincidente con su tipo, nombre completo, fecha de última modificación y usuario modificador. Cuando se establecen `--xml` o `--yaml`, los archivos de manifiesto correspondientes se crean dentro del directorio `manifest/`. Si el comando se ejecuta dentro de un repositorio Git, el nombre del archivo utiliza la rama actual; en caso contrario, emplea el alias de la org. Los archivos existentes se conservan agregando sufijos incrementales `-v1`, `-v2`, ….

### Desinstalación

Para desvincular el plugin de tu Salesforce CLI:
```bash
sf plugins unlink @nervill/metadelta
```

### Licencia

Este proyecto se publica bajo la [licencia ISC](LICENSE).
