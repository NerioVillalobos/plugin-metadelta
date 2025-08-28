# Metadelta Salesforce CLI Plugin

Metadelta is a custom Salesforce CLI plugin that inspects a target org and reports metadata components modified by a specific user within a recent time window. It optionally generates manifest files for deployment or Vlocity datapack migration.

Created by **Nerio Villalobos** (<nervill@gmail.com>).

## Installation

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

## Usage

Run the command from any directory after linking:

```bash
sf metadelta find --org <alias_or_username> [flags]
```

The plugin compares metadata changes for the specified user and prints a table of modified components. When requested, it also produces manifest files under the `manifest/` directory.

### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--org`, `-o` | **Required.** Alias or username of the target org. | N/A |
| `--metafile` | Path to a JavaScript file exporting a `metadataTypes` array to override the default metadata types. | Uses built‑in list |
| `--days` | Number of days in the past to inspect for modifications. | `3` |
| `--namespace` | Vlocity namespace to query datapacks (enables Vlocity datapack checks). | None |
| `--xml` | When set, generates `manifest/package-<org>.xml` containing found metadata. | `false` |
| `--yaml` | When set, generates `manifest/package-vlocity-<org>.yaml` with Vlocity datapack entries. | `false` |
| `--audit` | Full name of the user to audit. If omitted, the command uses the org user associated with the provided alias. | Authenticated user |

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

## Output

The command prints each matching component with its type, full name, last modified date, and modifier. When `--xml` or `--yaml` are set, the corresponding manifest files are created inside the `manifest/` directory.

## Uninstalling

To unlink the plugin from your Salesforce CLI:
```bash
sf plugins unlink sf-metadelta
```

## License

This project is released under the [ISC License](LICENSE).

