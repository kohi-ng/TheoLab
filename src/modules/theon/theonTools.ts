/**
 * Zod-validated tool definitions & executor for Theon Agent.
 *
 * Currently registers `set_expression` so the AI can choose Theon's 3D facial
 * expression. Future multi-agent tools (search_kb, spawn_book, spawn_tag,
 * open_exercise_tab, read_skill) plug into this same registry.
 */
import { z } from 'zod';
import { THEON_EXPRESSIONS, type TheonExpression } from './theonConfig';

export const SetExpressionArgsSchema = z.object({
  expression: z.enum(THEON_EXPRESSIONS),
  reason: z.string().max(200).optional(),
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

export const THEON_TOOL_SPECS: readonly TheonToolSpec[] = Object.freeze([
  {
    name: 'set_expression',
    description:
      'Chọn biểu cảm khuôn mặt 3D cho Theon sao cho phù hợp với sắc thái câu trả lời. Luôn gọi hàm này khi sắc thái cảm xúc hoặc mức độ tập trung thay đổi.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          enum: [...THEON_EXPRESSIONS],
          description:
            'Một trong 7 biểu cảm: friendly (thân thiện), focused (tập trung phân tích/tính toán), thoughtful (suy tư/đặt câu hỏi), surprised (ngạc nhiên/khám phá), happy (vui vẻ/khen ngợi), serious (nghiêm túc/cảnh báo), relaxed (thư giãn/nhẹ nhàng).',
        },
        reason: {
          type: 'string',
          description: 'Lý do ngắn gọn chọn biểu cảm này (tùy chọn).',
        },
      },
      required: ['expression'],
    },
  },
]);

export interface TheonToolHandlers {
  onSetExpression: (expression: TheonExpression, reason?: string) => void;
}

export interface TheonToolExecutionResult {
  ok: boolean;
  tool: string;
  result?: Record<string, unknown>;
  error?: string;
}

export function executeTheonTool(
  name: string,
  rawArgs: unknown,
  handlers: TheonToolHandlers,
): TheonToolExecutionResult {
  let parsedInput = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      parsedInput = JSON.parse(rawArgs);
    } catch {
      return { ok: false, tool: name, error: 'Tham số JSON không hợp lệ.' };
    }
  }

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
    return {
      ok: true,
      tool: name,
      result: { expression: parsed.data.expression },
    };
  }

  return { ok: false, tool: name, error: `Công cụ "${name}" chưa được đăng ký.` };
}
