import {existsSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const ensureNodeModules = () => {
  const nodeModulesPath = resolve(process.cwd(), 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    throw new Error('node_modules not found. Run npm ci before generating the oclif manifest.');
  }
};

const main = async () => {
  ensureNodeModules();
  const {Config} = await import('@oclif/core');
  const config = await Config.load({root: process.cwd(), devPlugins: [], userPlugins: []});
  const plugin = config.plugins.values().next().value;
  if (!plugin) {
    throw new Error('Plugin not found while generating manifest. Ensure build output exists in lib/.');
  }
  const manifest = await plugin._manifest();
  writeFileSync('oclif.manifest.json', JSON.stringify(manifest, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
