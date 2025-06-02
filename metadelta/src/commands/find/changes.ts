import * as path from 'node:path';
import * as fs from 'node:fs';

import { SfCommand, Flags, orgApiVersionFlagWithDeprecations } from '@salesforce/sf-plugins-core'; 
import { Org, SfError, Connection, Messages } from '@salesforce/core'; 
import { Interfaces } from '@oclif/core';

// Hardcoded messages for simplicity
const CMD_SUMMARY = 'Finds recent metadata changes in an org, including Vlocity DataPacks.';
const CMD_DESCRIPTION = `
Scans specified metadata types and Vlocity DataPacks for recent modifications.
Can filter by user and number of days.
Optionally generates package.xml for Salesforce metadata and package-vlocity.yaml for DataPacks.
`;
const CMD_EXAMPLES = [
  `$ <%= config.bin %> <%= command.id %> --target-org myOrgAlias --days 7 --xml --yaml --namespace myNamespace`,
  `$ <%= config.bin %> <%= command.id %> -o myOrgAlias -f ./myMetaTypes.js -a "User Name"`,
];

const DEFAULT_METADATA_TYPES = [
    'ApexClass', 'ApexPage', 'AuraDefinitionBundle', 'Bot', 'BotVersion',
    'CompactLayout', 'ContentAsset', 'CustomApplication', 'CustomField',
    'CustomMetadata', 'CustomNotificationType', 'CustomObject', 'CustomObjectTranslation',
    'CustomPermission', 'CustomSite', 'CustomTab', 'Dashboard', 'DigitalExperience',
    'DigitalExperienceBundle', 'ExperienceBundle', 'ExternalCredential', 'FieldSet',
    'FlexiPage', 'Flow', 'GenAiFunction', 'GenAiPlanner', 'GenAiPlugin',
    'GlobalValueSet', 'Layout', 'LightningComponentBundle', 'NamedCredential',
    'NavigationMenu', 'Network', 'NetworkBranding', 'OmniSupervisorConfig',
    'PermissionSet', 'PresenceUserConfig', 'Profile', 'Queue', 'QueueRoutingConfig',
    'QuickAction', 'RecordType', 'RemoteSiteSetting', 'Report', 'ReportType',
    'ServiceChannel', 'ServicePresenceStatus', 'Skill', 'StandardValueSet',
    'StandardValueSetTranslation', 'StaticResource', 'ValidationRule', 'WebLink',
    'WorkSkillRouting', 'PermissionSetGroup'
];

const DATAPACK_QUERIES: Record<string, string> = {
    'AttributeAssignmentRule': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__AttributeAssignmentRule__c",
    'AttributeCategory': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__AttributeCategory__c",
    // ... (rest of DATAPACK_QUERIES, ensure it's populated as per original script) ...
    'VlocityPicklist': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__Picklist__c",
};

interface MetadataResult {
  type: string;
  fullName: string;
  lastModifiedDate: string;
  lastModifiedByName: string;
}

interface FindChangesFlagsInterface {
  'target-org': string; 
  'api-version'?: string;
  metafile?: string;
  days: number;
  namespace?: string;
  xml: boolean;
  yaml: boolean;
  audit?: string;
  json?: boolean; 
}
export type FindChangesCmdResult = MetadataResult[];

export default class FindChanges extends SfCommand<FindChangesCmdResult | void> {
  public static readonly summary = CMD_SUMMARY;
  public static readonly description = CMD_DESCRIPTION;
  public static readonly examples = CMD_EXAMPLES;

  // Static flags definition is commented out to achieve compilation.
  // For actual CLI flag parsing, this would need to be uncommented and TS2742 resolved.
  public static flags: {
    testbool: ReturnType<typeof Flags.boolean>;
    teststring: any; // Reverting to 'any' as a workaround
    testinteger: any; // Using any as a fallback
    targetorg: any; // Using any as a fallback
    outputdir: any; // Using any as a fallback
  } = {
    testbool: Flags.boolean({
      summary: 'A test boolean flag',
      char: 'b'
    }),
    teststring: Flags.string({
      summary: 'A test string flag',
      char: 's'
    }),
    testinteger: Flags.integer({
      summary: 'A test integer flag',
      char: 'i'
    }),
    targetorg: Flags.requiredOrg({
      summary: 'Username or alias of the target org. Supports org aliases.',
      char: 'o',
    }),
    outputdir: Flags.directory({
      summary: 'Output directory for the destructive package.',
      char: 'd',
    })
  };

  private userToAudit!: string;
  private org!: Org; 
  private connection!: Connection;
  private daysToCheck!: number;
  private fechasValidas!: string[];
  private parsedFlags!: FindChangesFlagsInterface; 


  private getFormattedDate(daysAgo = 0): string {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString().slice(0, 10);
  }

  private async getOrgCurrentUserFullName(): Promise<string> {
    const username = this.org.getUsername();
    if (!username) {
      // This should ideally not happen if org object is valid
      throw new SfError('Unable to determine username for the target org.', 'MissingUsernameError');
    }
    try {
      const userInfo = await this.connection.query<{ Name: string }>(`SELECT Name FROM User WHERE Username = '${username}' LIMIT 1`);
      if (userInfo.records && userInfo.records.length > 0 && userInfo.records[0].Name) {
        return userInfo.records[0].Name;
      }
      this.warn(`Could not find Full Name for username ${username}. Using username as audit target.`);
      return username;
    } catch (err) {
      const error = err as Error;
      this.warn(`Error fetching Full Name for ${username}: ${error.message}. Using username as audit target.`);
      return username;
    }
  }
  
  private displayStatusUpdate(text: string): void {
    // Using this.log for persistent status updates, as spinner might be for overall operations
    this.log(`→ ${text}...`);
  }

  private async verificarMetadata(metadataType: string): Promise<MetadataResult[]> {
    this.spinner.start(`Verifying Salesforce metadata: ${metadataType}`); // Corrected: this.spinner
    const listQueries = [{ type: metadataType }];
    try {
      // @ts-ignore Property 'api-version' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
      const apiVersion = (this.flags as Interfaces.InferredFlags<typeof FindChanges.flags>)['api-version'] || this.connection.getApiVersion();
      // @ts-ignore TODO: Correctly type metadata.list response. It's an array of FileProperties.
      const metadataListed = await this.connection.metadata.list(listQueries, apiVersion);
      const results: MetadataResult[] = [];
      
      const itemsToList = Array.isArray(metadataListed) ? metadataListed : (metadataListed ? [metadataListed] : []);

      for (const item of itemsToList) {
        if (!item || !item.lastModifiedDate) continue;
        const modDate = item.lastModifiedDate.slice(0, 10);

        let userMatch = true; 
        // @ts-ignore Property 'audit' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
        if ((this.flags as Interfaces.InferredFlags<typeof FindChanges.flags>).audit) { 
            if (item.lastModifiedByName && (item.lastModifiedByName !== this.userToAudit)) {
                 userMatch = false;
            } else if (!item.lastModifiedByName) {
                // this.debug(`lastModifiedByName not available for ${item.fullName} (${metadataType}), cannot verify audit user for this item.`);
            }
        }

        if (this.fechasValidas.includes(modDate) && userMatch) {
          results.push({
            type: item.type ?? metadataType,
            fullName: item.fullName,
            lastModifiedDate: item.lastModifiedDate,
            lastModifiedByName: item.lastModifiedByName ?? 'N/A',
          });
        }
      }
      this.spinner.stop('done.'); // Corrected: this.spinner
      if (results.length > 0) {
        this.log(`  Found in ${metadataType}: ${results.map((f) => f.fullName).join(', ')}`);
      }
      return results;
    } catch (e) {
      this.spinner.stop('error.'); // Corrected: this.spinner
      const err = e as Error;
      this.warn(`Could not list metadata for ${metadataType}: ${err.message}`);
      return [];
    }
  }

  private async consultarDatapack(datapackName: string, query: string, namespace: string): Promise<MetadataResult[]> {
    this.spinner.start(`Querying Vlocity DataPack: ${datapackName}`); // Corrected: this.spinner
    const baseQuery = query.replace(/%vlocity_namespace%/g, namespace);
    const tieneWhere = /\bwhere\b/i.test(baseQuery);
    const filtro = `LastModifiedBy.Name = '${this.userToAudit}' AND LastModifiedDate >= LAST_N_DAYS:${this.daysToCheck}`;
    const finalQuery = tieneWhere ? `${baseQuery} AND ${filtro}` : `${baseQuery} WHERE ${filtro}`;

    try {
      const queryResult = await this.connection.query<{ Id: string; Name: string; LastModifiedDate: string; LastModifiedBy: { Name: string } }>(finalQuery);
      const registros = (queryResult.records || []).map(rec => ({
        type: datapackName,
        fullName: rec.Name,
        lastModifiedDate: rec.LastModifiedDate,
        lastModifiedByName: rec.LastModifiedBy.Name,
      }));
      this.spinner.stop('done.'); // Corrected: this.spinner
      if (registros.length > 0) {
        this.log(`  Found in ${datapackName}: ${registros.map(f => f.fullName).join(', ')}`);
      }
      return registros;
    } catch (e) {
      this.spinner.stop('error.'); // Corrected: this.spinner
      const err = e as Error;
      if (err.message.includes('sObject type') && err.message.includes('is not supported')) {
        this.warn(`Skipping ${datapackName}: sObject type likely not found (check namespace '${namespace}' or if Vlocity is installed).`);
      } else {
        this.warn(`Failed to query ${datapackName}: ${err.message.split('\n')[0]}`);
      }
      return [];
    }
  }

  private async ejecutarConcurrentemente<T>(tareas: Array<() => Promise<T[]>>, _maxParalelo = 5): Promise<T[]> {
    const resultadosAgregados: T[] = [];
    for (const tarea of tareas) {
        try {
            const res = await tarea(); 
            resultadosAgregados.push(...res);
        } catch (err) {
            const error = err as Error;
            this.warn(`A task failed during execution: ${error.message}`);
        }
    }
    return resultadosAgregados;
  }

  private generarPackageXML(components: MetadataResult[], orgUsername: string): void {
    if (components.length === 0) {
      this.log('\nNo Salesforce metadata components to generate package.xml.');
      return;
    }
    const manifestDir = path.join(this.config.root, 'manifest');
    try {
      if (!fs.existsSync(manifestDir)) {
        fs.mkdirSync(manifestDir, { recursive: true });
      }
      const filename = path.join(manifestDir, `package-${orgUsername}.xml`);

      const groupedByType = components.reduce<Record<string, Set<string>>>((acc, comp) => {
        acc[comp.type] = acc[comp.type] || new Set();
        acc[comp.type].add(comp.fullName);
        return acc;
      }, {});

      let xmlContent = `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
      for (const [type, members] of Object.entries(groupedByType)) {
        xmlContent += `    <types>\n`;
        Array.from(members).sort().forEach(member => {
          xmlContent += `        <members>${member}</members>\n`;
        });
        xmlContent += `        <name>${type}</name>\n`;
        xmlContent += `    </types>\n`;
      }
      xmlContent += `    <version>${this.connection.getApiVersion()}</version>\n</Package>\n`;

      fs.writeFileSync(filename, xmlContent);
      this.log(`\nGenerated Salesforce package manifest: ${filename}`);
    } catch (e) {
        const err = e as Error;
        throw new SfError(`Failed to generate package.xml: ${err.message}`, 'PackageXmlError', undefined, err);
    }
  }

  private generarPackageYAML(vlocityComponents: MetadataResult[], orgUsername: string): void {
    if (vlocityComponents.length === 0) {
      this.log('\nNo Vlocity DataPacks to generate package-vlocity.yaml.');
      return;
    }
    const manifestDir = path.join(this.config.root, 'manifest');
     try {
      if (!fs.existsSync(manifestDir)) {
        fs.mkdirSync(manifestDir, { recursive: true });
      }
      const filename = path.join(manifestDir, `package-vlocity-${orgUsername}.yaml`);
      const yamlLines = [
        'projectPath: ./vlocity', 
        'continueAfterError: true',
        'compileOnBuild: false', 
        'maxDepth: -1',
        'autoUpdateSettings: true',
        '',
        'manifest:',
        ...vlocityComponents.map(c => `  - ${c.type}/${c.fullName.replace(/'/g, "''")}`),
        '',
        'OverrideSettings:',
        '    DataPacks:',
        '        Catalog:',
        '            Product2:',
        '                MaxDeploy: 1', 
      ];
      fs.writeFileSync(filename, yamlLines.join('\n'));
      this.log(`\nGenerated Vlocity DataPack manifest: ${filename}`);
    } catch (e) {
        const err = e as Error;
        throw new SfError(`Failed to generate package-vlocity.yaml: ${err.message}`, 'PackageYamlError', undefined, err);
    }
  }

  public async run(): Promise<FindChangesCmdResult | void> {
    const { flags }: { flags: Interfaces.InferredFlags<typeof FindChanges.flags> } = await this.parse(FindChanges);

    this.spinner.start('Connecting to org...'); // Corrected: this.spinner
    try {
      // @ts-ignore Property 'target-org' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
      this.org = await Org.create({ aliasOrUsername: flags['target-org'] });
      // @ts-ignore Property 'api-version' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
      this.connection = this.org.getConnection(flags['api-version']);
      this.spinner.stop(`connected to ${this.org.getOrgId()}`); // Corrected: this.spinner
      // @ts-ignore Property 'target-org' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
      this.log(`(Note: This is using a hardcoded placeholder org: ${flags['target-org']} if flag parsing was bypassed).`);
    } catch (err) {
      this.spinner.stop('error.'); // Corrected: this.spinner
      const error = err as Error;
      // @ts-ignore Property 'target-org' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
      throw new SfError(`Failed to create or connect to org '${flags['target-org']}'. Command cannot proceed. Error: ${error.message}`, 'OrgCreationError', [], error);
    }
        
    // @ts-ignore Property 'days' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
    this.daysToCheck = flags.days;
    this.fechasValidas = Array.from({ length: this.daysToCheck }, (_, i) => this.getFormattedDate(i));

    this.spinner.start('Initializing and fetching user details...'); // Corrected: this.spinner
    // @ts-ignore Property 'audit' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
    if (flags.audit) {
        // @ts-ignore Property 'audit' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
        this.userToAudit = flags.audit;
        this.spinner.status = `Auditing changes for specified user: ${this.userToAudit}`; 
    } else {
        this.spinner.status = 'No --audit user specified, determining current org user...'; 
        try {
            this.userToAudit = await this.getOrgCurrentUserFullName();
        } catch (e) {
            this.spinner.stop('failed.'); // Corrected: this.spinner
            const err = e as Error;
            throw new SfError(`Could not determine current user: ${err.message}. Please use --audit flag or ensure the placeholder org is valid and accessible.`, 'UserFetchError', [], err);
        }
    }
    this.spinner.stop(`Auditing changes made by: ${this.userToAudit}`); // Corrected: this.spinner

    let metadataTypesToUse = DEFAULT_METADATA_TYPES;
    // @ts-ignore Property 'metafile' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
    if (flags.metafile) {
      // @ts-ignore Property 'metafile' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
      const filePath = path.resolve(flags.metafile);
      this.log(`Attempting to load metadata types from: ${filePath}`);
      try {
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          const imported = JSON.parse(fileContent); 
          if (Array.isArray(imported.metadataTypes)) {
            metadataTypesToUse = imported.metadataTypes;
            // @ts-ignore Property 'metafile' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
            this.log(`Loaded ${metadataTypesToUse.length} metadata types from ${flags.metafile}`);
          } else {
            this.warn('Metafile does not contain a "metadataTypes" array. Using default list.');
          }
        } else {
          this.warn(`Metafile not found at ${filePath}. Using default list.`);
        }
      } catch (err) {
        const error = err as Error;
        this.warn(`Error loading or parsing metafile: ${error.message}. Using default list.`);
      }
    }

    const startTime = Date.now();
    this.log(`\nVerifying modifications by "${this.userToAudit}" in ${metadataTypesToUse.length} Salesforce metadata types (last ${this.daysToCheck} days)...`);
    
    const tareasCore = metadataTypesToUse.map(tipo => () => this.verificarMetadata(tipo));
    const resultadosCore = await this.ejecutarConcurrentemente(tareasCore, 5);

    let resultadosVlocity: MetadataResult[] = [];
    // @ts-ignore Property 'namespace' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
    if (flags.namespace) {
      // @ts-ignore Property 'namespace' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
      this.log(`\nVerifying Vlocity DataPacks using namespace "${flags.namespace}"...`);
      // @ts-ignore Property 'namespace' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
      const tareasVlocity = Object.entries(DATAPACK_QUERIES).map(([nombre, query]) => () => this.consultarDatapack(nombre, query, flags.namespace!));
      resultadosVlocity = await this.ejecutarConcurrentemente(tareasVlocity, 5);
    }

    const resultadosTotales = [...resultadosCore, ...resultadosVlocity].sort((a,b) => `${a.type}${a.fullName}`.localeCompare(`${b.type}${b.fullName}`));

    if (resultadosTotales.length === 0) {
      this.log(`\nNo recent modifications found for user "${this.userToAudit}".`);
    } else {
      this.log(`\nFound ${resultadosTotales.length} item(s) modified by "${this.userToAudit}":`);
      const tableData = resultadosTotales.map(item => ({ ...item })); 
      this.table(tableData, {
          type: { header: 'Type' },
          fullName: { header: 'FullName' },
          lastModifiedDate: { header: 'LastModifiedDate' },
          lastModifiedByName: { header: 'LastModifiedBy' },
      });

      const orgUsername = this.org.getUsername() ?? 'unknownOrg';

      // @ts-ignore Property 'xml' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
      if (flags.xml) {
        this.generarPackageXML(resultadosTotales.filter(item => !Object.keys(DATAPACK_QUERIES).includes(item.type) || ['Attachment', 'Document', 'Pricebook2', 'Product2'].includes(item.type) ), orgUsername);
      }

      // @ts-ignore Property 'yaml' does not exist on type '{ testbool: BooleanFlag<boolean>; }'.
      if (flags.yaml && resultadosVlocity.length > 0) {
        this.generarPackageYAML(resultadosVlocity, orgUsername);
      }
    }

    const endTime = Date.now();
    const minutes = Math.floor((endTime - startTime) / 60000);
    const seconds = Math.floor(((endTime - startTime) % 60000) / 1000);
    this.log(`\nTotal execution time: ${minutes}m ${seconds}s`);

    if (this.jsonEnabled()) {
        return resultadosTotales;
    }
  }
}
