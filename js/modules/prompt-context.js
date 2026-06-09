export function appendSelections(parts, script, selections) {
  if (!selections || !Object.keys(selections).length) return [];
  const constraints = [];
  parts.push('【玩家初始设定 - 必须严格遵守，不可忽略或更改】');
  script.setup?.forEach((step, i) => {
    const val = selections[i];
    if (!val) return;
    const opt = (step.options || []).find(o => o.value === val);
    const desc = opt?.description ? `（${opt.description}）` : '';
    parts.push(`- ${step.step}：${val}${desc}`);
    if (opt?.constraints) constraints.push(...opt.constraints);
  });
  if (constraints.length) {
    parts.push('');
    parts.push('【剧情约束 - 必须严格遵守】');
    constraints.forEach(c => parts.push(`- ${c}`));
  }
  parts.push('');
  return constraints;
}

export function appendMemories(parts, memories) {
  if (!memories?.length) return;
  parts.push('【记忆摘要】');
  memories.forEach((m, i) => parts.push(`${i + 1}. ${m}`));
  parts.push('');
}

export function appendRecentMessages(parts, recentMessages) {
  if (!recentMessages?.length) return;
  parts.push('【最近对话】');
  recentMessages.forEach(m => {
    const role = m.role === 'player' ? '玩家' : 'AI';
    parts.push(`[${role}]：${m.content}`);
  });
  parts.push('');
}
