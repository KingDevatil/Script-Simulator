export function buildOutputProtocol(script, { opening = false } = {}) {
  const parts = [];
  parts.push(opening ? '输出格式：' : '【输出格式要求】');
  parts.push('只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释。');
  if (!opening) parts.push('JSON schema:');
  parts.push('{');
  parts.push(opening
    ? '  "narrative": "先写状态概览，再写开场事件",'
    : '  "narrative": "剧情内容，200-400字，简洁有力，重对话和关键动作，不要大段环境描写",');
  parts.push('  "options": [');
  parts.push('    {"label": "A", "text": "选项内容", "value": "玩家选择时发送给系统的文本"}');
  parts.push('  ],');
  parts.push('  "values": {"维度ID": 数字},');
  parts.push('  "keyEvent": null,');
  parts.push('  "stageHint": null');
  parts.push('}');
  parts.push('options 最多 4 个，少于 4 个也可以，绝对不要超过 4 个。');
  parts.push('不要为了凑数生成相似选项；每个选项都必须有明显不同的行动偏向。');
  parts.push('优先让选项覆盖不同策略，例如：坦诚沟通、回避拖延、试探观察、主动推进、示弱安抚、强硬切断。');
  parts.push('不同选项之间不能只是语气轻重不同，必须在目标、态度或风险取向上有实质差异。');
  if (!opening) {
    parts.push('常规情况下给 3-4 个选项；如果当前场景天然选择空间很小，可以只给 2 个，但仍要保持偏向差异。');
    parts.push('values 填写本轮后的绝对值，不要填写增量；数值必须在各自 range 内。');
    parts.push('keyEvent 只有发生重大转折、冲突或情感爆发时才填字符串，否则为 null。');
    parts.push('stageHint 只是剧情阶段建议；不确定时填 null。');
  } else {
    parts.push('开场事件后的首轮选项也必须遵守以上规则：最多 4 个，并且每个选项偏向明显不同。');
  }
  parts.push(`values 只能使用这些维度 ID：${(script.dimensions || []).map(d => d.id).join(', ') || '无'}`);
  return parts;
}
