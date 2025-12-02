import { spawnSync } from 'node:child_process';
export const fetchOrgApiVersion = (targetOrg) => {
    if (!targetOrg) {
        return { apiVersion: null, error: null };
    }
    const result = spawnSync('sf', ['org', 'display', '--target-org', targetOrg, '--json'], {
        encoding: 'utf8'
    });
    if (result.error) {
        return { apiVersion: null, error: result.error.message };
    }
    if (result.status !== 0) {
        const stderr = (result.stderr || '').toString().trim();
        const message = stderr || `El comando sf org display finalizó con código ${result.status}.`;
        return { apiVersion: null, error: message };
    }
    const stdout = (result.stdout || '').toString();
    if (!stdout.trim()) {
        return { apiVersion: null, error: 'La respuesta de sf org display está vacía.' };
    }
    const jsonStart = stdout.indexOf('{');
    const jsonEnd = stdout.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
        return { apiVersion: null, error: 'No se encontró contenido JSON en la salida de sf org display.' };
    }
    const jsonText = stdout.slice(jsonStart, jsonEnd + 1);
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch (error) {
        return { apiVersion: null, error: `No se pudo interpretar la salida JSON: ${error.message}` };
    }
    const apiVersion = parsed?.result?.apiVersion ?? parsed?.result?.ApiVersion ?? parsed?.result?.api_version ?? null;
    if (!apiVersion) {
        return { apiVersion: null, error: 'No se encontró el campo apiVersion en la respuesta de sf org display.' };
    }
    return { apiVersion: String(apiVersion), error: null };
};
