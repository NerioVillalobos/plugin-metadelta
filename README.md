# Metadelta Salesforce CLI Plugin

- [English](#english)
- [Español](#español)

## English

Metadelta is a custom Salesforce CLI plugin that offers four complementary workflows:

* `sf metadelta find` inspects a target org and reports metadata components modified by a specific user within a recent time window, optionally generating manifest files for deployment or Vlocity datapack migration.
* `sf metadelta findtest` reviews Apex classes inside a local SFDX project, confirms the presence of their corresponding test classes, and can validate existing `package.xml` manifests prior to a deployment.
* `sf metadelta merge` scans manifest XML files whose names contain a given substring, deduplicates their metadata members, and builds a consolidated `globalpackage.xml` (or a custom output filename).
* `sf metadelta cleanps` extracts a focused copy of a permission set by keeping only the entries that match a fragment or appear in a curated allowlist.

Created by **Nerio Villalobos** (<nervill@gmail.com>).

### Index

- [Installation](#installation)
- [`sf metadelta find`](#usage)
- [`sf metadelta cleanps`](#cleanps-command)
- [`sf metadelta findtest`](#findtest-command)
- [`sf metadelta merge`](#merge-command)

### Installation

1. Install the Salesforce CLI (requires version `2.102.6` or later):
   ```bash
   npm install --global @salesforce/cli@2.102.6
   ```
2. Clone this repository and install dependencies:
   ```bash
   git clone <repo-url>
   cd plugin-metadelta
   npm install
   ```
3. Link the plugin to your local Salesforce CLI:
   ```bash
   sf plugins link .
   ```
   Confirm installation with `sf plugins`, which should list `sf-metadelta 0.5.0 (link)`.

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
| `--xml` | When set, generates `manifest/package-<branch_or_org>[-v#].xml` containing found metadata. | `false` |
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

#### Quick start

| Scenario | Example |
|----------|---------|
| Show the Apex ↔︎ test mapping in the console | `sf metadelta findtest` |
| Restrict the report to the Apex classes listed in a manifest (analysis only) | `sf metadelta findtest --xml-name manifest/package.xml` |
| Validate a manifest against a specific org while keeping a dry-run deploy | `sf metadelta findtest --xml-name manifest/package.xml --org TelecomPY-devoss` |
| Execute the deployment helper without --dry-run | `sf metadelta findtest --xml-name manifest/package.xml --org TelecomPY-devoss --run-deploy` |
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
| `--only-local` | Ignores the manifest (if any) and analyses only the Apex classes present in the local repository. | `false` |
| `--ignore-managed`, `--no-ignore-managed` | Skip (`true`) or include (`false`) classes whose names start with `namespace__`. | `true` |
| `--ignore-communities`, `--no-ignore-communities` | Skip (`true`) or include (`false`) the built-in Communities controllers (ChangePasswordController, etc.). | `true` |
| `--verbose` | Print detailed warnings for every class filtered out or missing locally. | `false` |
| `--json` | Emit a JSON summary with filtering metrics (`inputCount`, `filteredCount`, `finalCount`, and ignored/missing lists). | `false` |

#### Output

Every run starts with a summary line detailing how many classes came from the manifest (or filesystem), how many were filtered out, and how many remain in the local repository. The detailed mapping preserves the original script format (`ApexClass → ApexTest`). When a manifest is provided, the command automatically ignores managed-package entries (`namespace__*`) and common Communities controllers unless you opt back in; only classes that exist locally are considered for test discovery. Use `--verbose` to list the filtered names and `--json` to capture the underlying metrics programmatically.

Only test classes whose names match the Apex class directly (`MyClassTest`, `MyClass_Test`, `MyClassTests`, …) are considered reliable and appear in the mapping. Potential matches detected heuristically are reported as warnings for review and are **not** added to manifests or deployment commands automatically.

### `merge` command

Combine multiple manifest fragments into a single package with:

```bash
sf metadelta merge --xml-name <substring> [flags]
```

By default the command looks inside the `manifest/` directory for XML files whose filenames contain the provided substring. It merges their `<types>` entries, deduplicating members per metadata type and keeping the highest API version found across the inputs. The result is saved to `manifest/globalpackage.xml`, unless you override the filename.

#### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--xml-name`, `-x` | **Required.** Substring that matching manifest filenames must contain. | N/A |
| `--directory`, `-d` | Directory that holds the manifest XML files to merge. | `manifest` |
| `--output`, `-o` | Name of the combined manifest file to generate. | `globalpackage.xml` |

#### Example

To merge every manifest whose filename contains `OSSFSL` into `manifest/globalpackage.xml`:

```bash
sf metadelta merge --xml-name OSSFSL
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
sf plugins unlink sf-metadelta
```

### License

This project is released under the [ISC License](LICENSE).

## Español

Metadelta es un plugin personalizado de Salesforce CLI que ofrece cuatro flujos complementarios:

* `sf metadelta find` inspecciona una org de destino y reporta los componentes de metadatos modificados por un usuario específico durante un rango de tiempo reciente, generando opcionalmente manifiestos para despliegues o migraciones de paquetes de Vlocity.
* `sf metadelta findtest` revisa las clases Apex dentro de un proyecto SFDX local, confirma la presencia de sus clases de prueba correspondientes y puede validar `package.xml` existentes antes de un despliegue.
* `sf metadelta merge` busca archivos de manifiesto cuyos nombres contengan una subcadena específica, unifica sus miembros de metadatos sin duplicados y construye un `globalpackage.xml` consolidado (o el nombre de archivo que indiques).
* `sf metadelta cleanps` genera una copia depurada de un permission set conservando solo los nodos que coincidan con un fragmento o con una lista permitida.

Creado por **Nerio Villalobos** (<nervill@gmail.com>).

### Índice

- [Instalación](#instalación)
- [`sf metadelta find`](#uso)
- [`sf metadelta cleanps`](#comando-cleanps)
- [`sf metadelta findtest`](#comando-findtest)
- [`sf metadelta merge`](#comando-merge)

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
   Confirma la instalación con `sf plugins`, que debe mostrar `sf-metadelta`.

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
| `--xml` | Si se especifica, genera `manifest/package-<rama_o_org>[-v#].xml` con los metadatos encontrados. | `false` |
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

#### Guía rápida

| Escenario | Ejemplo |
|-----------|---------|
| Mostrar el mapeo Apex ↔︎ prueba en consola | `sf metadelta findtest` |
| Limitar el reporte a las clases Apex listadas en un manifiesto | `sf metadelta findtest --xml-name manifest/package.xml` |
| Validar un manifiesto contra una org específica manteniendo el dry-run | `sf metadelta findtest --xml-name manifest/package.xml --org TelecomPY-devoss` |
| Ejecutar el asistente de despliegue sin agregar `--dry-run` | `sf metadelta findtest --xml-name manifest/package.xml --org TelecomPY-devoss --run-deploy` |
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
| `--only-local` | Ignora el manifiesto (si existe) y analiza únicamente las clases Apex presentes en el repositorio local. | `false` |
| `--ignore-managed`, `--no-ignore-managed` | Omite (`true`) o incluye (`false`) clases cuyos nombres comienzan con `namespace__`. | `true` |
| `--ignore-communities`, `--no-ignore-communities` | Omite (`true`) o incluye (`false`) los controladores estándar de Communities (ChangePasswordController, etc.). | `true` |
| `--verbose` | Muestra advertencias detalladas para cada clase filtrada o ausente localmente. | `false` |
| `--json` | Emite un resumen en formato JSON con métricas de filtrado (`inputCount`, `filteredCount`, `finalCount` y las listas ignoradas/faltantes). | `false` |

#### Salida

Cada ejecución inicia con una línea resumen indicando cuántas clases provienen del manifiesto (o del filesystem), cuántas se filtraron y cuántas existen en el repositorio local. El mapeo detallado mantiene el formato del script original (`ApexClass → ApexTest`). Al usar un manifiesto, el comando omite automáticamente las entradas de paquetes gestionados (`namespace__*`) y los controladores comunes de Communities, a menos que elijas incluirlos; solo se consideran las clases que existen localmente. Usa `--verbose` para listar los nombres filtrados y `--json` si necesitas capturar las métricas programáticamente.

Solo se consideran confiables las clases de prueba cuyo nombre coincide directamente con la clase Apex (`MiClaseTest`, `MiClase_Test`, `MiClaseTests`, …). Las coincidencias heurísticas se muestran como advertencias para revisión y **no** se agregan automáticamente al manifiesto ni a los comandos de despliegue.

### Comando `merge`

Combina múltiples fragmentos de manifiesto en un solo paquete con:

```bash
sf metadelta merge --xml-name <subcadena> [banderas]
```

Por defecto el comando revisa el directorio `manifest/` y ubica los archivos XML cuyo nombre contenga la subcadena proporcionada. Luego fusiona sus nodos `<types>`, elimina duplicados por tipo de metadato y conserva la versión de API más alta encontrada. El resultado se guarda como `manifest/globalpackage.xml`, a menos que definas otro nombre.

#### Banderas

| Bandera | Descripción | Valor por defecto |
|---------|-------------|-------------------|
| `--xml-name`, `-x` | **Requerida.** Subcadena que deben contener los nombres de los manifiestos a combinar. | N/A |
| `--directory`, `-d` | Directorio que contiene los archivos XML de manifiesto a unir. | `manifest` |
| `--output`, `-o` | Nombre del archivo combinado que se generará. | `globalpackage.xml` |

#### Ejemplo

Para unir todos los manifiestos cuyo nombre contenga `OSSFSL` en `manifest/globalpackage.xml`:

```bash
sf metadelta merge --xml-name OSSFSL
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
sf plugins unlink sf-metadelta
```

### Licencia

Este proyecto se publica bajo la [licencia ISC](LICENSE).

