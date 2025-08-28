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
| `--xml` | When set, generates `manifest/package-<org>.xml` containing found metadata. | `false` |
| `--yaml` | When set, generates `manifest/package-vlocity-<org>.yaml` with Vlocity datapack entries. | `false` |
| `--audit` | Full name of the user to audit. If omitted, the command uses the org user associated with the provided alias. | Authenticated user |

#### Custom metadata file

If you use `--metafile`, the referenced JavaScript file must export a `metadataTypes` array, for example:

```javascript
module.exports.metadataTypes = [
  'ApexClass', 'Flow'
];
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

### Output

The command prints each matching component with its type, full name, last modified date, and modifier. When `--xml` or `--yaml` are set, the corresponding manifest files are created inside the `manifest/` directory.

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
| `--xml` | Si se especifica, genera `manifest/package-<org>.xml` con los metadatos encontrados. | `false` |
| `--yaml` | Si se especifica, genera `manifest/package-vlocity-<org>.yaml` con entradas de datapacks de Vlocity. | `false` |
| `--audit` | Nombre completo del usuario a auditar. Si se omite, el comando utiliza el usuario asociado al alias proporcionado. | Usuario autenticado |

#### Ejemplo de archivo de metadatos

Si usas `--metafile`, el archivo JavaScript indicado debe exportar un arreglo `metadataTypes`, por ejemplo:

```javascript
module.exports.metadataTypes = [
  'ApexClass', 'Flow'
];
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

### Salida

El comando imprime cada componente coincidente con su tipo, nombre completo, fecha de última modificación y usuario modificador. Cuando se establecen `--xml` o `--yaml`, los archivos de manifiesto correspondientes se crean dentro del directorio `manifest/`.

### Desinstalación

Para desvincular el plugin de tu Salesforce CLI:
```bash
sf plugins unlink sf-metadelta
```

### Licencia

Este proyecto se publica bajo la [licencia ISC](LICENSE).

