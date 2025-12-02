# Metadelta - Salesforce CLI Plugin

Metadelta es un plugin profesional para Salesforce CLI (sf) que ayuda a auditar y consolidar cambios de metadatos recientes en una organización. Incluye utilidades para detectar componentes modificados, localizar clases de prueba asociadas, limpiar Permission Sets, combinar manifests y validar despliegues con manifiestos XML/YAML.

## Instalación

### Desde GitHub Releases

Cada Release incluye el tarball **generado con `npm pack`** y compilado (no es el tarball de código fuente). Descarga el artefacto `nervill-metadelta-<version>.tgz` o su alias `metadelta-<version>.tgz` y usa el enlace exacto del Release correspondiente. Ejemplo con la versión 1.0.7:

```bash
sf plugins install https://github.com/NerioVillalobos/plugin-metadelta/releases/download/v1.0.7/nervill-metadelta-1.0.7.tgz
# alias sin scope
sf plugins install https://github.com/NerioVillalobos/plugin-metadelta/releases/download/v1.0.7/metadelta-1.0.7.tgz
```

### Instalación local (tarball generado con `npm pack`)

1. Genera el tarball compilado en `dist/` (incluye manifest y código JS listo para instalación):
   ```bash
   npm run pack:tarball
   ls -l dist/nervill-metadelta-*.tgz
   ```
2. Instala usando **ruta absoluta** o prefijo `file:` apuntando al archivo dentro de `dist/` para evitar que npm intente resolver una URL inexistente:
   ```bash
   sf plugins install file://$(pwd)/dist/nervill-metadelta-1.0.7.tgz
   # alternativa desde el mismo directorio
   sf plugins install file:dist/nervill-metadelta-1.0.7.tgz
   ```
3. Si usas otro directorio, ajusta la ruta absoluta, por ejemplo:
   ```bash
   sf plugins install file:/home/usuario/plugin-metadelta/dist/nervill-metadelta-1.0.7.tgz
   ```

### Instalación remota (Release oficial)

Si quieres distribuir el plugin para que otros lo instalen sin clonar el repositorio:

1. **Fusiona la rama de trabajo a `master` (o `main`)**
   ```bash
   git checkout master
   git merge <tu-rama-de-trabajo>
   git push origin master
   ```
2. **Etiqueta la versión** (sigue el esquema `v*`, por ejemplo `v1.0.7`):
   ```bash
   git tag v1.0.7
   git push origin v1.0.7
   ```
3. **Espera al workflow de Release**: el flujo `Build & Release Metadelta` ejecuta `npm run pack:tarball` para generar el tarball compilado en `dist/` y adjunta dos archivos al Release: `nervill-metadelta-<version>.tgz` y su alias `metadelta-<version>.tgz`.
4. **Instala desde GitHub Releases** usando cualquiera de las URLs del artefacto generado:
   ```bash
   sf plugins install https://github.com/NerioVillalobos/plugin-metadelta/releases/download/v1.0.7/nervill-metadelta-1.0.7.tgz
   # o bien, el alias sin scope
   sf plugins install https://github.com/NerioVillalobos/plugin-metadelta/releases/download/v1.0.7/metadelta-1.0.7.tgz
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
3. **Empaqueta el plugin** (genera `dist/nervill-metadelta-1.0.7.tgz` con el código compilado)
   ```bash
   npm run pack:tarball
   ```
4. **Instala desde el tarball local** (usa ruta absoluta o `file:` apuntando al archivo en `dist/`)
   ```bash
   sf plugins install file://$(pwd)/dist/nervill-metadelta-1.0.7.tgz
   # alternativa desde el mismo directorio
   sf plugins install file:dist/nervill-metadelta-1.0.7.tgz
   ```
5. **Autoriza el plugin sin firmar (si es necesario)**
   ```bash
   echo '{ "unsignedPluginAllowList": ["@nervill/metadelta"] }' \
   > ~/.config/sf/unsignedPluginAllowList.json
   ```
6. **Publica una versión automática**
   - Crea un tag siguiendo el esquema `v*`, por ejemplo `v1.0.7`:
     ```bash
     git tag v1.0.7
     git push origin v1.0.7
     ```
   - El workflow `Build & Release Metadelta` se ejecutará, construirá el plugin, adjuntará el tarball al release y publicará en npm si `NPM_TOKEN` está configurado.
7. **Instala desde GitHub Releases** (una vez generado el release):
   ```bash
   sf plugins install https://github.com/NerioVillalobos/plugin-metadelta/releases/download/v1.0.7/nervill-metadelta-1.0.7.tgz
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

### Error: `npm ERR! 404 ... https://github.com/./metadelta-1.0.7.tgz`

Sucede cuando `sf plugins install` interpreta la ruta del tarball como URL de GitHub (por ejemplo, por usar `./dist/nervill-metadelta-1.0.7.tgz` fuera del directorio que contiene el archivo o por reescritura automática en ramas que no son `master`).

1. Verifica que el tarball existe en `dist/`.
   ```bash
   ls -l dist/nervill-metadelta-1.0.7.tgz
   ```
2. Instala usando ruta absoluta o con prefijo `file:` desde el directorio que tiene el tarball.
   ```bash
   sf plugins install file://$(pwd)/dist/nervill-metadelta-1.0.7.tgz
   # alternativa desde el mismo directorio
   sf plugins install file:dist/nervill-metadelta-1.0.7.tgz
   ```
3. Si sigues viendo el 404, elimina instalaciones previas e intenta de nuevo con la ruta absoluta.
   ```bash
   sf plugins uninstall @nervill/metadelta
   sf plugins install file://$(pwd)/dist/nervill-metadelta-1.0.7.tgz
   ```

### Error: `npm ERR! enoent ... dist/nervill-metadelta-1.0.7.tgz`

1. Verifica que el archivo **dist/nervill-metadelta-1.0.7.tgz** existe en el directorio desde el que instalas.
   ```bash
   ls -l dist/nervill-metadelta-1.0.7.tgz
   ```
2. Si no existe, vuelve a generar el tarball con `npm run pack:tarball` (esto también recompila el plugin y coloca el archivo en `dist/`).
   ```bash
   npm run pack:tarball
   ```
3. Instala con ruta absoluta o `file:` apuntando a ese archivo, sin moverlo a otros directorios ocultos.
   ```bash
   sf plugins install file://$(pwd)/dist/nervill-metadelta-1.0.7.tgz
   # o bien, especifica la ruta absoluta completa
   sf plugins install file:/home/usuario/plugin-metadelta/dist/nervill-metadelta-1.0.7.tgz
   ```
