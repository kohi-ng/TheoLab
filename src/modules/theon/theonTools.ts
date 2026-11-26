/**
 * Zod-validated Multiagent Tool Registry & async executor for Theon.
 *
 * Capabilities:
 * - `set_expression`: AI selects Theon's 3D facial expression
 * - `read_skill`: loads full operational instructions & JSON specs for an enabled skill
 * - `get_active_context`: reads active TheoLab lesson, dock tab, and last exercise score
 * - `search_kb`: searches Vector KB (Gemini Embedding + Vietnamese BM25 RRF) & Library catalog
 * - `spawn_book`: crystallizes a clickable 3D Book in Theon's box linked to a lesson/doc
 * - `spawn_tag`: crystallizes a clickable 3D Tag/Note card in Theon's box
 * - `open_exercise_tab`: validates JSON via Zod and opens an interactive Exercise Tab in WorkspaceDock
 * - `open_app_tab`: opens a STEM / Google Workspace app in WorkspaceDock
 * - `show_3d_graph`: shows/hides the pinned 3D graph inside Theon's box
 * - `clear_objects`: clears spawned 3D objects from Theon's box
 * - `call_mcp_tool`: invokes an allowlisted MCP tool when MCP bridge is enabled in Theon Settings
 */
import { z } from 'zod';
import { getActiveContext } from '../../core/contextBus.js';
import { getLocalSetting } from '../../core/dataGateway.js';
import { searchKnowledgeBase } from '../kb/kbService';
import { LIBRARY_DOCUMENTS } from '../library/libraryCatalog.js';
import { findAppDefinition, isAllowedAppUrl } from '../apps/appCatalog';
import { postMcpMessage } from '../agents/mcp/mcpClient.js';
import { ExerciseTabPayloadSchema, type ExerciseTabPayload } from './exerciseSchema';
import {
  CHART_TYPES,
  DrawChartArgsSchema,
  normalizeChartSpec,
  type NormalizedChartSpec,
} from './chartSchema';
import { THEON_EXPRESSIONS, type TheonExpression, type TheonSettings } from './theonConfig';
import { findTheonSkill, THEON_SKILL_IDS } from './theonSkills';
import type {
  SpawnBookOptions,
  SpawnNoteCardOptions,
  TheonObjectActionMeta,
} from './theonEngine.js';

const DeepLinkSchema = z
  .string()
  .regex(/^#\/[a-z0-9/_#-]+$/i, 'deep_link phải có dạng #/subject/chapter/unit/tab')
  .max(240);

export const SetExpressionArgsSchema = z.object({
  expression: z.enum(THEON_EXPRESSIONS),
  reason: z.string().max(200).optional(),
});

export const ReadSkillArgsSchema = z.object({
  skill_id: z.enum(THEON_SKILL_IDS),
});

export const SearchKbArgsSchema = z.object({
  query: z.string().min(1).max(300),
  k: z.number().int().min(1).max(10).default(5),
  subject_id: z.string().max(80).optional(),
});

export const SpawnBookArgsSchema = z.object({
  title: z.string().min(1).max(80),
  subtitle: z.string().max(80).optional(),
  summary: z.string().max(240).optional(),
  deep_link: DeepLinkSchema.optional(),
  url: z.string().max(500).optional(),
  app_id: z.string().max(40).optional(),
});

export const SpawnTagArgsSchema = z.object({
  label: z.string().min(1).max(64),
  tag: z.string().max(32).optional(),
  description: z.string().max(180).optional(),
  deep_link: DeepLinkSchema.optional(),
  url: z.string().max(500).optional(),
  app_id: z.string().max(40).optional(),
  open_formula: z.boolean().optional(),
});

export const OpenExerciseTabArgsSchema = ExerciseTabPayloadSchema.extend({
  also_spawn_tag: z.boolean().default(true),
});

export const OpenAppTabArgsSchema = z.object({
  app_id: z.string().min(1).max(40),
  title: z.string().max(64).optional(),
  url: z.string().max(500).optional(),
});

export const CallMcpToolArgsSchema = z.object({
  tool_name: z.string().min(1).max(80),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export interface TheonToolSpec {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

const CORE_TOOL_SPECS: readonly TheonToolSpec[] = Object.freeze([
  {
    name: 'set_expression',
    description:
      'Chọn biểu cảm khuôn mặt 3D cho Theon sao cho phù hợp với sắc thái câu trả lời.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          enum: [...THEON_EXPRESSIONS],
          description:
            'friendly (thân thiện), focused (tập trung), thoughtful (suy tư), surprised (ngạc nhiên), happy (vui vẻ), serious (nghiêm túc), relaxed (thư giãn).',
        },
        reason: { type: 'string', description: 'Lý do ngắn gọn (tùy chọn).' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'read_skill',
    description:
      'Đọc hướng dẫn chi tiết và định dạng JSON của một skill chuyên biệt (kb_librarian, exercise_architect, study_coach, app_launcher) trước khi thực hiện tác vụ phức tạp.',
    parameters: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          enum: [...THEON_SKILL_IDS],
          description: 'Mã skill cần đọc hướng dẫn.',
        },
      },
      required: ['skill_id'],
    },
  },
  {
    name: 'get_active_context',
    description:
      'Đọc ngữ cảnh TheoLab hiện tại: bài học đang mở, tab đang hoạt động, ứng dụng bên khung phải và kết quả làm bài tập gần nhất.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_kb',
    description:
      'Truy cứu Kho Vector Embedding + BM25 và Thư viện tài liệu của TheoLab để tìm bài học, khái niệm, công thức và deep_link chính xác.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Từ khóa hoặc câu hỏi cần tra cứu.' },
        k: { type: 'integer', description: 'Số lượng kết quả tối đa (1-10, mặc định 5).' },
        subject_id: { type: 'string', description: 'Lọc theo mã môn học (tùy chọn).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'spawn_book',
    description:
      'Kết tinh một Cuốn sách 3D lơ lửng trong hộp Theon đại diện cho bài học/tài liệu tìm được. Khi người dùng nhấn vào sách, TheoLab sẽ mở ngay liên kết đó.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tên cuốn sách / tài liệu ngắn gọn.' },
        subtitle: { type: 'string', description: 'Đường dẫn môn/chương hoặc nguồn ngắn.' },
        summary: { type: 'string', description: 'Tóm tắt ngắn (tùy chọn).' },
        deep_link: { type: 'string', description: 'Deep link TheoLab dạng #/mon/chuong/bai/tab lấy từ search_kb.' },
        url: { type: 'string', description: 'Liên kết HTTPS hợp lệ nếu là tài liệu ngoài/Drive.' },
        app_id: { type: 'string', description: 'Mã ứng dụng TheoLab nếu muốn mở ứng dụng.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'spawn_tag',
    description:
      'Kết tinh một Thẻ vật thể / Thẻ ghi chú 3D trong hộp Theon để người dùng nhấn vào mở nhanh bài học, Formula Hub, ứng dụng STEM hoặc ghi nhớ công thức.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Nhãn hiển thị của thẻ.' },
        tag: { type: 'string', description: 'Tiêu đề ngắn trên thanh thẻ (VD: CÔNG THỨC, KHÁI NIỆM).' },
        description: { type: 'string', description: 'Nội dung ngắn hiển thị lên mặt thẻ.' },
        deep_link: { type: 'string', description: 'Deep link TheoLab dạng #/… (tùy chọn).' },
        url: { type: 'string', description: 'Liên kết HTTPS hợp lệ (tùy chọn).' },
        app_id: { type: 'string', description: 'Mã ứng dụng TheoLab (desmos, ketcher, jupyterlite…).' },
        open_formula: { type: 'boolean', description: 'Đặt true nếu nhấn thẻ sẽ mở Formula Hub.' },
      },
      required: ['label'],
    },
  },
  {
    name: 'open_exercise_tab',
    description:
      'Truyền JSON bộ câu hỏi (trắc nghiệm mcq và/hoặc điền số numeric) để mở ngay một Tab làm bài tập tương tác có chấm điểm & đếm ngược ở khung phải.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tên tab bài tập.' },
        subtitle: { type: 'string', description: 'Mô tả hoặc hướng dẫn ngắn.' },
        time_limit_sec: { type: 'integer', description: 'Giới hạn thời gian tính bằng giây (0 hoặc bỏ qua nếu không giới hạn).' },
        also_spawn_tag: { type: 'boolean', description: 'Đồng thời tạo thẻ 3D bài tập trong hộp Theon (mặc định true).' },
        items: {
          type: 'array',
          description: 'Danh sách 1-20 câu hỏi dạng mcq hoặc numeric.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['mcq', 'numeric'] },
              question: { type: 'string', description: 'Nội dung câu hỏi (dùng cho mcq).' },
              options: {
                type: 'array',
                description: 'Danh sách lựa chọn (2-6 đáp án, dùng cho mcq).',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    feedback: { type: 'string' },
                  },
                  required: ['text'],
                },
              },
              prompt: { type: 'string', description: 'Đề bài điền số (dùng cho numeric).' },
              answer: { type: 'number', description: 'Chỉ số đáp án đúng 0-based (mcq) hoặc giá trị số đúng (numeric).' },
              tolerance: { type: 'number', description: 'Sai số tuyệt đối cho phép (numeric).' },
              unit: { type: 'string', description: 'Đơn vị đo (numeric, VD: mL, M, pH).' },
              explanation: { type: 'string', description: 'Giải thích ngắn sau khi chấm điểm.' },
            },
            required: ['type', 'answer'],
          },
        },
      },
      required: ['title', 'items'],
    },
  },
  {
    name: 'open_app_tab',
    description:
      'Mở một ứng dụng học tập (desmos, desmos-scientific, desmos-3d, ketcher, jupyterlite, geogebra, molview, excalidraw, google-docs, google-sheets, google-calendar) ở khung phải.',
    parameters: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'Mã ứng dụng trong danh mục TheoLab.' },
        title: { type: 'string', description: 'Tên tab tùy chọn.' },
        url: { type: 'string', description: 'URL tài liệu HTTPS tùy chọn.' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'draw_chart',
    description:
      'Vẽ biểu đồ dữ liệu trực tiếp lên màn hình kính khung hộp Theon với hiệu ứng kết tinh ma trận (hỗ trợ: line, bar, dual_axis, pie, donut, scatter, area). Truyền visible=false để ẩn biểu đồ.',
    parameters: {
      type: 'object',
      properties: {
        visible: { type: 'boolean', description: 'true để vẽ/cập nhật biểu đồ, false để ẩn khỏi màn hình hộp.' },
        chart_type: {
          type: 'string',
          enum: [...CHART_TYPES],
          description: 'Loại biểu đồ: line (đường), bar (cột), dual_axis (hai trục Y trái/phải), pie (tròn), donut (vành khuyên), scatter (phân tán x-y), area (miền).',
        },
        title: { type: 'string', description: 'Tiêu đề biểu đồ.' },
        subtitle: { type: 'string', description: 'Phụ đề hoặc nguồn dữ liệu (tùy chọn).' },
        x_label: { type: 'string', description: 'Nhãn trục ngang X.' },
        y_label: { type: 'string', description: 'Nhãn trục tung trái Y.' },
        y2_label: { type: 'string', description: 'Nhãn trục tung phải Y2 (dùng cho dual_axis).' },
        labels: {
          type: 'array',
          description: 'Nhãn các mốc trên trục X (cho line, bar, area, dual_axis) hoặc nhãn các phần (pie/donut).',
          items: { type: 'string' },
        },
        series: {
          type: 'array',
          description: 'Các chuỗi dữ liệu số (1-6 chuỗi). Với dual_axis, đặt axis="left" cho trục trái và axis="right" cho trục phải; có thể trộn kind="bar" và kind="line".',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Tên chuỗi hiển thị trong chú giải.' },
              kind: { type: 'string', enum: ['line', 'bar', 'area', 'scatter'], description: 'Kiểu vẽ riêng của chuỗi.' },
              axis: { type: 'string', enum: ['left', 'right'], description: 'Trục tung gắn với chuỗi (mặc định left).' },
              color: { type: 'string', description: 'Mã màu hex tùy chọn (VD: #60a5fa).' },
              values: { type: 'array', items: { type: 'number' }, description: 'Dãy giá trị Y theo thứ tự labels.' },
              points: {
                type: 'array',
                description: 'Danh sách cặp tọa độ { x, y } cho scatter hoặc đường hàm số.',
                items: {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                    label: { type: 'string' },
                  },
                  required: ['x', 'y'],
                },
              },
            },
            required: ['name'],
          },
        },
        slices: {
          type: 'array',
          description: 'Các lát của biểu đồ tròn/vành khuyên (pie/donut).',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'number' },
              color: { type: 'string' },
            },
            required: ['label', 'value'],
          },
        },
        show_grid: { type: 'boolean', description: 'Hiện lưới tọa độ (mặc định true).' },
        show_values: { type: 'boolean', description: 'Hiện nhãn số liệu trực tiếp trên cột/lát.' },
      },
      required: ['visible'],
    },
  },
  {
    name: 'clear_objects',
    description: 'Dọn sạch các cuốn sách, thẻ 3D và biểu đồ đang hiển thị trong hộp Theon.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
]);

const MCP_TOOL_SPEC: TheonToolSpec = Object.freeze({
  name: 'call_mcp_tool',
  description: 'Gọi một công cụ MCP nằm trong danh sách cho phép (allowlist) đã cấu hình ở tab Cấu hình.',
  parameters: {
    type: 'object' as const,
    properties: {
      tool_name: { type: 'string', description: 'Tên công cụ MCP được allowlist.' },
      arguments: { type: 'object', description: 'Đối số JSON truyền cho công cụ MCP.' },
    },
    required: ['tool_name'],
  },
});

export function getActiveTheonToolSpecs(settings: TheonSettings): readonly TheonToolSpec[] {
  const specs: TheonToolSpec[] = [];
  for (const spec of CORE_TOOL_SPECS) {
    if (spec.name === 'set_expression' && !settings.autoExpression) continue;
    specs.push(spec);
  }
  if (settings.mcpEnabled && settings.mcpAllowedTools.length > 0) {
    specs.push(MCP_TOOL_SPEC);
  }
  return specs;
}

export const THEON_TOOL_SPECS = CORE_TOOL_SPECS;

export interface TheonToolHandlers {
  settings?: TheonSettings;
  onStep?: (statusLine: string) => void;
  onSetExpression: (expression: TheonExpression, reason?: string) => void;
  onSpawnBook?: (options: SpawnBookOptions) => void;
  onSpawnTag?: (options: SpawnNoteCardOptions) => void;
  onOpenExerciseTab?: (payload: ExerciseTabPayload) => { tabId: string; title: string } | void;
  onOpenAppTab?: (appId: string, options?: { title?: string; url?: string }) => boolean | void;
  onDrawChart?: (spec: NormalizedChartSpec | null) => void;
  onClearObjects?: () => void;
}

export interface TheonToolExecutionResult {
  ok: boolean;
  tool: string;
  result?: Record<string, unknown>;
  error?: string;
}

function buildActionMetaFromLinkFields(fields: {
  deep_link?: string;
  url?: string;
  app_id?: string;
  open_formula?: boolean;
  title?: string;
}): TheonObjectActionMeta | null {
  if (fields.deep_link) {
    return { kind: 'deep-link', deepLink: fields.deep_link, title: fields.title };
  }
  if (fields.open_formula) {
    return { kind: 'formula', title: fields.title || 'Formula Hub' };
  }
  if (fields.app_id && findAppDefinition(fields.app_id)) {
    return {
      kind: 'app',
      appId: fields.app_id,
      title: fields.title,
      url: fields.url && isAllowedAppUrl(fields.url) ? fields.url : undefined,
    };
  }
  if (fields.url && isAllowedAppUrl(fields.url)) {
    return { kind: 'url', url: fields.url, title: fields.title };
  }
  return null;
}

function searchLocalLibraryCatalog(query: string) {
  const q = query.trim().toLocaleLowerCase('vi');
  if (!q) return [];
  return LIBRARY_DOCUMENTS.filter((doc) => {
    const hay = `${doc.title} ${doc.sourceLabel ?? ''} ${doc.category ?? ''}`.toLocaleLowerCase('vi');
    return q.split(/\s+/).some((tok) => tok.length >= 2 && hay.includes(tok));
  })
    .slice(0, 4)
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      type: doc.type,
      source: doc.sourceLabel ?? 'Thư viện TheoLab',
      url: doc.url && isAllowedAppUrl(doc.url) ? doc.url : undefined,
      open_formula: doc.type === 'formula' ? true : undefined,
    }));
}

export async function executeTheonTool(
  name: string,
  rawArgs: unknown,
  handlers: TheonToolHandlers,
): Promise<TheonToolExecutionResult> {
  let parsedInput: unknown = rawArgs;
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    if (!trimmed) {
      parsedInput = {};
    } else {
      try {
        parsedInput = JSON.parse(trimmed);
      } catch {
        return { ok: false, tool: name, error: 'Tham số JSON không hợp lệ.' };
      }
    }
  }
  if (parsedInput === null || parsedInput === undefined) parsedInput = {};

  if (name === 'set_expression') {
    const parsed = SetExpressionArgsSchema.safeParse(parsedInput);
    if (!parsed.success) {
      return {
        ok: false,
        tool: name,
        error: `Biểu cảm không hợp lệ. Chỉ chấp nhận: ${THEON_EXPRESSIONS.join(', ')}.`,
      };
    }
    handlers.onSetExpression(parsed.data.expression, parsed.data.reason);
    return { ok: true, tool: name, result: { expression: parsed.data.expression } };
  }

  if (name === 'read_skill') {
    const parsed = ReadSkillArgsSchema.safeParse(parsedInput);
    if (!parsed.success) {
      return { ok: false, tool: name, error: `skill_id không hợp lệ. Hỗ trợ: ${THEON_SKILL_IDS.join(', ')}.` };
    }
    const enabled = handlers.settings?.enabledSkills ?? [...THEON_SKILL_IDS];
    if (!enabled.includes(parsed.data.skill_id)) {
      return { ok: false, tool: name, error: `Skill "${parsed.data.skill_id}" đang bị tắt trong tab Cấu hình.` };
    }
    const skill = findTheonSkill(parsed.data.skill_id);
    if (!skill) {
      return { ok: false, tool: name, error: `Không tìm thấy skill "${parsed.data.skill_id}".` };
    }
    handlers.onStep?.(`THEON // ĐANG ĐỌC SKILL ${skill.id.toUpperCase()}...`);
    return {
      ok: true,
      tool: name,
      result: {
        id: skill.id,
        name: skill.name,
        recommendedTools: skill.recommendedTools,
        instructions: skill.instructions,
      },
    };
  }

  if (name === 'get_active_context') {
    handlers.onStep?.('THEON // ĐANG ĐỌC NGỮ CẢNH THEOLAB...');
    const ctx = getActiveContext() as Record<string, unknown>;
    return { ok: true, tool: name, result: { context: ctx } };
  }

  if (name === 'search_kb') {
    const parsed = SearchKbArgsSchema.safeParse(parsedInput);
    if (!parsed.success) {
      return { ok: false, tool: name, error: 'Truy vấn search_kb cần trường query không rỗng.' };
    }
    handlers.onStep?.('THEON // ĐANG TRA CỨU VECTOR EMBEDDING...');
    try {
      const kb = await searchKnowledgeBase(parsed.data.query, {
        k: parsed.data.k,
        filters: parsed.data.subject_id ? { subject_id: parsed.data.subject_id } : undefined,
      });
      const libraryMatches = searchLocalLibraryCatalog(parsed.data.query);
      return {
        ok: true,
        tool: name,
        result: {
          mode: kb.mode,
          vector_results: kb.hits.map((hit) => ({
            title: hit.title,
            breadcrumb: hit.breadcrumb,
            snippet: hit.snippet.slice(0, 260),
            deep_link: hit.deep_link,
            source: hit.source,
            score: Number(hit.score.toFixed(4)),
          })),
          library_matches: libraryMatches,
        },
      };
    } catch (error) {
      const libraryMatches = searchLocalLibraryCatalog(parsed.data.query);
      return {
        ok: true,
        tool: name,
        result: {
          mode: 'fallback',
          warning: error instanceof Error ? error.message : 'Chưa tải được Kho Vector.',
          vector_results: [],
          library_matches: libraryMatches,
        },
      };
    }
  }

  if (name === 'spawn_book') {
    const parsed = SpawnBookArgsSchema.safeParse(parsedInput);
    if (!parsed.success) {
      return { ok: false, tool: name, error: `Tham số spawn_book không hợp lệ: ${parsed.error.issues[0]?.message ?? ''}` };
    }
    if (parsed.data.url && !isAllowedAppUrl(parsed.data.url)) {
      return { ok: false, tool: name, error: 'URL sách phải dùng giao thức https:// hợp lệ.' };
    }
    const actionMeta = buildActionMetaFromLinkFields({
      deep_link: parsed.data.deep_link,
      url: parsed.data.url,
      app_id: parsed.data.app_id,
      title: parsed.data.title,
    });
    handlers.onStep?.(`THEON // KẾT TINH SÁCH: ${parsed.data.title.toUpperCase()}...`);
    handlers.onSpawnBook?.({
      title: parsed.data.title,
      subtitle: parsed.data.subtitle ?? parsed.data.summary ?? 'THEOLAB ARCHIVE',
      code: actionMeta ? 'NHẤN ĐỂ MỞ' : 'THEON BOOK',
      actionMeta,
    });
    return {
      ok: true,
      tool: name,
      result: {
        spawned: true,
        title: parsed.data.title,
        clickable: Boolean(actionMeta),
      },
    };
  }

  if (name === 'spawn_tag') {
    const parsed = SpawnTagArgsSchema.safeParse(parsedInput);
    if (!parsed.success) {
      return { ok: false, tool: name, error: `Tham số spawn_tag không hợp lệ: ${parsed.error.issues[0]?.message ?? ''}` };
    }
    if (parsed.data.url && !isAllowedAppUrl(parsed.data.url)) {
      return { ok: false, tool: name, error: 'URL thẻ phải dùng giao thức https:// hợp lệ.' };
    }
    const actionMeta = buildActionMetaFromLinkFields({
      deep_link: parsed.data.deep_link,
      url: parsed.data.url,
      app_id: parsed.data.app_id,
      open_formula: parsed.data.open_formula,
      title: parsed.data.label,
    });
    handlers.onStep?.(`THEON // KẾT TINH THẺ: ${parsed.data.label.toUpperCase()}...`);
    handlers.onSpawnTag?.({
      label: parsed.data.label,
      tag: parsed.data.tag || 'THEON // TAG',
      text: parsed.data.description || parsed.data.label,
      actionMeta,
    });
    return {
      ok: true,
      tool: name,
      result: {
        spawned: true,
        label: parsed.data.label,
        clickable: Boolean(actionMeta),
      },
    };
  }

  if (name === 'open_exercise_tab') {
    const parsed = OpenExerciseTabArgsSchema.safeParse(parsedInput);
    if (!parsed.success) {
      return {
        ok: false,
        tool: name,
        error: `JSON bài tập không hợp lệ: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      };
    }
    const { also_spawn_tag, ...payload } = parsed.data;
    handlers.onStep?.(`THEON // ĐANG TẠO TAB BÀI TẬP: ${payload.title.toUpperCase()}...`);
    const opened = handlers.onOpenExerciseTab?.(payload);
    if (also_spawn_tag) {
      handlers.onSpawnTag?.({
        label: payload.title,
        tag: `BÀI TẬP // ${payload.items.length} CÂU`,
        text: payload.subtitle || `Nhấn để mở lại bộ ${payload.items.length} câu hỏi.`,
        actionMeta: { kind: 'exercise', payload },
      });
    }
    return {
      ok: true,
      tool: name,
      result: {
        opened: true,
        title: payload.title,
        itemCount: payload.items.length,
        tabId: opened && 'tabId' in opened ? opened.tabId : undefined,
      },
    };
  }

  if (name === 'open_app_tab') {
    const parsed = OpenAppTabArgsSchema.safeParse(parsedInput);
    if (!parsed.success) {
      return { ok: false, tool: name, error: 'Cần cung cấp app_id hợp lệ.' };
    }
    const def = findAppDefinition(parsed.data.app_id);
    if (!def || def.id === 'theon') {
      return { ok: false, tool: name, error: `Ứng dụng "${parsed.data.app_id}" không tồn tại trong danh mục.` };
    }
    if (parsed.data.url && !isAllowedAppUrl(parsed.data.url)) {
      return { ok: false, tool: name, error: 'URL ứng dụng không hợp lệ.' };
    }
    handlers.onStep?.(`THEON // ĐANG MỞ ỨNG DỤNG ${def.shortName.toUpperCase()}...`);
    handlers.onOpenAppTab?.(def.id, { title: parsed.data.title, url: parsed.data.url });
    return { ok: true, tool: name, result: { opened: true, appId: def.id, name: def.name } };
  }

  if (name === 'draw_chart') {
    const parsed = DrawChartArgsSchema.safeParse(parsedInput);
    if (!parsed.success) {
      return {
        ok: false,
        tool: name,
        error: `Tham số draw_chart không hợp lệ: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      };
    }
    if (!parsed.data.visible) {
      handlers.onStep?.('THEON // ĐANG ẨN BIỂU ĐỒ...');
      handlers.onDrawChart?.(null);
      return { ok: true, tool: name, result: { visible: false } };
    }
    const normalized = normalizeChartSpec(parsed.data);
    if (!normalized) {
      return { ok: false, tool: name, error: 'Không thể chuẩn hóa dữ liệu biểu đồ.' };
    }
    handlers.onStep?.(`THEON // KẾT TINH BIỂU ĐỒ ${normalized.chartType.toUpperCase()}...`);
    handlers.onDrawChart?.(normalized);
    return {
      ok: true,
      tool: name,
      result: {
        visible: true,
        chart_type: normalized.chartType,
        title: normalized.title,
        seriesCount: normalized.series.length,
        sliceCount: normalized.slices.length,
      },
    };
  }

  if (name === 'clear_objects') {
    handlers.onStep?.('THEON // ĐANG DỌN VẬT THỂ 3D...');
    handlers.onClearObjects?.();
    return { ok: true, tool: name, result: { cleared: true } };
  }

  if (name === 'call_mcp_tool') {
    const parsed = CallMcpToolArgsSchema.safeParse(parsedInput);
    if (!parsed.success) {
      return { ok: false, tool: name, error: 'Tham số call_mcp_tool không hợp lệ.' };
    }
    const settings = handlers.settings;
    if (!settings?.mcpEnabled || !settings.mcpAllowedTools.includes(parsed.data.tool_name)) {
      return {
        ok: false,
        tool: name,
        error: `Công cụ MCP "${parsed.data.tool_name}" chưa được bật hoặc không nằm trong allowlist.`,
      };
    }
    const mcpUrl = typeof localStorage !== 'undefined' ? getLocalSetting('mcp-url', '').trim() : '';
    if (!mcpUrl) {
      return { ok: false, tool: name, error: 'Chưa cấu hình MCP Server URL trong tab Cấu hình.' };
    }
    handlers.onStep?.(`THEON // ĐANG GỌI MCP: ${parsed.data.tool_name}...`);
    try {
      const response = await postMcpMessage(mcpUrl, {
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: {
          name: parsed.data.tool_name,
          arguments: parsed.data.arguments,
        },
      });
      return { ok: true, tool: name, result: { mcp_response: response } };
    } catch (error) {
      return {
        ok: false,
        tool: name,
        error: error instanceof Error ? error.message : 'Lỗi gọi MCP Server.',
      };
    }
  }

  return { ok: false, tool: name, error: `Công cụ "${name}" chưa được đăng ký.` };
}
