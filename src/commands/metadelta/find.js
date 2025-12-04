/*
Desarrollado por: Nerio Villalobos
Fecha : 8/04/2025 
*/


import {Command, Flags} from '@oclif/core';
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fetchOrgApiVersion} from './orgApiVersion.js';

class Find extends Command {
  static id = 'metadelta:find';
  static summary = 'Find metadata changes made by a user in a Salesforce org';
  static description = 'Find metadata changes made by a user in a Salesforce org';

  static flags = {
    org: Flags.string({char: 'o', summary: 'Alias or username of the target org', required: true}),
    metafile: Flags.string({summary: 'Path to a JSON file listing the metadata types to inspect'}),
    days: Flags.integer({summary: 'Number of days to check for changes', default: 3}),
    namespace: Flags.string({summary: 'Vlocity namespace for datapacks'}),
    xml: Flags.boolean({summary: 'Generate a package.xml with the found components'}),
    yaml: Flags.boolean({summary: 'Generate a Vlocity package.yaml with the found components'}),
    audit: Flags.string({summary: 'Full name of the user to audit'})
  };

  async run() {
    const {flags} = await this.parse(Find);
    const targetOrg = flags.org;
    let daysToCheck = flags.days;
    const vlocityNamespace = flags.namespace;
    const generatePackageXML = flags.xml;
    const generatePackageYAML = flags.yaml;
    let auditUser = flags.audit;

    let detectedApiVersion = null;
    if (generatePackageXML) {
      const {apiVersion, error: apiVersionError} = fetchOrgApiVersion(targetOrg);
      if (apiVersionError) {
        this.warn(`No se pudo obtener la versión de API de la org ${targetOrg ?? ''}: ${apiVersionError}`);
      } else {
        detectedApiVersion = apiVersion;
      }
    }

    const obtenerUsername = () => {
      const result = spawnSync(`sf org display --target-org ${targetOrg} --json`, {
        shell: true,
        encoding: 'utf8',
        stdio: ['ignore','pipe','ignore']
      });
      try {
        const parsed = JSON.parse(result.stdout);
        return parsed.result.username;
      } catch {
        this.error('No se pudo obtener el Username del alias proporcionado.');
      }
    };

    const obtenerNombreCompleto = (username) => {
      const soql = `SELECT Name FROM User WHERE Username = '${username}'`;
      const result = spawnSync(`sf data query --query "${soql}" --json --target-org ${targetOrg}`, {
        shell: true,
        encoding: 'utf8',
        stdio: ['ignore','pipe','ignore']
      });
      try {
        const parsed = JSON.parse(result.stdout);
        if (parsed.result.records.length > 0) {
          return parsed.result.records[0].Name;
        } else {
          this.error(`No se encontró un usuario con el Username: ${username}`);
        }
      } catch {
        this.error('No se pudo obtener el nombre completo del usuario.');
      }
    };

    const username = obtenerUsername();
    const defaultTargetUser = obtenerNombreCompleto(username);
    const userToAudit = auditUser || defaultTargetUser;

    const getFormattedDate = (daysAgo = 0) => {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      return date.toISOString().slice(0, 10);
    };

    const fechasValidas = Array.from({length: daysToCheck}, (_,i)=>getFormattedDate(i));

    const fallbackMetadataTypes = [
      'ApexClass','ApexPage','AuraDefinitionBundle','Bot','BotVersion',
      'CompactLayout','ContentAsset','CustomApplication','CustomField',
      'CustomMetadata','CustomNotificationType','CustomObject','CustomObjectTranslation',
      'CustomPermission','CustomSite','CustomTab','Dashboard','DigitalExperience',
      'DigitalExperienceBundle','ExperienceBundle','ExternalCredential','FieldSet',
      'FlexiPage','Flow','GenAiFunction','GenAiPlanner','GenAiPlugin',
      'GlobalValueSet','Layout','LightningComponentBundle','NamedCredential',
      'NavigationMenu','Network','NetworkBranding','OmniSupervisorConfig',
      'PermissionSet','PresenceUserConfig','Profile','Queue','QueueRoutingConfig',
      'QuickAction','RecordType','RemoteSiteSetting','Report','ReportType',
      'ServiceChannel','ServicePresenceStatus','Skill','StandardValueSet',
      'StandardValueSetTranslation','StaticResource','ValidationRule','WebLink',
      'WorkSkillRouting','PermissionSetGroup'
    ];

    const obtenerMetadataDeOrg = () => {
      const result = spawnSync(`sf force:mdapi:describemetadata --target-org ${targetOrg} --json`, {
        shell: true,
        encoding: 'utf8',
        stdio: ['ignore','pipe','ignore']
      });
      try {
        const parsed = JSON.parse(result.stdout);
        if (parsed.status === 0 && Array.isArray(parsed.result?.metadataObjects)) {
          return parsed.result.metadataObjects.map(obj => obj.xmlName);
        }
        this.warn('No se pudo obtener la lista de metadatos de la org, usando lista por defecto.');
        return fallbackMetadataTypes;
      } catch {
        this.warn('No se pudo obtener la lista de metadatos de la org, usando lista por defecto.');
        return fallbackMetadataTypes;
      }
    };

    let metadataTypesToUse = obtenerMetadataDeOrg();
    if (flags.metafile) {
      const filePath = path.resolve(flags.metafile);
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (parseError) {
            const hints = [];
            if (path.extname(filePath).toLowerCase() !== '.json') {
              hints.push('usa la extensión .json');
            }
            if (/module\.exports\s*=/.test(raw)) {
              hints.push('elimina la instrucción "module.exports =" y deja solo el JSON');
            }
            const hintText = hints.length ? ` Consejo: ${hints.join(' y ')}.` : '';
            throw new Error(`${parseError.message}.${hintText}`);
          }
          const candidate = Array.isArray(parsed) ? parsed : parsed?.metadataTypes;
          if (Array.isArray(candidate)) {
            metadataTypesToUse = candidate;
          } else {
            this.warn('Archivo de metadatos inválido, usando lista por defecto.');
          }
        } catch (e) {
          this.warn(`Error al cargar archivo de metadatos, usando lista por defecto. (${e.message})`);
        }
      } else {
        this.warn('Archivo de metadatos no encontrado, usando lista por defecto.');
      }
    }

    const displayStatus = (text) => {
      const clearLine = '\r' + ' '.repeat(process.stdout.columns) + '\r';
      process.stdout.write(clearLine);
      process.stdout.write(`→ Verificando ${text}...\r`);
    };

    const revisarMetadata = (metadataType) => {
      return new Promise((resolve) => {
        displayStatus(metadataType);
        const cmd = `sf org list metadata --metadata-type ${metadataType} --target-org ${targetOrg} --json`;
        const child = spawn(cmd, {shell:true});
        let data='';
        child.stdout.on('data', chunk=> data += chunk.toString());
        child.on('close', () => {
          try {
            const json = JSON.parse(data);
            const soporta = json.status === 0 && Array.isArray(json.result) &&
              json.result[0] && json.result[0].lastModifiedByName !== undefined && json.result[0].lastModifiedDate !== undefined;
            let filtrados = [];
            if (soporta) {
              filtrados = json.result.filter(item=>{
                const modDate = item.lastModifiedDate?.slice(0,10);
                return item.lastModifiedByName === userToAudit && fechasValidas.includes(modDate);
              }).map(item => ({
                type: metadataType,
                fullName: item.fullName,
                lastModifiedDate: item.lastModifiedDate,
                lastModifiedByName: item.lastModifiedByName
              }));
              if (filtrados.length>0) {
                console.log(`🔎 Encontrado en ${metadataType}:`, filtrados.map(f=>f.fullName));
              }
            }
            resolve({type: metadataType, soporta, filtrados});
          } catch {
            resolve({type: metadataType, soporta:false, filtrados:[]});
          }
        });
      });
    };

    const datapackQueries = {
      'AttributeAssignmentRule': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__AttributeAssignmentRule__c",
      'AttributeCategory': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__AttributeCategory__c",
      'Catalog': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__Catalog__c",
      'ContextAction': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ContextAction__c",
      'ContextDimension': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ContextDimension__c",
      'ContextScope': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ContextScope__c",
      'ContractType': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ContractType__c",
      'DocumentClause': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__DocumentClause__c",
      'DocumentTemplate': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__DocumentTemplate__c",
      'EntityFilter': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__EntityFilter__c",
      'InterfaceImplementation': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__InterfaceImplementation__c",
      'OmniScript': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OmniScript__c WHERE %vlocity_namespace%__IsProcedure__c = false",
      'IntegrationProcedure': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OmniScript__c WHERE %vlocity_namespace%__IsProcedure__c = true",
      'DataRaptor': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__DRBundle__c",
      'CalculationMatrix': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__CalculationMatrix__c",
      'CalculationProcedure': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__CalculationProcedure__c",
      'Attachment': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM Attachment",
      'Document': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM Document",
      'IntegrationRetryPolicy': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__IntegrationRetryPolicy__c",
      'ManualQueue': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ManualQueue__c",
      'ObjectClass': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ObjectClass__c",
      'ObjectContextRule': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ObjectRuleAssignment__c",
      'ObjectLayout': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__ObjectLayout__c",
      'OfferMigrationPlan': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OfferMigrationPlan__c",
      'OrchestrationDependencyDefinition': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OrchestrationDependencyDefinition__c",
      'OrchestrationItemDefinition': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OrchestrationItemDefinition__c",
      'OrchestrationPlanDefinition': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__OrchestrationPlanDefinition__c",
      'Pricebook2': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM Pricebook2",
      'PriceList': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__PriceList__c",
      'PricingPlan': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__PricingPlan__c",
      'PricingVariable': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__PricingVariable__c",
      'Product2': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM Product2",
      'Promotion': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__Promotion__c",
      'QueryBuilder': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__QueryBuilder__c",
      'Rule': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__Rule__c",
      'String': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__String__c",
      'System': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__System__c",
      'TimePlan': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__TimePlan__c",
      'TimePolicy': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__TimePolicy__c",
      'UIFacet': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__UIFacet__c",
      'UISection': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__UISection__c",
      'VlocityAction': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocityAction__c",
      'VlocityAttachment': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocityAttachment__c",
      'VlocityCard': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocityCard__c",
      'VlocityFunction': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__VlocityFunction__c",
      'VlocityPicklist': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__Picklist__c"
    };

    const consultarDatapack = (nombre, query) => {
      return new Promise((resolve) => {
        const baseQuery = query.replace(/%vlocity_namespace%/g, vlocityNamespace || 'vlocity');
        const tieneWhere = /\bwhere\b/i.test(baseQuery);
        const filtro = `LastModifiedBy.Name = '${userToAudit}' AND LastModifiedDate >= LAST_N_DAYS:${daysToCheck}`;
        const finalQuery = tieneWhere ? `${baseQuery} AND ${filtro}` : `${baseQuery} WHERE ${filtro}`;
        displayStatus(nombre);
        const cmd = `sf data query --query \"${finalQuery}\" --target-org ${targetOrg} --json`;
        const child = spawn(cmd, {shell:true});
        let data='';
        child.stdout.on('data', chunk => data += chunk.toString());
        child.on('close', () => {
          try {
            const json = JSON.parse(data);
            const registros = json.result.records.map(rec => ({
              type: nombre,
              fullName: rec.Name,
              lastModifiedDate: rec.LastModifiedDate,
              lastModifiedByName: rec['LastModifiedBy']['Name']
            }));
            if (registros.length>0) {
              console.log(`🔎 Encontrado en ${nombre}:`, registros.map(f=>f.fullName));
            }
            resolve(registros);
          } catch {
            resolve([]);
          }
        });
      });
    };

    async function ejecutarConcurrentemente(tareas, maxParalelo = 5) {
      const resultados = [];
      let indice = 0;
      async function trabajador() {
        while (indice < tareas.length) {
          const actual = tareas[indice++];
          const res = await actual();
          resultados.push(res);
        }
      }
      const workers = Array.from({length: Math.min(maxParalelo, tareas.length)}, () => trabajador());
      await Promise.all(workers);
      return resultados;
    }

    const obtenerRamaGit = () => {
      try {
        const result = spawnSync('git rev-parse --abbrev-ref HEAD', {
          shell: true,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        });
        if (result.status === 0) {
          const branch = result.stdout.trim();
          if (branch && branch !== 'HEAD') {
            return branch;
          }
        }
      } catch {
        /* ignore errors */
      }
      return null;
    };

    const sanitizarSegmentoArchivo = (valor) => {
      const texto = String(valor ?? '').trim();
      const reemplazado = texto.replace(/[\\/:*?"<>|\s]+/g, '-');
      return reemplazado.length > 0 ? reemplazado : 'output';
    };

    const construirRutaManifest = (prefijo, extension) => {
      const manifestDir = 'manifest';
      if (!fs.existsSync(manifestDir)) {
        fs.mkdirSync(manifestDir, {recursive: true});
      }
      const identificadorBase = sanitizarSegmentoArchivo(obtenerRamaGit() || targetOrg);
      let contador = 0;
      let ruta;
      do {
        const sufijoVersion = contador === 0 ? '' : `-v${contador}`;
        ruta = path.join(manifestDir, `${prefijo}-${identificadorBase}${sufijoVersion}.${extension}`);
        contador += 1;
      } while (fs.existsSync(ruta));
      return ruta;
    };

    const generarPackageXML = (allComponents, apiVersion) => {
      if (allComponents.length > 0) {
        const filename = construirRutaManifest('package', 'xml');
        const groupedByType = allComponents.reduce((acc, comp)=>{
          acc[comp.type] = acc[comp.type] || new Set();
          acc[comp.type].add(comp.fullName);
          return acc;
        },{});
        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
        for (const [type, members] of Object.entries(groupedByType)) {
          xml += `    <types>\n`;
          Array.from(members).sort().forEach(member => {
            xml += `        <members>${member}</members>\n`;
          });
          xml += `        <name>${type}</name>\n`;
          xml += `    </types>\n`;
        }
        const versionString = (() => {
          if (!apiVersion) {
            return '63.0';
          }
          const trimmed = String(apiVersion).trim();
          if (!trimmed) {
            return '63.0';
          }
          if (/^\d+$/.test(trimmed)) {
            return `${trimmed}.0`;
          }
          return trimmed;
        })();
        xml += `    <version>${versionString}</version>\n</Package>\n`;
        fs.writeFileSync(filename, xml);
        console.log(`\nArchivo "${filename}" generado con éxito en el directorio "manifest".`);
      } else {
        console.log('\nNo hay componentes para generar el archivo "package.xml".');
      }
    };

    const generarPackageYAML = (vlocityComponents) => {
      if (vlocityComponents.length > 0) {
        const filename = construirRutaManifest('package-vlocity', 'yaml');
        const yaml = [
          'projectPath: ./Vlocity',
          'continueAfterError: true',
          'compileOnBuild: false',
          'maxDepth: 1',
          'autoUpdateSettings: true',
          '',
          'manifest:',
          ...vlocityComponents.map(c => `- ${c.type}/${c.fullName}`),
          '',
          'OverrideSettings:',
          '    DataPacks:',
          '        Catalog:',
          '        Product2:',
          '            MaxDeploy: 1',
        ].join('\n');
        fs.writeFileSync(filename, yaml);
        console.log(`\nArchivo "${filename}" generado con éxito en el directorio "manifest".`);
      } else {
        console.log('\nNo hay componentes de Vlocity para generar el archivo "package.yaml".');
      }
    };

    const startTime = Date.now();
    this.log(`\n🔍 Verificando modificaciones de "${userToAudit}" en ${metadataTypesToUse.length} tipos de metadatos de "${targetOrg}" (últimos ${daysToCheck} días)...\n`);

    const tareasCore = metadataTypesToUse.map(tipo => () => revisarMetadata(tipo));
    const revisiones = await ejecutarConcurrentemente(tareasCore, 5);
    const soportados = revisiones.filter(r => r.soporta);
    metadataTypesToUse = soportados.map(r => r.type);
    const resultadosCore = soportados.flatMap(r => r.filtrados);

    let resultadosVlocity = [];
    if (vlocityNamespace) {
      this.log(`\n📦 Verificando componentes Vlocity usando namespace "${vlocityNamespace}"...\n`);
      const tareasVlocity = Object.entries(datapackQueries).map(([nombre, query]) => () => consultarDatapack(nombre, query));
      resultadosVlocity = (await ejecutarConcurrentemente(tareasVlocity, 5)).flat();
    }
    const resultadosTotales = [...resultadosCore, ...resultadosVlocity];
    process.stdout.write('\n');
    if (resultadosTotales.length === 0) {
      this.log(`❌ No se encontraron modificaciones recientes por "${userToAudit}".`);
    } else {
      this.log(`\n✅ Elementos modificados recientemente por "${userToAudit}":\n`);
      this.log('Metadata'.padEnd(20) + 'FullName'.padEnd(45) + 'LastModify'.padEnd(35) + 'LastModifyby');
      resultadosTotales.forEach(item => {
        this.log(
          item.type.padEnd(20) +
          `'${item.fullName}'`.padEnd(45) +
          `'${item.lastModifiedDate}'`.padEnd(35) +
          `'${item.lastModifiedByName}'`
        );
      });
      if (generatePackageXML) {
        generarPackageXML(
          resultadosTotales.filter(item => !Object.keys(datapackQueries).includes(item.type)),
          detectedApiVersion
        );
      }
      if (generatePackageYAML && resultadosVlocity.length > 0) {
        generarPackageYAML(resultadosVlocity);
      }
    }

    const endTime = Date.now();
    const minutes = Math.floor((endTime - startTime) / 60000);
    const seconds = Math.floor(((endTime - startTime) % 60000) / 1000);
    this.log(`\n🕒 Tiempo total de ejecución: ${minutes}m ${seconds}s\n`);
  }
}

export default Find;
