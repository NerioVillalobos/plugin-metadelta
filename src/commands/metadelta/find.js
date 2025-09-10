import {Command, Flags} from '@oclif/core';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

export default class Find extends Command {
  static description = 'Busca metadatos modificados recientemente en una organización Salesforce.';

  static examples = [
    '<%= config.bin %> metadelta find --org alias',
  ];

  static flags = {
    metafile: Flags.string({description: 'ruta a un archivo que exporta metadataTypes'}),
    days: Flags.integer({description: 'días hacia atrás para revisar', default: 3}),
    namespace: Flags.string({description: 'namespace de Vlocity'}),
    xml: Flags.boolean({description: 'genera manifest package.xml'}),
    yaml: Flags.boolean({description: 'genera manifest package.yaml para Vlocity'}),
    audit: Flags.string({description: 'nombre completo del usuario a auditar'}),
  };

  static args = [{name: 'org', required: true, description: 'alias o username de la org'}];

  async run() {
    const {args, flags} = await this.parse(Find);
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sf-find-changes.cjs');
    const params = [args.org];
    if (flags.metafile) params.push('--metafile', flags.metafile);
    if (flags.days) params.push('--days', String(flags.days));
    if (flags.namespace) params.push('--namespace', flags.namespace);
    if (flags.xml) params.push('--xml');
    if (flags.yaml) params.push('--yaml');
    if (flags.audit) params.push('--audit', flags.audit);

    await new Promise((resolve, reject) => {
      const child = spawn('node', [script, ...params], {stdio: 'inherit'});
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`Proceso finalizó con código ${code}`)));
    });
  }
}
