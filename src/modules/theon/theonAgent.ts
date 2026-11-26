/**
 * Theon Agent runtime — dedicated AI provider bridge with multi-provider
 * function calling (starting with `set_expression` so the agent controls
 * Theon's 3D facial expressions).
 */
import { APP_MODE, firebaseConfig, isFirebaseConfigured } from '../../config/runtimeConfig.js';
import { getActiveContext } from '../../core/contextBus.js';
import { getApiKey, getLocalSetting } from '../../core/dataGateway.js';
import { getCachedVault } from '../../core/secretsVault';
import { detectExpressionFromText } from './matrixText';
import {
  THEON_EXPRESSIONS,
  type TheonExpression,
  type TheonSettings,
} from './theonConfig';
import { executeTheonTool, THEON_TOOL_SPECS, type TheonToolHandlers } from './theonTools';

export interface TheonMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TheonTurnResult {
  reply: string;
  expression: TheonExpression;
  toolUsed: boolean;
}

const MAX_TOOL_STEPS = 3;
const DEFAULT_VERTEX_MODEL = 'gemini-3.8-flash';
const RETIRED_VERTEX_MODELS = /^gemini-(2\.|3\.6)/;

function buildSystemInstruction(settings: TheonSettings): string {
  const parts: string[] = [
    settings.systemPrompt.trim() ||
      'Bạn là Theon — nhân dạng AI học tập trong TheoLab. Trả lời bằng tiếng Việt ngắn gọn, rõ ràng.',
    `Biểu cảm hợp lệ cho hàm set_expression: ${THEON_EXPRESSIONS.join(', ')}.`,
  ];

  if (settings.autoContext) {
    const ctx = getActiveContext() as {
      activeTab?: string | null;
      lessonTitle?: string | null;
      activeDockTab?: { title?: string; appId?: string | null } | null;
      lastExerciseResult?: unknown;
    };
    const safeCtx = {
      activeTab: ctx.activeTab ?? null,
      lessonTitle: ctx.lessonTitle ?? null,
      activeDockTab: ctx.activeDockTab
        ? { title: ctx.activeDockTab.title ?? '', appId: ctx.activeDockTab.appId ?? null }
        : null,
      lastExerciseResult: ctx.lastExerciseResult ?? null,
    };
    parts.push(`Ngữ cảnh TheoLab hiện tại: ${JSON.stringify(safeCtx)}.`);
  }

  return parts.join('\n');
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errObj = body.error as { message?: string } | undefined;
    const message = errObj?.message ?? (body.message as string | undefined) ?? `Provider trả về HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

function resolveProviderKey(provider: TheonSettings['provider']): string {
  const vault = getCachedVault();
  if (provider === 'google') return vault.geminiApiKey || getApiKey('google') || '';
  if (provider === 'vertex') return vault.vertexApiKey || getApiKey('vertex') || '';
  return getApiKey(provider) || '';
}

async function callVertexWithTools(
  prompt: string,
  history: readonly TheonMessage[],
  settings: TheonSettings,
  system: string,
  handlers: TheonToolHandlers,
): Promise<string> {
  if (APP_MODE !== 'firebase_auth' || !isFirebaseConfigured()) {
    throw new Error('Vertex AI (Firebase AI Logic) yêu cầu chế độ firebase_auth và đã đăng nhập Gmail chủ sở hữu.');
  }

  const [{ initializeApp, getApps }, { getAI, getGenerativeModel, SchemaType, VertexAIBackend }] = await Promise.all([
    import('firebase/app'),
    import('firebase/ai'),
  ]);

  const vault = getCachedVault();
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  const ai = getAI(app, { backend: new VertexAIBackend(vault.vertexLocation || 'global') });
  const modelName = RETIRED_VERTEX_MODELS.test(settings.model) ? DEFAULT_VERTEX_MODEL : settings.model;

  const setExprSpec = THEON_TOOL_SPECS[0];
  const tools: import('firebase/ai').FunctionDeclarationsTool[] | undefined =
    settings.autoExpression && setExprSpec
      ? [
          {
            functionDeclarations: [
              {
                name: 'set_expression',
                description: setExprSpec.description,
                parameters: {
                  type: SchemaType.OBJECT as typeof SchemaType.OBJECT,
                  properties: {
                    expression: {
                      type: SchemaType.STRING as typeof SchemaType.STRING,
                      format: 'enum',
                      enum: [...THEON_EXPRESSIONS],
                      description: 'Biểu cảm khuôn mặt 3D của Theon.',
                    },
                    reason: {
                      type: SchemaType.STRING as typeof SchemaType.STRING,
                      description: 'Lý do ngắn gọn (tùy chọn).',
                    },
                  },
                  required: ['expression'],
                } as import('firebase/ai').ObjectSchemaInterface,
              },
            ],
          },
        ]
      : undefined;

  const model = getGenerativeModel(ai, {
    model: modelName || DEFAULT_VERTEX_MODEL,
    systemInstruction: system,
    generationConfig: { temperature: Math.max(0, Math.min(1.2, settings.temperature)) },
    ...(tools ? { tools } : {}),
  });

  const chatHistory = history.slice(-10).map((msg) => ({
    role: (msg.role === 'assistant' ? 'model' : 'user') as 'model' | 'user',
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({ history: chatHistory });
  let response = (await chat.sendMessage(prompt)).response;

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const calls = response.functionCalls?.();
    if (!calls || calls.length === 0) break;

    const toolResponses = calls.map((call) => {
      const outcome = executeTheonTool(call.name, call.args, handlers);
      return {
        functionResponse: {
          name: call.name,
          response: outcome.ok ? (outcome.result ?? { ok: true }) : { error: outcome.error },
        },
      };
    });

    const textSoFar = safeResponseText(response);
    if (textSoFar.trim()) return textSoFar.trim();
    response = (await chat.sendMessage(toolResponses)).response;
  }

  return safeResponseText(response).trim() || 'Theon chưa nhận được nội dung phản hồi.';
}

function safeResponseText(response: { text?: () => string }): string {
  try {
    return response.text?.() ?? '';
  } catch {
    return '';
  }
}

async function callGoogleStudioWithTools(
  prompt: string,
  history: readonly TheonMessage[],
  settings: TheonSettings,
  system: string,
  apiKey: string,
  handlers: TheonToolHandlers,
): Promise<string> {
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    ...history.slice(-10).map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    })),
    { role: 'user', parts: [{ text: prompt }] },
  ];

  const toolsPayload = settings.autoExpression
    ? [
        {
          functionDeclarations: THEON_TOOL_SPECS.map((spec) => ({
            name: spec.name,
            description: spec.description,
            parameters: spec.parameters,
          })),
        },
      ]
    : undefined;

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          ...(toolsPayload ? { tools: toolsPayload } : {}),
          generationConfig: { temperature: Math.max(0, Math.min(1.2, settings.temperature)) },
        }),
      },
    );

    const body = await readJsonResponse(response);
    const candidates = (body.candidates as Array<{ content?: { parts?: Array<Record<string, unknown>> } }>) ?? [];
    const parts = candidates[0]?.content?.parts ?? [];

    const textParts = parts
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('');
    const fnCalls = parts.filter((part) => part.functionCall && typeof part.functionCall === 'object');

    if (fnCalls.length === 0) {
      return textParts.trim() || 'Mô hình không trả về nội dung.';
    }

    const responseParts: Array<Record<string, unknown>> = [];
    for (const part of fnCalls) {
      const call = part.functionCall as { name: string; args?: unknown };
      const outcome = executeTheonTool(call.name, call.args, handlers);
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: outcome.ok ? (outcome.result ?? { ok: true }) : { error: outcome.error },
        },
      });
    }

    if (textParts.trim()) return textParts.trim();

    contents.push({ role: 'model', parts });
    contents.push({ role: 'user', parts: responseParts });
  }

  return 'Mô hình không trả về nội dung sau khi gọi hàm.';
}

async function callOpenAiCompatibleWithTools(
  endpoint: string,
  model: string,
  prompt: string,
  history: readonly TheonMessage[],
  settings: TheonSettings,
  system: string,
  apiKey: string,
  handlers: TheonToolHandlers,
): Promise<string> {
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: system },
    ...history.slice(-10).map((msg) => ({ role: msg.role, content: msg.content })),
    { role: 'user', content: prompt },
  ];

  const toolsPayload = settings.autoExpression
    ? THEON_TOOL_SPECS.map((spec) => ({
        type: 'function',
        function: {
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters,
        },
      }))
    : undefined;

  let allowTools = Boolean(toolsPayload);

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const requestBody: Record<string, unknown> = {
      model,
      temperature: Math.max(0, Math.min(1.2, settings.temperature)),
      messages,
    };
    if (allowTools && toolsPayload) {
      requestBody.tools = toolsPayload;
    }

    let response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    // Some custom OpenAI-compatible endpoints reject `tools`; retry cleanly without tools.
    if (!response.ok && allowTools && response.status === 400) {
      allowTools = false;
      delete requestBody.tools;
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
    }

    const body = await readJsonResponse(response);
    const choices = (body.choices as Array<{ message?: Record<string, unknown> }>) ?? [];
    const message = choices[0]?.message ?? {};
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length === 0) {
      return content || 'Mô hình không trả về nội dung.';
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls as Array<{ id?: string; function?: { name?: string; arguments?: string } }>) {
      const fnName = tc.function?.name ?? '';
      const outcome = executeTheonTool(fnName, tc.function?.arguments ?? '{}', handlers);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id ?? `call_${step}`,
        content: JSON.stringify(outcome.ok ? (outcome.result ?? { ok: true }) : { error: outcome.error }),
      });
    }

    if (content) return content;
  }

  return 'Mô hình không trả về nội dung.';
}

async function callAnthropicWithTools(
  prompt: string,
  history: readonly TheonMessage[],
  settings: TheonSettings,
  system: string,
  apiKey: string,
  handlers: TheonToolHandlers,
): Promise<string> {
  const messages: Array<{ role: string; content: unknown }> = [
    ...history.slice(-10).map((msg) => ({ role: msg.role, content: msg.content })),
    { role: 'user', content: prompt },
  ];

  const toolsPayload = settings.autoExpression
    ? THEON_TOOL_SPECS.map((spec) => ({
        name: spec.name,
        description: spec.description,
        input_schema: spec.parameters,
      }))
    : undefined;

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 1200,
        temperature: Math.max(0, Math.min(1, settings.temperature)),
        system,
        ...(toolsPayload ? { tools: toolsPayload } : {}),
        messages,
      }),
    });

    const body = await readJsonResponse(response);
    const blocks = Array.isArray(body.content) ? (body.content as Array<Record<string, unknown>>) : [];
    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n')
      .trim();
    const toolUses = blocks.filter((b) => b.type === 'tool_use');

    if (toolUses.length === 0) {
      return text || 'Mô hình không trả về nội dung.';
    }

    const toolResults: Array<Record<string, unknown>> = [];
    for (const block of toolUses) {
      const fnName = String(block.name ?? '');
      const outcome = executeTheonTool(fnName, block.input, handlers);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: String(block.id ?? ''),
        content: JSON.stringify(outcome.ok ? (outcome.result ?? { ok: true }) : { error: outcome.error }),
      });
    }

    if (text) return text;
    messages.push({ role: 'assistant', content: blocks });
    messages.push({ role: 'user', content: toolResults });
  }

  return 'Mô hình không trả về nội dung.';
}

/**
 * Runs one conversational turn with Theon using the model & provider
 * configured in the Theon Settings section.
 */
export async function runTheonTurn({
  prompt,
  history = [],
  settings,
  onExpression,
}: {
  prompt: string;
  history?: readonly TheonMessage[];
  settings: TheonSettings;
  onExpression?: (expr: TheonExpression) => void;
}): Promise<TheonTurnResult> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) {
    return { reply: '', expression: settings.defaultExpression, toolUsed: false };
  }

  const provider = settings.provider;
  const apiKey = resolveProviderKey(provider);
  if (provider !== 'vertex' && !apiKey) {
    throw new Error(`Chưa có API Key cho ${provider}. Hãy cấu hình khóa ở tab Cấu hình.`);
  }

  const system = buildSystemInstruction(settings);
  let chosenExpression: TheonExpression | null = null;
  let toolUsed = false;

  const handlers: TheonToolHandlers = {
    onSetExpression: (expr) => {
      chosenExpression = expr;
      toolUsed = true;
      onExpression?.(expr);
    },
  };

  let reply = '';
  if (provider === 'vertex') {
    reply = await callVertexWithTools(cleanPrompt, history, settings, system, handlers);
  } else if (provider === 'google') {
    reply = await callGoogleStudioWithTools(cleanPrompt, history, settings, system, apiKey, handlers);
  } else if (provider === 'openai') {
    reply = await callOpenAiCompatibleWithTools(
      'https://api.openai.com/v1/chat/completions',
      settings.model,
      cleanPrompt,
      history,
      settings,
      system,
      apiKey,
      handlers,
    );
  } else if (provider === 'openrouter') {
    reply = await callOpenAiCompatibleWithTools(
      'https://openrouter.ai/api/v1/chat/completions',
      settings.model,
      cleanPrompt,
      history,
      settings,
      system,
      apiKey,
      handlers,
    );
  } else if (provider === 'custom') {
    const endpoint = getLocalSetting('custom-endpoint', '');
    if (!endpoint) {
      throw new Error('Chưa nhập Custom endpoint trong tab Cấu hình.');
    }
    reply = await callOpenAiCompatibleWithTools(
      endpoint,
      settings.model,
      cleanPrompt,
      history,
      settings,
      system,
      apiKey,
      handlers,
    );
  } else if (provider === 'anthropic') {
    reply = await callAnthropicWithTools(cleanPrompt, history, settings, system, apiKey, handlers);
  } else {
    throw new Error(`Provider "${provider}" chưa được hỗ trợ.`);
  }

  const finalExpression: TheonExpression =
    chosenExpression ??
    (settings.autoExpression ? detectExpressionFromText(reply) : settings.defaultExpression);

  if (!chosenExpression) {
    onExpression?.(finalExpression);
  }

  return {
    reply,
    expression: finalExpression,
    toolUsed,
  };
}
