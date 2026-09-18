import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const distDir = path.resolve('dist');
fs.mkdirSync(distDir, {recursive: true});

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const output = execFileSync(npmCommand, ['pack', '--pack-destination', distDir], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

const tarball = output.trim().split(/\r?\n/).filter(Boolean).at(-1);
if (!tarball) {
  throw new Error('npm pack no devolvió el nombre del tarball.');
}

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const source = path.join(distDir, tarball);
const alias = path.join(distDir, `metadelta-${packageJson.version}.tgz`);
fs.copyFileSync(source, alias);
console.log(alias);
