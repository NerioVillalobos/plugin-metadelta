import { Command, Flags } from '../../utils/oclif.js';
import { runCommandSync, formatCommandFailure } from '../../utils/command.js';
const parseJsonOutput = (stdout, emptyMessage = 'La salida JSON está vacía.', invalidMessage = 'No se encontró contenido JSON en la salida del comando Salesforce CLI.') => {
    if (!stdout || !String(stdout).trim()) {
        return { value: null, error: emptyMessage };
    }
    const text = String(stdout);
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
        return { value: null, error: invalidMessage };
    }
    try {
        return { value: JSON.parse(text.slice(jsonStart, jsonEnd + 1)), error: null };
    }
    catch (error) {
        return { value: null, error: `No se pudo interpretar la salida JSON: ${error.message}` };
    }
};
export const parseOrgIsSandboxResponse = (stdout) => {
    const { value: parsed, error: parseError } = parseJsonOutput(stdout);
    if (parseError) {
        return { isSandbox: null, error: parseError };
    }
    const isSandbox = parsed?.result?.records?.[0]?.IsSandbox;
    if (typeof isSandbox !== 'boolean') {
        return { isSandbox: null, error: 'No se encontró un valor booleano IsSandbox en la respuesta de Organization.' };
    }
    return { isSandbox, error: null };
};
export const fetchOrgApiVersion = (targetOrg) => {
    if (!targetOrg) {
        return { apiVersion: null, error: null };
    }
    const result = runCommandSync('sf', ['org', 'display', '--target-org', targetOrg, '--json']);
    if (result.error) {
        return { apiVersion: null, error: formatCommandFailure(result) };
    }
    if (result.status !== 0) {
        const message = formatCommandFailure(result, `El comando sf org display finalizó con código ${result.status}.`);
        return { apiVersion: null, error: message };
    }
    const { value: parsed, error: parseError } = parseJsonOutput(result.stdout, 'La respuesta de sf org display está vacía.', 'No se encontró contenido JSON en la salida de sf org display.');
    if (parseError) {
        return { apiVersion: null, error: parseError };
    }
    const apiVersion = parsed?.result?.apiVersion ?? parsed?.result?.ApiVersion ?? parsed?.result?.api_version ?? null;
    if (!apiVersion) {
        return { apiVersion: null, error: 'No se encontró el campo apiVersion en la respuesta de sf org display.' };
    }
    return { apiVersion: String(apiVersion), error: null };
};
export const fetchOrgIsSandbox = (targetOrg) => {
    if (!targetOrg) {
        return { isSandbox: null, error: 'No se proporcionó una org destino para detectar el tipo de organización.' };
    }
    const result = runCommandSync('sf', [
        'data',
        'query',
        '--query',
        'SELECT IsSandbox FROM Organization',
        '--target-org',
        targetOrg,
        '--json'
    ]);
    if (result.error) {
        return { isSandbox: null, error: formatCommandFailure(result) };
    }
    if (result.status !== 0) {
        return {
            isSandbox: null,
            error: formatCommandFailure(result, `El comando sf data query finalizó con código ${result.status}.`)
        };
    }
    return parseOrgIsSandboxResponse(result.stdout);
};
class OrgApiVersion extends Command {
    static id = 'metadelta:orgApiVersion';
    static summary = 'Obtiene la versión de API de una organización objetivo.';
    static description = 'Ejecuta sf org display --json para recuperar la versión de API de la organización indicada.';
    static flags = {
        org: Flags.string({
            char: 'o',
            summary: 'Alias o nombre de usuario de la organización objetivo.',
            required: true
        })
    };
    async run() {
        const { flags } = await this.parse(OrgApiVersion);
        const { apiVersion, error } = fetchOrgApiVersion(flags.org);
        if (error) {
            this.error(error);
        }
        this.log(apiVersion);
        return { apiVersion };
    }
}
export default OrgApiVersion;
