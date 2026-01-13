import {Command, Flags} from '@oclif/core';
import fs from 'node:fs';
import path from 'node:path';
import {analyzeRepository} from '../../git-integrity/index.js';

class GitAnalyze extends Command {
  static id = 'metadelta:gitanalyze';
  static summary = 'Analiza integridad Git y detecta malas integraciones.';
  static description =
    'Analiza el repositorio Git local, detecta integraciones de riesgo y genera reportes estructurados para CI/CD.';

  static flags = {
    repo: Flags.string({
      char: 'r',
      summary: 'Ruta del repositorio Git local a analizar',
      default: '.'
    }),
    range: Flags.string({
      summary: 'Rango Git a analizar (ej: base..HEAD). Si se omite se usa la referencia principal detectada.'
    }),
    'max-commits': Flags.integer({
      summary: 'Máximo de commits a analizar',
      default: 200
    }),
    'large-files': Flags.integer({
      summary: 'Umbral de archivos para detectar cambios grandes',
      default: 20
    }),
    'large-lines': Flags.integer({
      summary: 'Umbral de líneas para detectar cambios grandes',
      default: 500
    }),
    'huge-files': Flags.integer({
      summary: 'Umbral de archivos para detectar cambios masivos',
      default: 50
    }),
    'huge-lines': Flags.integer({
      summary: 'Umbral de líneas para detectar cambios masivos',
      default: 1500
    }),
    json: Flags.string({
      summary: 'Ruta de salida para el reporte JSON'
    }),
    markdown: Flags.string({
      summary: 'Ruta de salida para el reporte Markdown'
    }),
    'output-dir': Flags.string({
      summary: 'Directorio donde se escriben ambos reportes (JSON y Markdown)'
    }),
    ai: Flags.boolean({
      summary: 'Habilita la explicación por IA (usa OPENAI_API_KEY)',
      default: false
    }),
    'ai-provider': Flags.string({
      summary: 'Proveedor de IA (openai)',
      default: 'openai'
    }),
    'ai-model': Flags.string({
      summary: 'Modelo de IA a usar',
      default: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    })
  };

  async run() {
    const {flags} = await this.parse(GitAnalyze);
    const repoPath = path.resolve(flags.repo);
    const outputDir = flags['output-dir'] ? path.resolve(flags['output-dir']) : null;

    if (outputDir) {
      fs.mkdirSync(outputDir, {recursive: true});
    }

    const thresholds = {
      largeFilesThreshold: flags['large-files'],
      largeLinesThreshold: flags['large-lines'],
      hugeFilesThreshold: flags['huge-files'],
      hugeLinesThreshold: flags['huge-lines']
    };

    const analysis = await analyzeRepository({
      repoPath,
      range: flags.range,
      maxCommits: flags['max-commits'],
      thresholds,
      aiConfig: {
        enabled: flags.ai,
        provider: flags['ai-provider'],
        apiKey: process.env.OPENAI_API_KEY,
        model: flags['ai-model']
      }
    });

    const jsonPath = outputDir
      ? path.join(outputDir, 'git-integrity-report.json')
      : flags.json
      ? path.resolve(flags.json)
      : null;
    const markdownPath = outputDir
      ? path.join(outputDir, 'git-integrity-report.md')
      : flags.markdown
      ? path.resolve(flags.markdown)
      : null;

    if (jsonPath) {
      fs.writeFileSync(jsonPath, JSON.stringify(analysis.jsonReport, null, 2), 'utf8');
      this.log(`✅ JSON generado: ${jsonPath}`);
    }

    if (markdownPath) {
      fs.writeFileSync(markdownPath, analysis.markdownReport, 'utf8');
      this.log(`✅ Markdown generado: ${markdownPath}`);
    }

    if (!jsonPath && !markdownPath) {
      this.log(analysis.markdownReport);
    } else {
      this.log(`Riesgo global: ${analysis.scoring.level} (score ${analysis.scoring.score})`);
    }
  }
}

export default GitAnalyze;
