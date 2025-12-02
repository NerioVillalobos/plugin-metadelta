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
