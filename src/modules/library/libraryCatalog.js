import sampleLesson from '../../mocks/sampleLesson.json';

export const LIBRARY_CATEGORIES = [
  { id: 'documents', label: 'Tài liệu & Giáo trình' },
  { id: 'formulas', label: 'Bộ công thức & Hằng số' },
  { id: 'widgets', label: 'Mô phỏng tương tác' },
];

export const LIBRARY_DOCUMENTS = [
  {
    id: 'analytical-summary',
    category: 'documents',
    title: 'Tóm tắt chuẩn độ axit yếu',
    sourceLabel: 'Markdown · KaTeX',
    type: 'markdown',
    file: 'analytical-chemistry-summary.md',
  },
  {
    id: 'google-doc-guide',
    category: 'documents',
    title: 'Mẫu nhúng Google Docs',
    sourceLabel: 'Google Docs',
    type: 'google',
    url: 'https://docs.google.com/document/d/REPLACE_WITH_DOCUMENT_ID/edit',
    note: 'Thay REPLACE_WITH_DOCUMENT_ID bằng ID tài liệu bạn có quyền truy cập.',
    contextText: 'Google Docs document link: https://docs.google.com/document/d/REPLACE_WITH_DOCUMENT_ID/edit',
  },
  {
    id: 'sample-lesson-json',
    category: 'documents',
    title: 'Bài học mẫu · JSON',
    sourceLabel: 'JSON · bài học',
    type: 'json',
    content: sampleLesson,
  },
  {
    id: 'formula-hub',
    category: 'formulas',
    title: 'Formula Hub',
    sourceLabel: 'Công thức & hằng số',
    type: 'formula',
    contextText: 'Ka = [H+][A-]/[HA]; Kb = [HA][OH-]/[A-]; pKa = -log Ka; pKw = pH + pOH = 14.00 at 25 C; pH = pKa + log([A-]/[HA]).',
  },
  {
    id: 'titration-widget',
    category: 'widgets',
    title: 'Mô phỏng chuẩn độ axit yếu',
    sourceLabel: 'Widget HTML sandbox',
    type: 'widget',
    widget: {
      id: 'library-titration-widget',
      type: 'widget_embed',
      title: 'Mô phỏng chuẩn độ axit yếu',
      file: 'demo-titration.html',
      height: 460,
      initial_state: { pKa: 4.76, Ca: 0.1 },
    },
  },
];
