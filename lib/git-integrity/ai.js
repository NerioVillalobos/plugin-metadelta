export const DEFAULT_AI_PROMPT = `Eres un analista senior de integridad Git. Recibes eventos estructurados sobre un repositorio.
Tu respuesta debe:
1) Explicar qué ocurrió.
2) Explicar por qué es riesgoso.
3) Explicar el impacto posible.
4) Recomendar acciones concretas.

No hagas supuestos fuera de los datos. No inventes información. Escribe en español, claro y profesional.`;

export function buildAiPayload({events, summary, mainlineRef, repoPath, prompt = DEFAULT_AI_PROMPT}) {
  return {
    prompt,
    context: {
      repository: repoPath,
      mainlineRef,
      summary,
      events
    }
  };
}

export async function requestAiExplanation({
  events,
  summary,
  mainlineRef,
  repoPath,
  provider,
  apiKey,
  model
}) {
  const payload = buildAiPayload({events, summary, mainlineRef, repoPath});
  if (!provider || provider === 'none') {
    return {
      status: 'skipped',
      prompt: payload.prompt,
      response: null
    };
  }
  if (provider !== 'openai') {
    throw new Error(`Proveedor IA no soportado: ${provider}`);
  }
  if (!apiKey) {
    throw new Error('Falta OPENAI_API_KEY para ejecutar el módulo de IA.');
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        {role: 'system', content: payload.prompt},
        {role: 'user', content: JSON.stringify(payload.context, null, 2)}
      ],
      temperature: 0.2
    })
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${message}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  return {
    status: 'ok',
    prompt: payload.prompt,
    response: content
  };
}
