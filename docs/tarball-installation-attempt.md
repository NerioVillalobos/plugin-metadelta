# Tarball installation attempt (local CLI)

This document records a local installation attempt following the requested steps:

1. `npm init -y` in a clean directory.
2. `npm install @salesforce/cli`
3. `npm install https://github.com/NerioVillalobos/plugin-metadelta/releases/download/v1.0.16/metadelta-1.0.16.tgz`
4. Inspect `node_modules/@salesforce/cli/node_modules` and run `./node_modules/.bin/sf plugins`.

## Result

The process failed at step 2. The npm registry blocked access to `@salesforce/cli` with HTTP 403 responses, even when explicitly setting the registry to `https://registry.npmjs.org`. Because the CLI could not be installed locally, the plugin tarball could not be installed or inspected in that environment. The commands and errors were:

- `npm install @salesforce/cli` → `403 Forbidden - GET https://registry.npmjs.org/@salesforce%2fcli`
- `npm install @salesforce/cli --registry=https://registry.npmjs.org` → same 403 error

Once registry access is available, rerun the steps above using `./node_modules/.bin/sf` to verify the tarball appears in `sf plugins` and under `node_modules/@salesforce/cli/node_modules`.
