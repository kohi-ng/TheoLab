import { getApiKey, getLocalSetting } from '../../core/dataGateway.js';
import { getCachedVault } from '../../core/secretsVault.ts';
import { getActiveContext } from '../../core/contextBus.js';
import { getActiveSkills } from './skills/registry.js';
import { search_vector_kb } from './functions/localFunctions.js';
import { runVertexAI } from './vertexProvider.ts';

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error?.message ?? body.message ?? `Provider returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

function sanitizeLesson(lesson) {
  return {
    id: lesson.id,
    subject: lesson.core?.subject ?? '',
    title: lesson.payload?.title ?? '',
    blocks: (lesson.payload?.blocks ?? []).map((block) => ({
      id: block.id,
      type: block.type,
      title: block.title,
      content: block.content ?? block.prompt ?? block.question ?? block.summary ?? '',
      formula: block.formula,
      options: block.options?.map((option) => option.text),
    })),
  };
}

export async function runAgent({
  prompt,
  model,
  provider = 'google',
  preferences = {},
  context = {},
}) {
  const vault = getCachedVault();
  const apiKey = (provider === 'google' ? vault.geminiApiKey : provider === 'vertex' ? vault.vertexApiKey : '')
    || getApiKey(provider);
  if (provider !== 'vertex' && !apiKey) {
    throw new Error(`Thêm API Key ${provider} trong tab Cấu hình để gọi Agent.`);
  }
  const currentContext = getActiveContext();
  const activeContext = {
    ...(preferences.autoContext ? currentContext : {
      activeTab: currentContext.activeTab,
      lessonId: null,
      lessonTitle: null,
      selectedBlockId: null,
      lastExerciseResult: null,
      widgetState: null,
    }),
    libraryContext: context.libraryContext ?? null,
  };
  const skills = getActiveSkills(activeContext.activeTab);
  const lessonContext = (context.lessons ?? []).map(sanitizeLesson);
  const activeLesson = context.autoContext && context.activeLesson
    ? sanitizeLesson(context.activeLesson)
    : null;
  const vectorResults = preferences.useRag ? await search_vector_kb(prompt) : null;
  const instructions = [
    'You are a concise learning assistant for TheoLab. Reply in Vietnamese.',
    `Skill: ${
      {
        supporter: 'Agent Supporter: guide with hints and questions before revealing the answer.',
        step_by_step: 'Explain the solution in numbered logical steps.',
        timed_exercise: 'Create a concise timed practice question when useful.',
        instructor: 'Agent Instructor: help author valid lesson JSON.',
      }[preferences.skill] ?? 'Agent Supporter'
    }. Answer depth: ${preferences.depth ?? 'balanced'}.`,
    `Additional session instructions: ${preferences.instructions || 'none'}.`,
    `Active learning context: ${JSON.stringify(activeContext)}.`,
    `Attached library content (explicit user selection): ${JSON.stringify(context.libraryContext ?? null)}.`,
    `Active lesson: ${JSON.stringify(activeLesson)}.`,
    `Explicitly selected lessons (sanitized): ${JSON.stringify(lessonContext)}.`,
    `Vector search: ${JSON.stringify(vectorResults)}.`,
    vectorResults?.results?.length
      ? 'When using facts from Vector search, cite the source inline with its breadcrumb and deep_link (e.g., [Vùng đệm](#/hoa-phan-tich/...)).'
      : 'No vector search hits attached.',
    preferences.includeFormula
      ? 'Formula Hub references: Ka = [H+][A-]/[HA]; Kb = [HA][OH-]/[A-]; pKa = -log Ka; pKw = pH + pOH = 14.00 at 25 C; pH = pKa + log([A-]/[HA]).'
      : 'Formula Hub references are not attached.',
    `Available tab skills: ${skills.map((skill) => skill.name).join(', ') || 'none'}.`,
    preferences.useMcp
      ? 'MCP Tools preference is enabled, but this client has no configured allowlisted tool schema. Do not claim to execute MCP tools.'
      : 'MCP tools are disabled.',
  ];
  const system = instructions.join('\n');
  const temperature = Math.max(0, Math.min(1.2, Number(preferences.temperature ?? 0.3)));
  const providerTemperature = provider === 'anthropic' ? Math.min(1, temperature) : temperature;

  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: providerTemperature,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      }),
    });
    const body = await readResponse(response);
    return body.choices?.[0]?.message?.content ?? 'Mô hình không trả về nội dung.';
  }

  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        temperature: providerTemperature,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const body = await readResponse(response);
    return body.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
      ?? 'Mô hình không trả về nội dung.';
  }

  if (provider === 'vertex') {
    return runVertexAI({
      model: model || 'gemini-2.5-flash',
      system,
      prompt,
      temperature: providerTemperature,
      location: vault.vertexLocation || 'us-central1',
    });
  }

  if (provider === 'google') {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: providerTemperature },
        }),
      },
    );
    const body = await readResponse(response);
    return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('')
      ?? 'Mô hình không trả về nội dung.';
  }

  if (provider === 'openrouter' || provider === 'custom') {
    const endpoint = provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : getLocalSetting('custom-endpoint');
    if (!endpoint) throw new Error('Nhập Custom endpoint trong tab Cấu hình trước khi gửi.');
    const requestModel = provider === 'custom' ? getLocalSetting('model:custom', model) : model;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: requestModel,
        temperature: providerTemperature,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      }),
    });
    const body = await readResponse(response);
    return body.choices?.[0]?.message?.content ?? 'Mô hình không trả về nội dung.';
  }

  throw new Error(`Provider "${provider}" chưa được hỗ trợ.`);
}
