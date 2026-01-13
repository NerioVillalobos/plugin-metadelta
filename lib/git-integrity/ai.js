export const DEFAULT_AI_PROMPT = `Eres un analista senior de integridad Git. Recibes eventos estructurados sobre un repositorio.
Tu respuesta debe:
1) Resumir en una lista corta los tipos de eventos detectados y qué significan (1-2 líneas por tipo).
2) Explicar qué ocurrió.
3) Explicar por qué es riesgoso.
4) Explicar el impacto posible.
5) Recomendar acciones concretas.

Responde en JSON con las claves:
- summary: texto breve con lista de tipos y explicación corta por tipo
- analysis: explicación general en párrafos
- recommendations: lista de acciones recomendadas

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
    if (provider !== 'gemini') {
      throw new Error(`Proveedor IA no soportado: ${provider}`);
    }
  }
  if (!apiKey) {
    const missingKey = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
    throw new Error(`Falta ${missingKey} para ejecutar el módulo de IA.`);
  }
  if (provider === 'gemini') {
    const geminiModel = model || 'gemini-1.5-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {text: payload.prompt},
                {text: JSON.stringify(payload.context, null, 2)}
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2
          }
        })
      }
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${message}`);
    }
    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return normalizeAiResponse({prompt: payload.prompt, content});
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
  return normalizeAiResponse({prompt: payload.prompt, content});
}

function normalizeAiResponse({prompt, content}) {
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }
  return {
    status: 'ok',
    prompt,
    response: content,
    summary: parsed?.summary ?? null,
    analysis: parsed?.analysis ?? null,
    recommendations: Array.isArray(parsed?.recommendations) ? parsed.recommendations : null
  };
}
