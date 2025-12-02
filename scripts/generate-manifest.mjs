import {Config} from '@oclif/core';
import {writeFileSync} from 'node:fs';

const run = async () => {
  const config = await Config.load({root: process.cwd(), devPlugins: [], userPlugins: []});
  const plugin = config.plugins.values().next().value;
  if (!plugin) {
    throw new Error('plugin not found');
  }
  const manifest = await plugin._manifest();
  writeFileSync('oclif.manifest.json', JSON.stringify(manifest, null, 2));
};

run();
