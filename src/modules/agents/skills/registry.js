const skills = [
  { id: 'supporter', name: 'Agent Supporter', tabs: ['Bài học'], enabled: true },
  { id: 'instructor', name: 'Agent Instructor', tabs: ['Soạn bài'], enabled: true },
];

export function getActiveSkills(tab) {
  return skills.filter((skill) => skill.enabled && skill.tabs.includes(tab));
}

export function setSkillEnabled(id, enabled) {
  const skill = skills.find((item) => item.id === id);
  if (!skill) throw new Error(`Unknown skill "${id}".`);
  skill.enabled = Boolean(enabled);
}

export function listSkills() {
  return skills.map((skill) => ({ ...skill }));
}
