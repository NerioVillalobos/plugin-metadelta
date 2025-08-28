const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─────► PARÁMETROS
const args = process.argv.slice(2);
const targetOrg = args[0];
const metaFileIndex = args.indexOf('--metafile');
const daysFlagIndex = args.indexOf('--days');
const namespaceFlagIndex = args.indexOf('--namespace');
const xmlFlagIndex = args.indexOf('--xml');
const yamlFlagIndex = args.indexOf('--yaml');
const auditFlagIndex = args.indexOf('--audit');

let externalMetadataTypes = null;
let daysToCheck = 3; 
let vlocityNamespace = null;
const generatePackageXML = args.includes('--xml');
const generatePackageYAML = args.includes('--yaml');
let auditUser = null; 

if (!targetOrg) {
    console.error('\n❌ Uso: node checkmodify.cjs "AliasOrg" [--metafile ruta/al/archivo.js] [--days n] [--namespace ns] [--xml] [--yaml] [--audit "Nombre Usuario"]'); 
    process.exit(1);
}

// ─────► FLAG DE DÍAS
if (daysFlagIndex !== -1 && args[daysFlagIndex + 1]) {
    const parsedDays = parseInt(args[daysFlagIndex + 1], 10);
    if (!isNaN(parsedDays) && parsedDays > 0) {
        daysToCheck = parsedDays;
    } else {
        console.warn('⚠️ "--days" no es un número válido. Se usará el valor por defecto (3 días).\n');
    }
}

// ─────► FLAG DE NAMESPACE
if (namespaceFlagIndex !== -1 && args[namespaceFlagIndex + 1]) {
    vlocityNamespace = args[namespaceFlagIndex + 1];
}

// ─────► FLAG DE AUDIT (AÑADIDO ESTE BLOQUE)
if (auditFlagIndex !== -1 && args[auditFlagIndex + 1]) {
    auditUser = args[auditFlagIndex + 1];
} else if (auditFlagIndex !== -1 && !args[auditFlagIndex + 1]) {
    console.warn('⚠️ "--audit" requiere un nombre de usuario. Se usará el usuario que modificó por última vez la organización.\n');
}

// ─────► OBTENER USERNAME desde el ORG
const obtenerUsername = () => {
    const result = spawnSync(`sf org display --target-org ${targetOrg} --json`, {
        shell: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
    });

    try {
        const parsed = JSON.parse(result.stdout);
        return parsed.result.username;
    } catch {
        console.error('❌ No se pudo obtener el Username del alias proporcionado.');
        process.exit(1);
    }
};

// ─────► OBTENER NOMBRE COMPLETO del usuario a partir del Username
const obtenerNombreCompleto = (username) => {
    const soql = `SELECT Name FROM User WHERE Username = '${username}'`;
    const result = spawnSync(`sf data query --query "${soql}" --json --target-org ${targetOrg}`, {
        shell: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
    });

    try {
        const parsed = JSON.parse(result.stdout);
        if (parsed.result.records.length > 0) {
            return parsed.result.records[0].Name;
        } else {
            console.error(`❌ No se encontró un usuario con el Username: ${username}`);
            process.exit(1);
        }
    } catch (e) {
        console.error('❌ No se pudo obtener el nombre completo del usuario. Error:', e.message);
        process.exit(1);
    }
};

// ─────► Obtener usuario automáticamente (y determinar el usuario a auditar)
const username = obtenerUsername(); 
const defaultTargetUser = obtenerNombreCompleto(username); 
const userToAudit = auditUser || defaultTargetUser; 

// ─────► FECHAS DINÁMICAS
const getFormattedDate = (daysAgo = 0) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString().slice(0, 10);
};

const fechasValidas = Array.from({ length: daysToCheck }, (_, i) => getFormattedDate(i));

// ─────► WHITELIST default (si no hay archivo)
const defaultMetadataTypes = [
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

// ─────► INTENTAR CARGAR METAFILE
if (metaFileIndex !== -1 && args[metaFileIndex + 1]) {
    const filePath = path.resolve(args[metaFileIndex + 1]);
    if (fs.existsSync(filePath)) {
        try {
            const imported = require(filePath);
            if (Array.isArray(imported.metadataTypes)) {
                externalMetadataTypes = imported.metadataTypes;
            } else {
                console.warn('⚠️ El archivo no exporta un array llamado "metadataTypes". Usando lista por defecto.\n');
            }
        } catch (err) {
            console.warn('⚠️ Error al cargar archivo de metadatos. Usando lista por defecto.\n');
        }
    } else {
        console.warn('⚠️ Archivo de metadatos no encontrado. Usando lista por defecto.\n');
    }
}

const metadataTypesToUse = externalMetadataTypes || defaultMetadataTypes;

// ─────► Mostrar progreso
const displayStatus = (text) => {
    const clearLine = '\r' + ' '.repeat(process.stdout.columns) + '\r';
    process.stdout.write(clearLine);
    process.stdout.write(`→ Verificando ${text}...\r`);
};

// ─────► Verifica un tipo de metadato de Salesforce Core
const verificarMetadata = (metadataType) => {
    return new Promise((resolve) => {
        displayStatus(metadataType);

        const cmd = `sf org list metadata --metadata-type ${metadataType} --target-org ${targetOrg} --json`;
        const child = spawn(cmd, { shell: true });

        let data = '';
        child.stdout.on('data', chunk => data += chunk.toString());
        child.stderr.on('data', () => {});

        child.on('close', () => {
            try {
                const json = JSON.parse(data);
                if (json.status === 0 && Array.isArray(json.result)) {
                    const filtrados = json.result.filter(item => {
                        const modDate = item.lastModifiedDate?.slice(0, 10);
                        return item.lastModifiedByName === userToAudit && fechasValidas.includes(modDate); 
                    }).map(item => ({
                        type: metadataType,
                        fullName: item.fullName,
                        lastModifiedDate: item.lastModifiedDate,
                        lastModifiedByName: item.lastModifiedByName
                    }));

                    if (filtrados.length > 0) {
                        console.log(`🔎 Encontrado en ${metadataType}:`, filtrados.map(f => f.fullName));
                    }

                    resolve(filtrados);
                } else {
                    resolve([]);
                }
            } catch {
                resolve([]);
            }
        });
    });
};

// ─────► Verifica DataPacks/Vlocity con querys
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
    'VlocityPicklist': "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM %vlocity_namespace%__Picklist__c",
};

const consultarDatapack = (nombre, query) => {
    return new Promise((resolve) => {
        const baseQuery = query.replace(/%vlocity_namespace%/g, vlocityNamespace || 'vlocity');
        const tieneWhere = /\bwhere\b/i.test(baseQuery);
        const filtro = `LastModifiedBy.Name = '${userToAudit}' AND LastModifiedDate >= LAST_N_DAYS:${daysToCheck}`; 
        const finalQuery = tieneWhere ? `${baseQuery} AND ${filtro}` : `${baseQuery} WHERE ${filtro}`;

        displayStatus(nombre);

        const cmd = `sf data query --query \"${finalQuery}\" --target-org ${targetOrg} --json`;
        const child = spawn(cmd, { shell: true });

        let data = '';
        child.stdout.on('data', chunk => data += chunk.toString());
        child.stderr.on('data', () => {});

        child.on('close', () => {
            try {
                const json = JSON.parse(data);
                const registros = json.result.records.map(rec => ({
                    type: nombre,
                    fullName: rec.Name,
                    lastModifiedDate: rec.LastModifiedDate,
                    lastModifiedByName: rec['LastModifiedBy']['Name']
                }));

                if (registros.length > 0) {
                    console.log(`🔎 Encontrado en ${nombre}:`, registros.map(f => f.fullName));
                }

                resolve(registros);
            } catch {
                resolve([]);
            }
        });
    });
};

// ─────► Ejecutar concurrentemente
async function ejecutarConcurrentemente(tareas, maxParalelo = 10) {
    const resultados = [];
    const ejecutando = [];

    for (const tarea of tareas) {
        const promesa = tarea().then(res => resultados.push(...res));
        ejecutando.push(promesa);

        if (ejecutando.length >= maxParalelo) {
            await Promise.race(ejecutando);
        }
    }

    await Promise.all(ejecutando);
    return resultados;
}

// ─────► GENERAR ARCHIVO package.xml
const generarPackageXML = (allComponents) => {
  if (allComponents.length > 0) {
      const manifestDir = 'manifest';
      const filename = path.join(manifestDir, `package-${targetOrg}.xml`);

      // Crear el directorio manifest si no existe
      if (!fs.existsSync(manifestDir)) {
          fs.mkdirSync(manifestDir, { recursive: true });
      }

      const groupedByType = allComponents.reduce((acc, comp) => {
          acc[comp.type] = acc[comp.type] || new Set();
          acc[comp.type].add(comp.fullName);
          return acc;
      }, {});

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
      for (const [type, members] of Object.entries(groupedByType)) {
          xml += `    <types>\n`;
          Array.from(members).sort().forEach(member => {
              xml += `        <members>${member}</members>\n`;
          });
          xml += `        <name>${type}</name>\n`;
          xml += `    </types>\n`;
      }
      xml += `    <version>63.0</version>\n</Package>\n`; 

      fs.writeFileSync(filename, xml);
      console.log(`\nArchivo "${filename}" generado con éxito en el directorio "${manifestDir}".`);
  } else {
      console.log('\nNo hay componentes para generar el archivo "package.xml".');
  }
};

// ─────► GENERAR ARCHIVO package.yaml
const generarPackageYAML = (vlocityComponents) => {
  if (vlocityComponents.length > 0) {
      const manifestDir = 'manifest';
      const filename = path.join(manifestDir, `package-vlocity-${targetOrg}.yaml`);

      // Crear el directorio manifest si no existe
      if (!fs.existsSync(manifestDir)) {
          fs.mkdirSync(manifestDir, { recursive: true });
      }

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
          '            Product2:',
          '                MaxDeploy: 1',
      ].join('\n');

      fs.writeFileSync(filename, yaml);
      console.log(`\nArchivo "${filename}" generado con éxito en el directorio "${manifestDir}".`);
  } else {
      console.log('\nNo hay componentes de Vlocity para generar el archivo "package.yaml".');
  }
};

// ─────► MAIN
(async () => {
    const startTime = Date.now();

    console.log(`\n🔍 Verificando modificaciones de "${userToAudit}" en ${metadataTypesToUse.length} tipos de metadatos de "${targetOrg}" (últimos ${daysToCheck} días)...\n`); 

    const tareasCore = metadataTypesToUse.map(tipo => () => verificarMetadata(tipo));
    const resultadosCore = await ejecutarConcurrentemente(tareasCore, 10);

    let resultadosVlocity = [];
    if (vlocityNamespace) {
        console.log(`\n📦 Verificando componentes Vlocity usando namespace "${vlocityNamespace}"...\n`);
        const tareasVlocity = Object.entries(datapackQueries).map(([nombre, query]) => () => consultarDatapack(nombre, query));
        resultadosVlocity = await ejecutarConcurrentemente(tareasVlocity, 5);
    }

    const resultadosTotales = [...resultadosCore, ...resultadosVlocity];

    process.stdout.write('\n');

    if (resultadosTotales.length === 0) {
        console.log(`❌ No se encontraron modificaciones recientes por "${userToAudit}".`); 
    } else {
        console.log(`\n✅ Elementos modificados recientemente por "${userToAudit}":\n`); 
        console.log('Metadata'.padEnd(20) + 'FullName'.padEnd(45) + 'LastModify'.padEnd(35) + 'LastModifyby');
        resultadosTotales.forEach(item => {
            console.log(
                item.type.padEnd(20) +
                `'${item.fullName}'`.padEnd(45) +
                `'${item.lastModifiedDate}'`.padEnd(35) +
                `'${item.lastModifiedByName}'`
            );
        });

        // Generar package.xml si el flag está presente
        if (generatePackageXML) {
            generarPackageXML(resultadosTotales.filter(item => !Object.keys(datapackQueries).includes(item.type)));
        }

        // Generar package.yaml si el flag está presente y hay resultados de Vlocity
        if (generatePackageYAML && resultadosVlocity.length > 0) {
            generarPackageYAML(resultadosVlocity);
        }
    }

    const endTime = Date.now();
    const minutes = Math.floor((endTime - startTime) / 60000);
    const seconds = Math.floor(((endTime - startTime) % 60000) / 1000);
    console.log(`\n🕒 Tiempo total de ejecución: ${minutes}m ${seconds}s\n`);

})();
