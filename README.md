# Metadelta Salesforce CLI Plugin

- [English](#english)
- [Español](#español)

## English

Metadelta is a custom Salesforce CLI plugin that offers two complementary workflows:

* `sf metadelta find` inspects a target org and reports metadata components modified by a specific user within a recent time window, optionally generating manifest files for deployment or Vlocity datapack migration.
* `sf metadelta findtest` reviews Apex classes inside a local SFDX project, confirms the presence of their corresponding test classes, and can validate existing `package.xml` manifests prior to a deployment.

Created by **Nerio Villalobos** (<nervill@gmail.com>).

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
   Confirm installation with `sf plugins`, which should list `sf-metadelta`.

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
| `--metafile` | Path to a JavaScript file exporting a `metadataTypes` array to override the default metadata types. | Built‑in list |
| `--days` | Number of days in the past to inspect for modifications. | `3` |
| `--namespace` | Vlocity namespace to query datapacks (enables Vlocity datapack checks). | None |
| `--xml` | When set, generates `manifest/package-<branch_or_org>[-v#].xml` containing found metadata. | `false` |
| `--yaml` | When set, generates `manifest/package-vlocity-<branch_or_org>[-v#].yaml` with Vlocity datapack entries. | `false` |
| `--audit` | Full name of the user to audit. If omitted, the command uses the org user associated with the provided alias. | Authenticated user |

#### Using a custom metadata file

By default, the command builds its metadata type list by running `sf force:mdapi:describemetadata --target-org` so it stays synchronized with the connected org. If the describe call fails, a built-in fallback list is used. The resulting list is further filtered to include only types that expose both `lastModifiedByName` and `lastModifiedDate`, avoiding unnecessary queries. A maximum of five metadata types are processed in parallel to limit resource usage.

The `--metafile` flag allows you to override the built‑in metadata list. Create a JavaScript file that exports a `metadataTypes` array. Both CommonJS and ES module syntaxes are accepted, even in projects using `"type": "module"`. For CommonJS:

```js
module.exports = {
  metadataTypes: [
    'Bot','BotVersion','CustomPermission','FlexiPage','Flow','GenAiFunction',
    'GenAiPlanner','GenAiPlugin','GenAiPlannerBundle','PermissionSet','Profile',
    'StaticResource','PermissionSetGroup'
  ]
};
```

ES modules are also supported:

```js
export const metadataTypes = ['Bot','BotVersion'];
```

Reference the file when running the command:

```bash
sf metadelta find --org myOrg --metafile ./mismetadatos.js
```

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
| Restrict the report to the Apex classes listed in a manifest | `sf metadelta findtest --xml-name manifest/package.xml` |
| Validate a manifest against a specific org while keeping a dry-run deploy | `sf metadelta findtest --xml-name manifest/package.xml --org TelecomPY-devoss` |
| Execute the deployment helper without --dry-run | `sf metadelta findtest --xml-name manifest/package.xml --org TelecomPY-devoss --run-deploy` |
| Ignore the manifest and inspect only local sources | `sf metadelta findtest --only-local` |
| Include managed-package classes explicitly | `sf metadelta findtest --xml-name manifest/package.xml --no-ignore-managed` |

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

#### Deployment flow (existing `package.xml`)

When you provide a manifest file (by pointing `--xml-name` to an existing file), the command:

1. Reads the existing `package.xml` (the file must already exist).
2. Checks for `<types><name>ApexClass</name></types>` entries. If none are present, it runs `sf project deploy start --manifest <file> -l NoTestRun` and adds `--dry-run` unless you include `--run-deploy`.
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

Metadelta es un plugin personalizado de Salesforce CLI que ofrece dos flujos complementarios:

* `sf metadelta find` inspecciona una org de destino y reporta los componentes de metadatos modificados por un usuario específico durante un rango de tiempo reciente, generando opcionalmente manifiestos para despliegues o migraciones de paquetes de Vlocity.
* `sf metadelta findtest` revisa las clases Apex dentro de un proyecto SFDX local, confirma la presencia de sus clases de prueba correspondientes y puede validar `package.xml` existentes antes de un despliegue.

Creado por **Nerio Villalobos** (<nervill@gmail.com>).

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
| `--metafile` | Ruta a un archivo JavaScript que exporta un arreglo `metadataTypes` para reemplazar los tipos predeterminados. | Lista integrada |
| `--days` | Número de días hacia atrás a inspeccionar por modificaciones. | `3` |
| `--namespace` | Namespace de Vlocity para consultar datapacks (habilita las revisiones de datapacks). | Ninguno |
| `--xml` | Si se especifica, genera `manifest/package-<rama_o_org>[-v#].xml` con los metadatos encontrados. | `false` |
| `--yaml` | Si se especifica, genera `manifest/package-vlocity-<rama_o_org>[-v#].yaml` con entradas de datapacks de Vlocity. | `false` |
| `--audit` | Nombre completo del usuario a auditar. Si se omite, el comando utiliza el usuario asociado al alias proporcionado. | Usuario autenticado |

#### Uso de un archivo de metadatos personalizado

Por defecto, el comando construye la lista de tipos de metadatos ejecutando `sf force:mdapi:describemetadata --target-org`, de modo que se mantenga sincronizada con la org conectada. Si la llamada de describe falla, se utiliza una lista integrada de respaldo. La lista resultante se filtra para conservar solo los tipos que exponen `lastModifiedByName` y `lastModifiedDate`, evitando consultas innecesarias. Además, se procesan como máximo cinco tipos de metadatos en paralelo para no saturar la memoria.

La bandera `--metafile` permite reemplazar la lista integrada de tipos de metadatos. Crea un archivo JavaScript que exporte un arreglo `metadataTypes`. Se aceptan sintaxis CommonJS y ES module, incluso en proyectos con `"type": "module"`. En CommonJS:

```js
module.exports = {
  metadataTypes: [
    'Bot','BotVersion','CustomPermission','FlexiPage','Flow','GenAiFunction',
    'GenAiPlanner','GenAiPlugin','GenAiPlannerBundle','PermissionSet','Profile',
    'StaticResource','PermissionSetGroup'
  ]
};
```

También se admite sintaxis de ES modules:

```js
export const metadataTypes = ['Bot','BotVersion'];
```

Luego ejecuta el comando haciendo referencia al archivo:

```bash
sf metadelta find --org miOrg --metafile ./mismetadatos.js
```

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

