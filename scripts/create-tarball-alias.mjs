import {copyFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';

const version = process.env.npm_package_version;
if (!version) {
  throw new Error('npm_package_version is not defined');
}

const baseName = `nervill-metadelta-${version}.tgz`;
const src = join('dist', baseName);
const dest = join('dist', `metadelta-${version}.tgz`);

if (!existsSync(src)) {
  throw new Error(`Tarball not found at ${src}. Run npm pack before creating alias.`);
}

if (!existsSync(dest)) {
  copyFileSync(src, dest);
  console.log(`Created alias ${dest}`);
} else {
  console.log(`Alias ${dest} already exists`);
}
