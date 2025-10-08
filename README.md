# Metadelta Salesforce CLI Plugin

- [English](#english)
- [Español](#español)

## English

Metadelta is a custom Salesforce CLI plugin that inspects a target org and reports metadata components modified by a specific user within a recent time window. It optionally generates manifest files for deployment or Vlocity datapack migration.

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
| Save the mapping to `manifest/<branch>.xml` | `sf metadelta findtest --xml` |
| Save the mapping to a custom path | `sf metadelta findtest --xml --xml-name manifest/tests/package.xml` |
| Validate an existing manifest (using `--xml-name`) and prepare deployment | `sf metadelta findtest --xml-name manifest/package.xml --target-org MyOrg` |
| Validate an existing manifest (explicit `--deploy`) | `sf metadelta findtest --deploy manifest/package.xml --target-org MyOrg` |

#### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--project-dir` | Path to the Salesforce project root (folder that contains `sfdx-project.json`). If omitted, the command walks up from the current directory until it finds it. | Current project |
| `--source-dir` | Relative or absolute path to the Apex classes directory. | `force-app/main/default/classes` |
| `--xml` | Writes an XML report with the Apex ↔︎ test mapping. | `false` |
| `--xml-name` | File name or relative/absolute path for the XML generated with `--xml`. If the referenced file already exists, the command treats it as an existing `package.xml` manifest for validation and deployment. When omitted the file is stored in `manifest/` and named after the current Git branch or `package-apextest.xml`. | Derived name or provided path |
| `--branch` | Overrides the Git branch name when generating the default XML filename. | Detected branch |
| `--deploy` | Path (relative to the project root or absolute) to an existing `package.xml` manifest. The command never creates a new manifest; it validates and enriches the provided file. This flag is optional when `--xml-name` already points to an existing manifest. | N/A |
| `--target-org` | Alias or username passed to `sf project deploy start`. If omitted, the default org configured in the Salesforce CLI is used. | CLI default |

#### Output

The console output mirrors the original script exactly (`ApexClass → ApexTest`). When you validate an existing manifest (via `--deploy` or an `--xml-name` that points to a `package.xml`), the listing is restricted to the Apex classes declared in that file. When `--xml` is present, the mapping is written to the provided path or to `manifest/<branch>.xml`.

#### Deployment flow (`--deploy` / existing `--xml-name`)

When you provide a manifest file (with `--deploy` or by pointing `--xml-name` to an existing file), the command:

1. Reads the existing `package.xml` (the file must already exist).
2. Checks for `<types><name>ApexClass</name></types>` entries. If none are present, it runs `sf project deploy start --manifest <file> -l NoTestRun --dry-run`.
3. For every Apex class in the manifest, finds the associated test class. Missing tests are appended to the same `<types>` node without altering other sections.
4. Warns about Apex classes that have no detectable tests.
5. Executes `sf project deploy start --manifest <file> -l RunSpecifiedTests -t <Test1> -t <Test2> … --dry-run` (or `-l NoTestRun` if no tests were detected). Use `--target-org` to override the CLI default org.

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

Metadelta es un plugin personalizado de Salesforce CLI que inspecciona una org de destino y reporta los componentes de metadatos modificados por un usuario específico durante un rango de tiempo reciente. Opcionalmente genera archivos de manifiesto para despliegues o migraciones de paquetes de Vlocity.

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
| Guardar el mapeo en `manifest/<rama>.xml` | `sf metadelta findtest --xml` |
| Guardar el mapeo en una ruta personalizada | `sf metadelta findtest --xml --xml-name manifest/tests/package.xml` |
| Validar un manifiesto existente usando `--xml-name` | `sf metadelta findtest --xml-name manifest/package.xml --target-org MiOrg` |
| Validar un manifiesto existente con `--deploy` | `sf metadelta findtest --deploy manifest/package.xml --target-org MiOrg` |

#### Banderas

| Bandera | Descripción | Valor por defecto |
|--------|-------------|-------------------|
| `--project-dir` | Ruta al directorio raíz del proyecto Salesforce (donde vive `sfdx-project.json`). Si se omite, el comando recorre los directorios padres hasta encontrarlo. | Proyecto actual |
| `--source-dir` | Ruta relativa o absoluta a la carpeta que contiene las clases Apex a inspeccionar. | `force-app/main/default/classes` |
| `--xml` | Genera un archivo XML con el mapeo Apex ↔︎ pruebas. | `false` |
| `--xml-name` | Nombre de archivo o ruta relativa/absoluta para el XML generado con `--xml`. Si el archivo ya existe, el comando lo utiliza como `package.xml` para validación y despliegue. Si se omite, se guarda en `manifest/` usando el nombre de la rama Git o `package-apextest.xml`. | Nombre derivado o ruta indicada |
| `--branch` | Sobrescribe el nombre de la rama Git al generar el archivo XML por defecto. | Rama detectada |
| `--deploy` | Ruta (relativa al proyecto o absoluta) a un `package.xml` existente. El comando nunca crea un manifiesto nuevo; solo valida y enriquece el archivo indicado. Esta bandera es opcional cuando `--xml-name` ya apunta a un manifiesto existente. | N/A |
| `--target-org` | Alias o usuario de la org destino al invocar `sf project deploy start`. Si se omite, se usa la org por defecto de la CLI. | Org por defecto |

#### Salida

La salida en consola replica exactamente el script original (`ApexClass → ApexTest`). Cuando se valida un manifiesto existente (mediante `--deploy` o un `--xml-name` que apunte a un `package.xml`), el listado se limita a las clases Apex declaradas en dicho archivo. Cuando se emplea `--xml`, el mapeo se escribe en la ruta indicada o en `manifest/<rama>.xml`.

#### Flujo de despliegue (`--deploy` / `--xml-name` existente)

Al indicar un manifiesto (ya sea con `--deploy` o apuntando `--xml-name` a un archivo existente), el comando:

1. Lee el `package.xml` existente (el archivo debe estar creado previamente).
2. Verifica si existen nodos `<types><name>ApexClass</name></types>`. Si no hay clases Apex, ejecuta `sf project deploy start --manifest <archivo> -l NoTestRun --dry-run`.
3. Para cada clase Apex del manifiesto busca la clase de prueba asociada. Las pruebas faltantes se agregan en el mismo nodo `<types>` sin modificar el resto del archivo.
4. Advierte sobre las clases Apex que no tienen pruebas detectables.
5. Ejecuta `sf project deploy start --manifest <archivo> -l RunSpecifiedTests -t <Prueba1> -t <Prueba2> … --dry-run` (o `-l NoTestRun` si no se detectan pruebas). Usa `--target-org` para sobreescribir la org predeterminada.

### Salida

El comando imprime cada componente coincidente con su tipo, nombre completo, fecha de última modificación y usuario modificador. Cuando se establecen `--xml` o `--yaml`, los archivos de manifiesto correspondientes se crean dentro del directorio `manifest/`. Si el comando se ejecuta dentro de un repositorio Git, el nombre del archivo utiliza la rama actual; en caso contrario, emplea el alias de la org. Los archivos existentes se conservan agregando sufijos incrementales `-v1`, `-v2`, ….

### Desinstalación

Para desvincular el plugin de tu Salesforce CLI:
```bash
sf plugins unlink sf-metadelta
```

### Licencia

Este proyecto se publica bajo la [licencia ISC](LICENSE).

