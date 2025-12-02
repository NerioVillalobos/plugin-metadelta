# Metadelta - Salesforce CLI Plugin

Metadelta es un plugin profesional para Salesforce CLI (sf) que ayuda a auditar y consolidar cambios de metadatos recientes en una organización. Incluye utilidades para detectar componentes modificados, localizar clases de prueba asociadas, limpiar Permission Sets, combinar manifests y validar despliegues con manifiestos XML/YAML.

## Instalación

### Desde GitHub Releases

```bash
sf plugins install https://github.com/NerioVillalobos/plugin-metadelta/releases/download/v1.0.0/metadelta-1.0.0.tgz
```

### Instalación local (tarball generado con `npm pack`)

```bash
sf plugins install ./metadelta-1.0.0.tgz
```

### Allowlist para plugins sin firmar

```bash
echo '{ "unsignedPluginAllowList": ["@nervill/metadelta"] }' \
> ~/.config/sf/unsignedPluginAllowList.json
```

## Comandos principales

Los comandos se ejecutan con el binario `sf` después de instalar el plugin:

- `sf metadelta:find` – Encuentra componentes modificados por usuario y rango de días.
- `sf metadelta:findtest` – Ubica clases de prueba relacionadas con clases Apex modificadas.
- `sf metadelta:cleanps` – Genera versiones filtradas de Permission Sets.
- `sf metadelta:merge` – Combina manifests en un `globalpackage.xml` sin duplicados.
- `sf metadelta:postvalidate` – Valida diferencias post-deploy contra manifests XML/YAML.
- `sf metadelta:manual:collect` – Consolida pasos manuales en Markdown.

## Desarrollo

Requisitos: Node.js >= 18 y npm.

```bash
npm install
```

Compilar y generar el manifiesto de OCLIF:

```bash
npm run build
```

Crear el paquete tarball listo para instalación:

```bash
npm run pack
```

## Workflow de release

El flujo `.github/workflows/release.yml` construye el plugin al crear un tag `v*`, genera el tarball mediante `npm pack`, adjunta el paquete al GitHub Release y, si existe `NPM_TOKEN`, publica en npm automáticamente.

## Estructura de distribución

- `bin/run`: binario de arranque OCLIF.
- `lib/`: comandos compilados listos para publicación.
- `oclif.manifest.json`: manifiesto generado para OCLIF.

Metadelta se distribuye con `"type": "module"` y es totalmente compatible con instalaciones desde tarball sin necesidad de clonar el repositorio.

## Próximos pasos para publicar o instalar

Sigue esta guía paso a paso para usar lo que ya está en el repositorio:

1. **Instala dependencias**
   ```bash
   npm install
   ```
2. **Compila y genera el manifiesto**
   ```bash
   npm run build
   ```
3. **Empaqueta el plugin** (genera `metadelta-1.0.0.tgz` en el directorio actual)
   ```bash
   npm pack
   ```
4. **Instala desde el tarball local**
   ```bash
   sf plugins install ./metadelta-1.0.0.tgz
   ```
5. **Autoriza el plugin sin firmar (si es necesario)**
   ```bash
   echo '{ "unsignedPluginAllowList": ["@nervill/metadelta"] }' \
   > ~/.config/sf/unsignedPluginAllowList.json
   ```
6. **Publica una versión automática**
   - Crea un tag siguiendo el esquema `v*`, por ejemplo `v1.0.0`:
     ```bash
     git tag v1.0.0
     git push origin v1.0.0
     ```
   - El workflow `Build & Release Metadelta` se ejecutará, construirá el plugin, adjuntará el tarball al release y publicará en npm si `NPM_TOKEN` está configurado.
7. **Instala desde GitHub Releases** (una vez generado el release):
   ```bash
   sf plugins install https://github.com/NerioVillalobos/plugin-metadelta/releases/download/v1.0.0/metadelta-1.0.0.tgz
   ```

## Solución de problemas comunes

### Error: `npm ERR! Missing script: "build"`

1. Verifica que estás en la carpeta del proyecto (debe existir `package.json` con el script `build`).
   ```bash
   pwd
   ls
   cat package.json | grep '"build"'
   ```
2. Asegúrate de tener la última versión del repositorio con el `package.json` actualizado.
   ```bash
   git pull origin main
   ```
3. Instala dependencias antes de compilar.
   ```bash
   npm install
   ```
4. Ejecuta nuevamente el build.
   ```bash
   npm run build
   ```

Si el problema persiste, elimina `node_modules` y reinstala dependencias:
```bash
rm -rf node_modules
npm install
npm run build
```

### Error: `sh: oclif: not found`

1. Asegúrate de estar en la versión más reciente del repositorio (el script de build ya no depende de tener `oclif` en tu PATH).
   ```bash
   git pull origin main
   ```
2. Reinstala dependencias para regenerar `node_modules/.bin`.
   ```bash
   npm install
   ```
3. Ejecuta nuevamente el build (ahora usa `tsc` y `node scripts/generate-manifest.mjs`).
   ```bash
   npm run build
   ```
