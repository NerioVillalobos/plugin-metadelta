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

Run the following command to analyse Apex classes inside your local Salesforce project:

```bash
sf metadelta findtest [flags]
```

By default the command searches for classes in `force-app/main/default/classes` under the directory that contains `sfdx-project.json`.
Use the flags below to customise the behaviour.

#### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--project-dir` | Path to the Salesforce project root (where `sfdx-project.json` lives). When omitted, the command walks up from the current directory until it finds the project root. | Current project |
| `--source-dir` | Relative or absolute path to the folder that stores the Apex classes to inspect. | `force-app/main/default/classes` |
| `--xml` | Generates `manifest/<name>.xml` with the Apex ↔︎ test mapping. | `false` |
| `--xml-name` | Explicit filename to use with `--xml`. When omitted the command uses the Git branch name (if any) or `package-apextest.xml`. | Derived name |
| `--branch` | Overrides the Git branch name when composing the XML filename. | Detected branch |
| `--deploy` | Path to an existing `package.xml` manifest that should be validated and used for deployment. | N/A |
| `--target-org` | Alias or username of the target org when invoking `sf project deploy start`. | Default CLI org |

#### Output

The visual mode prints the mapping exactly as: `ApexClass → ApexTest`. When `--xml` is present an XML file is written inside the `manifest/` directory following the mapping order.

#### Deployment helper

When `--deploy <path/to/package.xml>` is provided, the command:

1. Reads the manifest and ensures the `ApexClass` node exists.
2. Appends any missing test classes corresponding to the Apex classes listed in the manifest.
3. Saves the updated manifest without altering other nodes.
4. Executes `sf project deploy start --manifest <file> --dry-run` with either `-l NoTestRun` (if no tests are required) or `-l RunSpecifiedTests` plus one `-t <TestClass>` argument per detected test.

Use `--target-org` to point to a specific org; otherwise the default org configured in the Salesforce CLI is used.

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

Ejecuta el siguiente comando para analizar las clases Apex de tu proyecto local de Salesforce:

```bash
sf metadelta findtest [banderas]
```

Por defecto el comando busca las clases dentro de `force-app/main/default/classes` partiendo del directorio que contiene `sfdx-project.json`.
Puedes ajustar el comportamiento con las banderas descritas a continuación.

#### Banderas

| Bandera | Descripción | Valor por defecto |
|--------|-------------|-------------------|
| `--project-dir` | Ruta al directorio raíz del proyecto Salesforce (donde vive `sfdx-project.json`). Si se omite, el comando recorre los directorios padres hasta encontrarlo. | Proyecto actual |
| `--source-dir` | Ruta relativa o absoluta a la carpeta que contiene las clases Apex a inspeccionar. | `force-app/main/default/classes` |
| `--xml` | Genera `manifest/<nombre>.xml` con el mapeo Apex ↔︎ pruebas. | `false` |
| `--xml-name` | Nombre explícito para usar junto con `--xml`. Si se omite, se usa la rama de Git (si existe) o `package-apextest.xml`. | Nombre derivado |
| `--branch` | Sobrescribe el nombre de la rama Git al componer el archivo XML. | Rama detectada |
| `--deploy` | Ruta a un `package.xml` existente que se validará y utilizará para el despliegue. | N/A |
| `--target-org` | Alias o usuario de la org destino al invocar `sf project deploy start`. | Org por defecto de la CLI |

#### Salida

El modo visual imprime el mapeo exactamente como `ApexClass → ApexTest`. Cuando se usa `--xml`, se escribe un archivo XML dentro del directorio `manifest/` siguiendo el orden del mapeo.

#### Asistente de despliegue

Al proporcionar `--deploy <ruta/a/package.xml>`, el comando:

1. Lee el manifiesto y garantiza la existencia del nodo `ApexClass`.
2. Agrega las clases de prueba faltantes correspondientes a las clases Apex listadas en el manifiesto.
3. Guarda el manifiesto actualizado sin modificar los demás nodos.
4. Ejecuta `sf project deploy start --manifest <archivo> --dry-run` usando `-l NoTestRun` (si no se requieren pruebas) o `-l RunSpecifiedTests` junto con un argumento `-t <ClaseTest>` por cada prueba detectada.

Utiliza `--target-org` para apuntar a una org específica; en caso contrario se emplea la org predeterminada configurada en Salesforce CLI.

### Salida

El comando imprime cada componente coincidente con su tipo, nombre completo, fecha de última modificación y usuario modificador. Cuando se establecen `--xml` o `--yaml`, los archivos de manifiesto correspondientes se crean dentro del directorio `manifest/`. Si el comando se ejecuta dentro de un repositorio Git, el nombre del archivo utiliza la rama actual; en caso contrario, emplea el alias de la org. Los archivos existentes se conservan agregando sufijos incrementales `-v1`, `-v2`, ….

### Desinstalación

Para desvincular el plugin de tu Salesforce CLI:
```bash
sf plugins unlink sf-metadelta
```

### Licencia

Este proyecto se publica bajo la [licencia ISC](LICENSE).

