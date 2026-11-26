/**
 * Structured Skill Registry for Theon the Multiagent.
 * Theon can inspect available skill summaries in its system prompt and call
 * `read_skill({ skill_id })` to load full operational instructions & JSON specs.
 */

export const THEON_SKILL_IDS = [
  'kb_librarian',
  'exercise_architect',
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
      '2. Gọi `open_exercise_tab` với JSON chuẩn:',
      '   ```json',
      '   {',
      '     "title": "Luyện tập chuẩn độ Acid-Base",',
      '     "subtitle": "3 câu ôn nhanh có chấm điểm tự động",',
      '     "time_limit_sec": 180,',
      '     "also_spawn_tag": true,',
      '     "items": [',
      '       {',
      '         "type": "mcq",',
      '         "question": "Tại điểm tương đương chuẩn độ CH3COOH bằng NaOH, dung dịch có pH như thế nào?",',
      '         "options": [',
      '           { "text": "pH < 7", "feedback": "Muối CH3COONa thủy phân tạo môi trường bazơ." },',
      '           { "text": "pH = 7" },',
      '           { "text": "pH > 7", "feedback": "Chính xác! Ion CH3COO- thủy phân sinh OH-." }',
      '         ],',
      '         "answer": 2,',
      '         "explanation": "CH3COO- + H2O ⇌ CH3COOH + OH- nên pH > 7."',
      '       },',
      '       {',
      '         "type": "numeric",',
      '         "prompt": "Tính pH của dung dịch HCl 0.01 M (bỏ qua sự tự ion hóa nước).",',
      '         "answer": 2,',
      '         "tolerance": 0.05,',
      '         "unit": "pH",',
      '         "explanation": "pH = -log(0.01) = 2.00."',
      '       }',
      '     ]',
      '   }',
      '   ```',
      '3. Công thức toán/hóa trong câu hỏi có thể bọc trong `$ ... $` (KaTeX). Chỉ số `answer` của `mcq` bắt đầu từ `0`.',
      '4. Đặt `also_spawn_tag: true` để tạo thêm thẻ 3D trong hộp Theon giúp người dùng mở lại bài tập bất kỳ lúc nào.',
    ].join('\n'),
  },
  {
    id: 'study_coach',
    name: 'Huấn luyện Học tập (Ngữ cảnh & Đồ thị 3D)',
    summary: 'Bám sát bài học / kết quả bài tập đang mở qua contextBus, giải thích từng bước và bật đồ thị 3D minh họa khi hữu ích.',
    recommendedTools: ['get_active_context', 'show_3d_graph', 'set_expression'],
    instructions: [
      '## Quy trình Skill: study_coach',
      '1. Gọi `get_active_context()` để nắm bài học đang mở, tab ứng dụng bên phải và kết quả bài tập gần nhất (`lastExerciseResult`).',
      '2. Nếu người dùng vừa làm sai bài tập, phân tích ngắn gọn chỗ dễ nhầm và đặt 1 câu hỏi gợi mở trước khi đưa lời giải đầy đủ.',
      '3. Nếu đang giải thích sóng hàm, phân bố dữ liệu hoặc quỹ đạo, có thể gọi `show_3d_graph({ visible: true, mode: "wave" | "bars" | "orbit" })` để trực quan hóa ngay trong hộp Theon.',
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
