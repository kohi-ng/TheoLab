/**
 * Structured Skill Registry for Theon the Multiagent.
 * Theon can inspect available skill summaries in its system prompt and call
 * `read_skill({ skill_id })` to load full operational instructions & JSON specs.
 */

export const THEON_SKILL_IDS = [
  'kb_librarian',
  'exercise_architect',
  'chart_visualizer',
  'study_coach',
  'app_launcher',
] as const;

export type TheonSkillId = (typeof THEON_SKILL_IDS)[number];

export interface TheonSkillDefinition {
  id: TheonSkillId;
  name: string;
  summary: string;
  recommendedTools: readonly string[];
  instructions: string;
}

export const THEON_SKILLS: readonly TheonSkillDefinition[] = Object.freeze([
  {
    id: 'kb_librarian',
    name: 'Thủ thư Tri thức (Embedding & Sách/Thẻ 3D)',
    summary: 'Truy cứu Kho Vector Embedding + Thư viện tài liệu và kết tinh Sách 3D / Thẻ vật thể 3D bấm mở được trong hộp Theon.',
    recommendedTools: ['search_kb', 'spawn_book', 'spawn_tag', 'set_expression'],
    instructions: [
      '## Quy trình Skill: kb_librarian',
      '1. Gọi `search_kb({ query, k: 5 })` với từ khóa trọng tâm bằng tiếng Việt/Anh để tìm bài học, công thức, khái niệm hoặc tài liệu trong Kho Vector và Thư viện.',
      '2. Với mỗi nguồn khớp cao nhất (tối đa 2-3 nguồn tiêu biểu để hộp 3D gọn đẹp):',
      '   - Gọi `spawn_book({ title, subtitle, summary, deep_link, url })` cho bài học, chương, hoặc tài liệu dài. Bắt buộc gắn đúng `deep_link` (dạng `#/...`) hoặc `url` lấy từ kết quả `search_kb` để người dùng nhấn vào là mở ngay.',
      '   - Gọi `spawn_tag({ label, tag, description, deep_link, open_formula })` cho công thức ngắn, khái niệm trọng tâm, hoặc ghi chú nhanh.',
      '3. Gọi `set_expression({ expression: "focused" | "happy" })` phù hợp rồi trả lời ngắn gọn, nhắc người dùng có thể nhấn trực tiếp vào cuốn sách hoặc thẻ 3D vừa kết tinh trong hộp.',
    ].join('\n'),
  },
  {
    id: 'exercise_architect',
    name: 'Thiết kế Bài tập (JSON → Tab làm bài)',
    summary: 'Soạn bộ câu hỏi trắc nghiệm (MCQ) / tính toán điền số (Numeric) chuẩn JSON và mở ngay Tab làm bài tập tương tác ở khung phải.',
    recommendedTools: ['get_active_context', 'search_kb', 'open_exercise_tab', 'spawn_tag', 'set_expression'],
    instructions: [
      '## Quy trình Skill: exercise_architect',
      '1. Nếu người dùng muốn luyện theo bài đang học, gọi `get_active_context()` hoặc `search_kb(...)` trước để bám sát nội dung thật.',
      '2. Gọi `open_exercise_tab` với JSON chuẩn (`title`, `subtitle`, `time_limit_sec`, `also_spawn_tag`, `items` gồm `mcq` và `numeric`).',
      '3. Công thức toán/hóa trong câu hỏi bọc trong `$ ... $` (KaTeX). Chỉ số `answer` của `mcq` bắt đầu từ `0`.',
      '4. Đặt `also_spawn_tag: true` để tạo thêm thẻ 3D trong hộp Theon giúp người dùng mở lại bài tập bất kỳ lúc nào.',
    ].join('\n'),
  },
  {
    id: 'chart_visualizer',
    name: 'Vẽ Biểu đồ & Trục số Ma trận (Cột, Đường, Hai trục, Tròn, Scatter, Trục số)',
    summary: 'Vẽ biểu đồ dữ liệu và đồ thị trục số toán học (tập nghiệm, khoảng, đoạn, tia) trực tiếp lên màn hình kính khung hộp Theon.',
    recommendedTools: ['draw_chart', 'set_expression'],
    instructions: [
      '## Quy ước truyền biến cho hàm `draw_chart` (ép sát màn hình hộp Theon)',
      '- `visible`: `true` để vẽ/cập nhật biểu đồ, `false` để ẩn biểu đồ khỏi màn hình.',
      '- `chart_type`: chọn đúng 1 trong 8 loại: `line`, `bar`, `dual_axis`, `pie`, `donut`, `scatter`, `area`, `number_line`.',
      '- `title`, `subtitle`, `x_label`, `y_label`, `y2_label` (cho `dual_axis`).',
      '- `show_grid` (mặc định true), `show_values` (hiện số trên cột/lát tròn).',
      '',
      '### 1) Biểu đồ cột / đường / miền (`bar` | `line` | `area`):',
      'Truyền `labels: string[]` và `series: [{ name, values: number[], kind?, color? }]`.',
      '```json',
      '{ "visible": true, "chart_type": "bar", "title": "Điểm trung bình theo chương", "x_label": "Chương", "y_label": "Điểm", "labels": ["Ch.1", "Ch.2", "Ch.3"], "series": [{ "name": "Lớp A", "values": [7.8, 8.4, 9.1] }] }',
      '```',
      '',
      '### 2) Biểu đồ hai trục (`dual_axis`):',
      'Truyền `y_label` (trục trái), `y2_label` (trục phải), và `series` gắn `axis: "left"` / `axis: "right"` cùng `kind: "bar" | "line" | "area"`.',
      '```json',
      '{ "visible": true, "chart_type": "dual_axis", "title": "Chuẩn độ CH3COOH bằng NaOH", "x_label": "V NaOH (mL)", "y_label": "pH", "y2_label": "dpH/dV", "labels": ["0", "10", "20", "25", "30"], "series": [{ "name": "pH", "kind": "line", "axis": "left", "values": [2.9, 4.6, 5.4, 8.7, 11.9] }, { "name": "dpH/dV", "kind": "bar", "axis": "right", "values": [0.1, 0.08, 0.2, 1.8, 0.15] }] }',
      '```',
      '',
      '### 3) Biểu đồ tròn / vành khuyên (`pie` | `donut`):',
      'Truyền `slices: [{ label, value, color? }]` (hoặc `labels` + `series[0].values`).',
      '```json',
      '{ "visible": true, "chart_type": "donut", "title": "Thành phần dung dịch", "slices": [{ "label": "Nước", "value": 72 }, { "label": "Ethanol", "value": 20 }, { "label": "Muối", "value": 8 }] }',
      '```',
      '',
      '### 4) Biểu đồ phân tán (`scatter`) hoặc đồ thị hàm liên tục:',
      'Truyền `series: [{ name, kind: "scatter" | "line", points: [{ x, y }] }]`.',
      '',
      '### 5) Đồ thị trục số toán học (`number_line` — biểu diễn tập nghiệm, khoảng, đoạn, nửa khoảng, tia, điểm):',
      'Truyền `number_line: { min?, max?, step?, axis_label?, expression?, notation?: "both" | "bracket" | "circle", hatch_excluded?, intervals: [{ from?, to?, include_from?, include_to?, label?, color? }], points?: [{ value, filled?, label?, color? }] }`.',
      '- Bỏ trống hoặc đặt `from: null` cho `−∞`, `to: null` cho `+∞`.',
      '- `include_from: true` vẽ ngoặc vuông `[` & chấm đặc `●`; `false` vẽ ngoặc tròn `(` & chấm rỗng `○`. Tương tự `include_to` cho `]` / `)`.',
      '- `hatch_excluded: true` (mặc định) sẽ gạch chéo phần bị loại khỏi tập nghiệm đúng chuẩn SGK Toán Việt Nam.',
      '```json',
      '{ "visible": true, "chart_type": "number_line", "title": "Tập nghiệm bất phương trình", "subtitle": "S = (-∞; -2) ∪ [3; +∞)", "number_line": { "min": -6, "max": 7, "step": 1, "axis_label": "x", "notation": "both", "hatch_excluded": true, "intervals": [{ "from": null, "to": -2, "include_to": false, "label": "x < -2" }, { "from": 3, "to": null, "include_from": true, "label": "x ≥ 3" }] } }',
      '```',
      '- Lưu ý: Nhắc người dùng có thể nhấp đúp (double-click) vào khung Theon hoặc bảo "ẩn biểu đồ" để tắt.',
    ].join('\n'),
  },
  {
    id: 'study_coach',
    name: 'Huấn luyện Học tập (Ngữ cảnh & Trực quan hóa)',
    summary: 'Bám sát bài học / kết quả bài tập đang mở qua contextBus, giải thích từng bước và vẽ biểu đồ minh họa khi hữu ích.',
    recommendedTools: ['get_active_context', 'draw_chart', 'set_expression'],
    instructions: [
      '## Quy trình Skill: study_coach',
      '1. Gọi `get_active_context()` để nắm bài học đang mở, tab ứng dụng bên phải và kết quả bài tập gần nhất (`lastExerciseResult`).',
      '2. Nếu người dùng vừa làm sai bài tập, phân tích ngắn gọn chỗ dễ nhầm và đặt 1 câu hỏi gợi mở trước khi đưa lời giải đầy đủ.',
      '3. Khi giải thích dữ liệu, đường chuẩn độ, tỷ lệ phần trăm hay so sánh số liệu, gọi `draw_chart` (đọc skill `chart_visualizer` nếu cần) để chiếu biểu đồ trực tiếp lên màn hình hộp Theon.',
      '4. Luôn chọn biểu cảm phù hợp qua `set_expression` (`thoughtful`, `focused`, `happy`, `friendly`).',
    ].join('\n'),
  },
  {
    id: 'app_launcher',
    name: 'Điều phối Ứng dụng STEM & Workspace',
    summary: 'Mở trực tiếp Desmos, Desmos 3D, Calc, Ketcher, JupyterLite, GeoGebra, MolView, Excalidraw, Docs hoặc Sheets ở khung phải.',
    recommendedTools: ['open_app_tab', 'spawn_tag', 'set_expression'],
    instructions: [
      '## Quy trình Skill: app_launcher',
      '1. Chọn đúng `app_id` trong danh mục TheoLab:',
      '   - Đồ thị 2D / chuẩn độ: `desmos`',
      '   - Máy tính khoa học pH / log: `desmos-scientific`',
      '   - Đồ thị 3D: `desmos-3d`',
      '   - Vẽ công thức phân tử hóa học 2D: `ketcher`',
      '   - Quan sát phân tử 3D: `molview`',
      '   - Chạy Python / Notebook: `jupyterlite`',
      '   - Hình học / giải tích: `geogebra`',
      '   - Bảng trắng sơ đồ tư duy: `excalidraw`',
      '   - Soạn tài liệu / bảng tính: `google-docs`, `google-sheets`, `google-calendar`',
      '2. Gọi `open_app_tab({ app_id, title })` để mở ngay ở khung phải, hoặc gọi `spawn_tag` gắn `app_id` để người dùng tự bấm mở khi cần.',
    ].join('\n'),
  },
]);

export function findTheonSkill(skillId: string): TheonSkillDefinition | undefined {
  return THEON_SKILLS.find((skill) => skill.id === skillId);
}

export function formatEnabledSkillsCatalog(enabledIds: readonly string[]): string {
  const active = THEON_SKILLS.filter((skill) => enabledIds.includes(skill.id));
  if (!active.length) return 'Không có skill chuyên biệt nào đang bật.';
  return active
    .map((skill) => `- ${skill.id}: ${skill.summary}`)
    .join('\n');
}
