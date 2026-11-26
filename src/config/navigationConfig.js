export const NAV_TABS = Object.freeze([
  Object.freeze({ id: 'lesson', label: 'Bài học', icon: '▤', primary: true }),
  Object.freeze({ id: 'ai', label: 'AI', icon: '✦', primary: true }),
  Object.freeze({ id: 'library', label: 'Thư viện', icon: '▣', primary: true }),
  Object.freeze({ id: 'studio', label: 'Soạn bài', icon: '✎', primary: true }),
  Object.freeze({ id: 'settings', label: 'Cấu hình', icon: '⚙', primary: true }),
  Object.freeze({ id: 'exam', label: 'Phòng thi', icon: '◷', primary: false, placeholder: true }),
  Object.freeze({ id: 'vector', label: 'Kho Vector / Embedding', icon: '⌘', primary: false, moduleId: 'vectorKb' }),
]);
