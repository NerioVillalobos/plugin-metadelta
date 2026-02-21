export function buildJsonReport({
  metadata,
  events,
  scoring,
  ai
}) {
  return {
    metadata,
    scoring,
    events,
    ai
  };
}

export function buildMarkdownReport({
  metadata,
  scoring,
  events,
  ai
}) {
  const lines = [];
  lines.push(`# Reporte de integridad Git`);
  lines.push('');
  lines.push(`**Repositorio:** ${metadata.repoPath}`);
  lines.push(`**Referencia principal:** ${metadata.mainlineRef}`);
  lines.push(`**Rango analizado:** ${metadata.range || metadata.mainlineRef}`);
  lines.push(`**Commits analizados:** ${metadata.commitCount}`);
  lines.push(`**Riesgo global:** ${scoring.level} (score ${scoring.score})`);
  lines.push('');

  if (ai?.status === 'ok' && ai.summary) {
    lines.push('## Resumen IA de eventos');
    lines.push(ai.summary);
    lines.push('');
  }

  lines.push('## Eventos detectados');
  if (events.length === 0) {
    lines.push('No se detectaron eventos de riesgo.');
  } else {
    for (const event of events) {
      lines.push(`- **${event.type}** (${event.severity}) - ${event.message || ''}`.trim());
      if (event.commit) {
        lines.push(`  - Commit: \`${event.commit}\``);
      }
      if (event.author) {
        lines.push(`  - Autor: ${event.author}`);
      }
      if (event.date) {
        lines.push(`  - Fecha: ${event.date}`);
      }
      if (event.details) {
        lines.push(`  - Detalles: \`${JSON.stringify(event.details)}\``);
      }
      if (event.commits) {
        lines.push(`  - Commits: ${event.commits.join(', ')}`);
      }
    }
  }

  lines.push('');
  lines.push('## Scoring');
  lines.push('```json');
  lines.push(JSON.stringify(scoring, null, 2));
  lines.push('```');

  lines.push('');
  lines.push('## IA');
  if (!ai || ai.status === 'skipped') {
    lines.push('IA no ejecutada. Proporcione credenciales y habilite el flag `--ai` para obtener explicación.');
  } else if (ai.status === 'ok') {
    lines.push(ai.response || '');
  } else {
    lines.push(`IA no disponible: ${ai?.error || 'error desconocido'}`);
  }

  return lines.join('\n');
}
