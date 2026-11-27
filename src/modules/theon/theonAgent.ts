/**
 * Theon the Multiagent runtime — multi-step tool-calling orchestrator
 * supporting Vertex AI, Google AI Studio, OpenAI, OpenRouter, Custom,
 * and Anthropic with dynamic tool schema translation.
 */
import { APP_MODE, firebaseConfig, isFirebaseConfigured } from '../../config/runtimeConfig.js';
import { getActiveContext } from '../../core/contextBus.js';
import { getLocalSetting } from '../../core/dataGateway.js';
import { getCachedVault } from '../../core/secretsVault';
import { aiConfigStore, resolveProviderApiKey } from '../../core/aiConfigStore.svelte';
import {
  BUILTIN_PROVIDER_CATALOG,
  isAllowedProviderBaseUrl,
  resolveOpenAiChatEndpoint,
} from '../../domain/ai/providerCatalog';
import { DEFAULT_VERTEX_MODEL, resolveVertexModelId } from '../../domain/ai/modelRegistry';
import { detectExpressionFromText } from './matrixText';
import {
  THEON_EXPRESSIONS,
  type TheonExpression,
  type TheonSettings,
} from './theonConfig';
import { formatEnabledSkillsCatalog } from './theonSkills';
import {
  executeTheonTool,
  getActiveTheonToolSpecs,
  type TheonToolHandlers,
  type TheonToolSpec,
} from './theonTools';

export interface TheonMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TheonTurnResult {
  reply: string;
  expression: TheonExpression;
  toolsCalled: string[];
}

const MAX_TOOL_STEPS = 6;

function buildSystemInstruction(settings: TheonSettings): string {
  const parts: string[] = [
    settings.systemPrompt.trim() ||
      'Bạn là Theon — hệ thống đa tác nhân học tập trong TheoLab. Trả lời bằng tiếng Việt ngắn gọn, rõ ràng.',
    `Biểu cảm hợp lệ cho hàm set_expression: ${THEON_EXPRESSIONS.join(', ')}.`,
    'Danh mục Skill đang bật (gọi `read_skill` để xem hướng dẫn chi tiết & mẫu JSON khi cần):',
    formatEnabledSkillsCatalog(settings.enabledSkills),
  ];

  if (settings.mcpEnabled && settings.mcpAllowedTools.length > 0) {
    parts.push(`Các công cụ MCP được phép gọi qua call_mcp_tool: ${settings.mcpAllowedTools.join(', ')}.`);
  }

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

function toVertexSchema(
  node: Record<string, unknown>,
  SchemaType: Record<string, string>,
): Record<string, unknown> {
  const rawType = String(node.type ?? 'string').toLowerCase();
  const typeMap: Record<string, string> = {
    object: SchemaType.OBJECT ?? 'object',
    array: SchemaType.ARRAY ?? 'array',
    string: SchemaType.STRING ?? 'string',
    number: SchemaType.NUMBER ?? 'number',
    integer: SchemaType.INTEGER ?? 'integer',
    boolean: SchemaType.BOOLEAN ?? 'boolean',
  };
  const out: Record<string, unknown> = {
    type: typeMap[rawType] ?? SchemaType.STRING ?? 'string',
  };
  if (typeof node.description === 'string') out.description = node.description;
  if (Array.isArray(node.enum)) {
    out.format = 'enum';
    out.enum = node.enum;
  }
  if (rawType === 'object' && node.properties && typeof node.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(node.properties as Record<string, Record<string, unknown>>)) {
      props[key] = toVertexSchema(val, SchemaType);
    }
    out.properties = props;
    if (Array.isArray(node.required) && node.required.length > 0) {
      out.required = node.required;
    }
  }
  if (rawType === 'array' && node.items && typeof node.items === 'object') {
    out.items = toVertexSchema(node.items as Record<string, unknown>, SchemaType);
  }
  return out;
}

function safeResponseText(response: { text?: () => string }): string {
  try {
    return response.text?.() ?? '';
  } catch {
    return '';
  }
}

async function callVertexWithTools(
  prompt: string,
  history: readonly TheonMessage[],
  settings: TheonSettings,
  system: string,
  toolSpecs: readonly TheonToolSpec[],
  handlers: TheonToolHandlers,
  toolsCalled: string[],
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
  const modelName = resolveVertexModelId(settings.model || DEFAULT_VERTEX_MODEL);

  const tools: import('firebase/ai').FunctionDeclarationsTool[] | undefined = toolSpecs.length
    ? [
        {
          functionDeclarations: toolSpecs.map((spec) => ({
            name: spec.name,
            description: spec.description,
            parameters: toVertexSchema(
              spec.parameters as unknown as Record<string, unknown>,
              SchemaType as unknown as Record<string, string>,
            ) as unknown as import('firebase/ai').ObjectSchemaInterface,
          })),
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

    const toolResponses = [];
    for (const call of calls) {
      toolsCalled.push(call.name);
      const outcome = await executeTheonTool(call.name, call.args, handlers);
      toolResponses.push({
        functionResponse: {
          name: call.name,
          response: outcome.ok ? (outcome.result ?? { ok: true }) : { error: outcome.error },
        },
      });
    }

    response = (await chat.sendMessage(toolResponses)).response;
  }

  return safeResponseText(response).trim() || 'Theon đã hoàn tất tác vụ.';
}

async function callGoogleStudioWithTools(
  prompt: string,
  history: readonly TheonMessage[],
  settings: TheonSettings,
  system: string,
  apiKey: string,
  toolSpecs: readonly TheonToolSpec[],
  handlers: TheonToolHandlers,
  toolsCalled: string[],
): Promise<string> {
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    ...history.slice(-10).map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    })),
    { role: 'user', parts: [{ text: prompt }] },
  ];

  const toolsPayload = toolSpecs.length
    ? [
        {
          functionDeclarations: toolSpecs.map((spec) => ({
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
      return textParts.trim() || 'Theon đã hoàn tất tác vụ.';
    }

    const responseParts: Array<Record<string, unknown>> = [];
    for (const part of fnCalls) {
      const call = part.functionCall as { name: string; args?: unknown };
      toolsCalled.push(call.name);
      const outcome = await executeTheonTool(call.name, call.args, handlers);
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: outcome.ok ? (outcome.result ?? { ok: true }) : { error: outcome.error },
        },
      });
    }

    contents.push({ role: 'model', parts });
    contents.push({ role: 'user', parts: responseParts });
  }

  return 'Theon đã hoàn tất các bước xử lý.';
}

async function callOpenAiCompatibleWithTools(
  endpoint: string,
  model: string,
  prompt: string,
  history: readonly TheonMessage[],
  settings: TheonSettings,
  system: string,
  apiKey: string,
  toolSpecs: readonly TheonToolSpec[],
  handlers: TheonToolHandlers,
  toolsCalled: string[],
): Promise<string> {
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: system },
    ...history.slice(-10).map((msg) => ({ role: msg.role, content: msg.content })),
    { role: 'user', content: prompt },
  ];

  const toolsPayload = toolSpecs.length
    ? toolSpecs.map((spec) => ({
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

    const openAiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) openAiHeaders.Authorization = `Bearer ${apiKey}`;

    let response = await fetch(endpoint, {
      method: 'POST',
      headers: openAiHeaders,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok && allowTools && response.status === 400) {
      allowTools = false;
      delete requestBody.tools;
      response = await fetch(endpoint, {
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify(requestBody),
      });
    }

    const body = await readJsonResponse(response);
    const choices = (body.choices as Array<{ message?: Record<string, unknown> }>) ?? [];
    const message = choices[0]?.message ?? {};
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length === 0) {
      return content || 'Theon đã hoàn tất tác vụ.';
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls as Array<{ id?: string; function?: { name?: string; arguments?: string } }>) {
      const fnName = tc.function?.name ?? '';
      toolsCalled.push(fnName);
      const outcome = await executeTheonTool(fnName, tc.function?.arguments ?? '{}', handlers);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id ?? `call_${step}`,
        content: JSON.stringify(outcome.ok ? (outcome.result ?? { ok: true }) : { error: outcome.error }),
      });
    }
  }

  return 'Theon đã hoàn tất các bước xử lý.';
}

async function callAnthropicWithTools(
  prompt: string,
  history: readonly TheonMessage[],
  settings: TheonSettings,
  system: string,
  apiKey: string,
  toolSpecs: readonly TheonToolSpec[],
  handlers: TheonToolHandlers,
  toolsCalled: string[],
): Promise<string> {
  const messages: Array<{ role: string; content: unknown }> = [
    ...history.slice(-10).map((msg) => ({ role: msg.role, content: msg.content })),
    { role: 'user', content: prompt },
  ];

  const toolsPayload = toolSpecs.length
    ? toolSpecs.map((spec) => ({
        name: spec.name,
        description: spec.description,
        input_schema: spec.parameters,
      }))
    : undefined;

  const maxTokens = Math.max(64, Math.min(128_000, Math.round(aiConfigStore.defaults.maxTokens || 2048)));

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
        max_tokens: maxTokens,
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
      return text || 'Theon đã hoàn tất tác vụ.';
    }

    const toolResults: Array<Record<string, unknown>> = [];
    for (const block of toolUses) {
      const fnName = String(block.name ?? '');
      toolsCalled.push(fnName);
      const outcome = await executeTheonTool(fnName, block.input, handlers);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: String(block.id ?? ''),
        content: JSON.stringify(outcome.ok ? (outcome.result ?? { ok: true }) : { error: outcome.error }),
      });
    }

    messages.push({ role: 'assistant', content: blocks });
    messages.push({ role: 'user', content: toolResults });
  }

  return 'Theon đã hoàn tất các bước xử lý.';
}

export async function runTheonTurn({
  prompt,
  history = [],
  settings,
  handlers: extraHandlers,
}: {
  prompt: string;
  history?: readonly TheonMessage[];
  settings: TheonSettings;
  handlers: Omit<TheonToolHandlers, 'settings'>;
}): Promise<TheonTurnResult> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) {
    return { reply: '', expression: settings.defaultExpression, toolsCalled: [] };
  }

  const provider = settings.provider;
  const providerConfig = aiConfigStore.getProvider(provider);
  const builtinMeta = BUILTIN_PROVIDER_CATALOG[provider as keyof typeof BUILTIN_PROVIDER_CATALOG];
  const kind = providerConfig?.kind ?? builtinMeta?.kind ?? (provider.startsWith('custom') ? 'openai-compatible' : null);

  if (!kind) {
    throw new Error(`Provider "${provider}" chưa được hỗ trợ.`);
  }

  const apiKey = resolveProviderApiKey(provider);
  const keyOptional = Boolean(providerConfig?.isCustom || provider === 'custom' || provider.startsWith('custom-'));
  if (kind !== 'vertex' && !keyOptional && !apiKey) {
    throw new Error(`Chưa có API Key cho ${providerConfig?.label ?? provider}. Hãy cấu hình khóa ở tab Cấu hình.`);
  }

  const system = buildSystemInstruction(settings);
  const toolSpecs = getActiveTheonToolSpecs(settings);
  const toolsCalled: string[] = [];
  let chosenExpression: TheonExpression | null = null;

  const handlers: TheonToolHandlers = {
    ...extraHandlers,
    settings,
    onSetExpression: (expr, reason) => {
      chosenExpression = expr;
      extraHandlers.onSetExpression(expr, reason);
    },
  };

  let reply = '';
  if (kind === 'vertex') {
    reply = await callVertexWithTools(cleanPrompt, history, settings, system, toolSpecs, handlers, toolsCalled);
  } else if (kind === 'google') {
    reply = await callGoogleStudioWithTools(
      cleanPrompt,
      history,
      settings,
      system,
      apiKey,
      toolSpecs,
      handlers,
      toolsCalled,
    );
  } else if (kind === 'anthropic') {
    reply = await callAnthropicWithTools(
      cleanPrompt,
      history,
      settings,
      system,
      apiKey,
      toolSpecs,
      handlers,
      toolsCalled,
    );
  } else if (kind === 'openai-compatible') {
    const baseUrl =
      providerConfig?.baseUrl ||
      builtinMeta?.defaultBaseUrl ||
      (provider === 'custom' ? getLocalSetting('custom-endpoint', '') : '');
    if (!baseUrl || !isAllowedProviderBaseUrl(baseUrl)) {
      throw new Error(`Chưa nhập Base URL hợp lệ cho ${providerConfig?.label ?? provider} trong tab Cấu hình.`);
    }
    reply = await callOpenAiCompatibleWithTools(
      resolveOpenAiChatEndpoint(baseUrl),
      settings.model,
      cleanPrompt,
      history,
      settings,
      system,
      apiKey,
      toolSpecs,
      handlers,
      toolsCalled,
    );
  } else {
    throw new Error(`Provider "${provider}" chưa được hỗ trợ.`);
  }

  const finalExpression: TheonExpression =
    chosenExpression ??
    (settings.autoExpression ? detectExpressionFromText(reply) : settings.defaultExpression);

  if (!chosenExpression) {
    extraHandlers.onSetExpression(finalExpression);
  }

  return {
    reply,
    expression: finalExpression,
    toolsCalled,
  };
}
