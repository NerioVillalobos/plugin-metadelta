import { Command, Flags } from '@oclif/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const MFA_FILE = 'accessbackup.dat.mfa';
const BACKUP_FILE = 'accessbackup.dat';
const TEMP_AUTH_FILE = 'auth';
const OTP_WINDOW_SECONDS = 30;
const OTP_DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
class Access extends Command {
    static id = 'metadelta:access';
    static summary = 'Gestiona respaldos cifrados de accesos de orgs con MFA (Metadelta Access).';
    static description = 'Exporta aliases conectados, captura SFDX Auth URLs cifradas y restaura accesos en otro equipo (Windows/Linux/WSL) usando únicamente Node.js + Salesforce CLI.';
    static flags = {
        all: Flags.boolean({ summary: 'Exporta todos los aliases conectados a una carpeta "All".' }),
        prefix: Flags.string({ summary: 'Exporta solo aliases que inicien con este prefijo (también será el nombre de carpeta).' }),
        output: Flags.string({ summary: 'Directorio base de salida', default: 'docs' }),
        capture: Flags.string({ summary: 'Carpeta que contiene accessbackup.dat para capturar y cifrar auth URLs' }),
        addaccess: Flags.string({ summary: 'Carpeta que contiene accessbackup.dat para restaurar accesos en el equipo actual', aliases: ['adaccess'] }),
        passphrase: Flags.string({ summary: 'Passphrase para cifrar/descifrar (si no se envía, se solicita por consola).' }),
    };
    async run() {
        const { flags } = await this.parse(Access);
        const actions = [Boolean(flags.all), Boolean(flags.prefix), Boolean(flags.capture), Boolean(flags.addaccess)].filter(Boolean);
        if (actions.length !== 1) {
            this.error('Debes usar exactamente una acción: --all, --prefix, --capture o --addaccess.');
        }
        if (flags.all) {
            this.exportFiltered(flags.output, 'All');
            return;
        }
        if (flags.prefix) {
            this.exportFiltered(flags.output, flags.prefix, flags.prefix);
            return;
        }
        if (flags.capture) {
            const passphrase = await this.resolvePassphrase(flags.passphrase, 'Passphrase encryption: ');
            await this.capture(flags.capture, passphrase);
            return;
        }
        if (flags.addaccess) {
            const passphrase = await this.resolvePassphrase(flags.passphrase, 'Passphrase decrypt: ');
            await this.addAccess(flags.addaccess, passphrase);
        }
    }
    async resolvePassphrase(fromFlag, promptText) {
        if (fromFlag)
            return fromFlag;
        const rl = readline.createInterface({ input, output });
        const value = await rl.question(promptText);
        rl.close();
        if (!value) {
            this.error('La passphrase no puede estar vacía.');
        }
        return value;
    }
    runCmd(cmd, args, options = {}) {
        const attempts = [cmd];
        if (process.platform === 'win32' && !cmd.toLowerCase().endsWith('.cmd')) {
            attempts.push(`${cmd}.cmd`);
        }
        let lastError;
        for (const candidate of attempts) {
            try {
                const stdout = execFileSync(candidate, args, { encoding: 'utf8', ...options });
                return stdout.trim();
            }
            catch (error) {
                lastError = error;
                if (!(error?.message || '').includes('ENOENT')) {
                    const stderr = error.stderr?.toString()?.trim();
                    throw new Error(stderr || error.message);
                }
            }
        }
        const stderr = lastError?.stderr?.toString()?.trim();
        throw new Error(stderr || lastError?.message || `No se pudo ejecutar: ${cmd}`);
    }
    runJSON(cmd, args) {
        const raw = this.runCmd(cmd, args);
        try {
            return JSON.parse(raw);
        }
        catch {
            throw new Error(`Respuesta JSON inválida para: ${cmd} ${args.join(' ')}`);
        }
    }
    listConnectedOrgs() {
        const data = this.runJSON('sf', ['org', 'list', '--json']);
        const result = data?.result ?? {};
        return [...(result.nonScratchOrgs ?? []), ...(result.scratchOrgs ?? [])].filter((org) => org?.connectedStatus === 'Connected');
    }
    getSfdxAuthUrl(alias) {
        const data = this.runJSON('sf', ['org', 'display', '--target-org', alias, '--json', '--verbose']);
        const authUrl = data?.result?.sfdxAuthUrl;
        if (!authUrl) {
            throw new Error(`No se pudo obtener sfdxAuthUrl para ${alias}`);
        }
        return authUrl;
    }
    ensureMfa(folder) {
        const mfaPath = path.join(folder, MFA_FILE);
        if (fs.existsSync(mfaPath)) {
            this.log('⚠️ MFA ya existe para este backup. No se regenera.');
            return;
        }
        const secret = this.generateBase32Secret(32);
        fs.writeFileSync(mfaPath, `${secret}\n`, 'utf8');
        const account = encodeURIComponent(path.basename(folder));
        const issuer = encodeURIComponent('MetadeltaAccess');
        const uri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&period=${OTP_WINDOW_SECONDS}&digits=${OTP_DIGITS}`;
        this.log('');
        this.log('MFA creado. Configura tu app Authenticator con:');
        this.log('Escanea este QR:');
        this.printQr(uri);
        this.log(`- Secret: ${secret}`);
        this.log(`- URI: ${uri}`);
        this.log('⚠️ Guarda este secret ahora. No se volverá a mostrar.');
        this.log('');
    }
    printQr(uri) {
        const script = [
            'import qrcode',
            'import os',
            "qr = qrcode.QRCode(border=1)",
            "qr.add_data(os.environ['METADELTA_QR_URI'])",
            'qr.make(fit=True)',
            'qr.print_ascii(invert=True)'
        ].join('; ');
        const tryPython = (binary) => {
            try {
                this.runCmd(binary, ['-c', script], { env: { ...process.env, METADELTA_QR_URI: uri }, stdio: 'inherit' });
                return true;
            }
            catch {
                return false;
            }
        };
        if (tryPython('python3') || tryPython('python')) {
            return;
        }
        this.warn('No fue posible mostrar el QR en consola automáticamente. Usa el URI/Secret para agregarlo manualmente.');
    }
    verifyMfa(folder) {
        const mfaPath = path.join(folder, MFA_FILE);
        if (!fs.existsSync(mfaPath)) {
            this.error(`No existe archivo MFA: ${mfaPath}`);
        }
        const secret = fs.readFileSync(mfaPath, 'utf8').trim();
        if (!secret) {
            this.error(`El archivo MFA está vacío: ${mfaPath}`);
        }
        return secret;
    }
    exportFiltered(outputBase, name, prefix) {
        const folder = path.join(outputBase, name);
        fs.mkdirSync(folder, { recursive: true });
        const filePath = path.join(folder, BACKUP_FILE);
        const orgs = this.listConnectedOrgs();
        const rows = orgs
            .filter((org) => {
            const alias = org.alias ?? '';
            return prefix ? alias.toLowerCase().startsWith(prefix.toLowerCase()) : true;
        })
            .map((org) => `${org.alias ?? ''};${org.username ?? ''}`);
        fs.writeFileSync(filePath, rows.join('\n') + (rows.length ? '\n' : ''), 'utf8');
        this.ensureMfa(folder);
        this.log(`Backup generado en: ${folder}`);
    }
    async capture(folder, passphrase) {
        const secret = this.verifyMfa(folder);
        if (!(await this.readAndValidateMfa(secret))) {
            this.error('Código MFA inválido.');
        }
        const filePath = path.join(folder, BACKUP_FILE);
        if (!fs.existsSync(filePath)) {
            this.error(`No existe archivo de backup: ${filePath}`);
        }
        const lines = fs
            .readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        const newLines = [];
        for (const line of lines) {
            const [alias, username] = line.split(';');
            if (!alias || !username) {
                this.warn(`Línea inválida omitida: ${line}`);
                continue;
            }
            this.log(`Capturando: ${alias}`);
            const authUrl = this.getSfdxAuthUrl(alias);
            const encrypted = encryptValue(authUrl, passphrase);
            newLines.push(`${alias};${username};${encrypted}`);
        }
        fs.writeFileSync(filePath, newLines.join('\n') + (newLines.length ? '\n' : ''), 'utf8');
        this.log(`Capture completado: ${filePath}`);
    }
    async addAccess(folder, passphrase) {
        const secret = this.verifyMfa(folder);
        if (!(await this.readAndValidateMfa(secret))) {
            this.error('Código MFA inválido.');
        }
        const filePath = path.join(folder, BACKUP_FILE);
        if (!fs.existsSync(filePath)) {
            this.error(`No existe archivo de backup: ${filePath}`);
        }
        const lines = fs
            .readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        let restored = 0;
        for (const line of lines) {
            const parts = line.split(';');
            const [alias, username, encrypted] = parts;
            if (parts.length === 2 && alias && username) {
                this.error(`El archivo ${filePath} contiene entradas sin cifrar (${alias};${username}). Ejecuta primero: sf metadelta access --capture ${folder}`);
            }
            if (parts.length < 3 || !alias || !username || !encrypted) {
                this.warn(`Línea inválida omitida: ${line}`);
                continue;
            }
            let authUrl;
            try {
                authUrl = decryptValue(encrypted, passphrase);
            }
            catch (error) {
                this.error(`No se pudo descifrar la línea de ${alias}. Verifica passphrase/captura. Detalle: ${error.message}`);
            }
            const tempFile = path.join(os.tmpdir(), `${TEMP_AUTH_FILE}-${process.pid}-${Date.now()}.auth`);
            fs.writeFileSync(tempFile, authUrl, 'utf8');
            try {
                let sfdxError;
                try {
                    this.runCmd('sfdx', ['auth:sfdxurl:store', '-f', tempFile, '-a', alias]);
                }
                catch (error) {
                    sfdxError = error;
                    try {
                        this.runCmd('sf', ['org', 'login', 'sfdx-url', '--sfdx-url-file', tempFile, '--alias', alias, '--no-prompt']);
                    }
                    catch (sfError) {
                        if (sfdxError.message.includes('ENOENT') && sfError.message.includes('ENOENT')) {
                            this.error(`No se pudo restaurar ${alias}. No se encontró 'sfdx' ni 'sf' en PATH. Detalles: sfdx=${sfdxError.message}; sf=${sfError.message}`);
                        }
                        this.error(`No se pudo restaurar ${alias}. Error con sfdx: ${sfdxError.message}. Error con sf: ${sfError.message}`);
                    }
                }
            }
            finally {
                fs.rmSync(tempFile, { force: true });
            }
            this.log(`Acceso agregado: ${alias}`);
            restored += 1;
        }
        if (restored === 0) {
            this.error(`No se restauró ningún acceso desde ${filePath}.`);
        }
    }
    async readAndValidateMfa(secret) {
        const otp = await this.readMfaCode();
        return verifyTotp({ secret, token: otp, window: 1 });
    }
    async readMfaCode() {
        const rl = readline.createInterface({ input, output });
        const code = await rl.question('MFA code: ');
        rl.close();
        if (!code) {
            this.error('Debes ingresar un código MFA.');
        }
        return code.trim();
    }
    generateBase32Secret(length) {
        const bytes = crypto.randomBytes(length);
        let value = '';
        for (const byte of bytes) {
            value += BASE32_ALPHABET[byte % BASE32_ALPHABET.length];
        }
        return value;
    }
}
function encryptValue(value, passphrase) {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(passphrase, salt, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [salt, iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}
function decryptValue(payload, passphrase) {
    const [saltB64, ivB64, tagB64, dataB64] = payload.split('.');
    if (!saltB64 || !ivB64 || !tagB64 || !dataB64) {
        throw new Error('Formato de valor cifrado inválido.');
    }
    const salt = Buffer.from(saltB64, 'base64url');
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const encrypted = Buffer.from(dataB64, 'base64url');
    const key = crypto.scryptSync(passphrase, salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}
function verifyTotp({ secret, token, window = 1 }) {
    const normalizedToken = String(token).trim();
    if (!/^\d{6}$/.test(normalizedToken)) {
        return false;
    }
    const currentStep = Math.floor(Date.now() / 1000 / OTP_WINDOW_SECONDS);
    for (let offset = -window; offset <= window; offset++) {
        const expected = generateTotp(secret, currentStep + offset);
        if (expected === normalizedToken) {
            return true;
        }
    }
    return false;
}
function generateTotp(secret, counter) {
    const key = decodeBase32(secret);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    return String(code % 10 ** OTP_DIGITS).padStart(OTP_DIGITS, '0');
}
function decodeBase32(value) {
    const clean = value.replace(/=+$/u, '').toUpperCase().replace(/\s+/gu, '');
    let bits = '';
    for (const char of clean) {
        const idx = BASE32_ALPHABET.indexOf(char);
        if (idx === -1) {
            throw new Error('Secret MFA con Base32 inválido.');
        }
        bits += idx.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
    }
    return Buffer.from(bytes);
}
export default Access;
