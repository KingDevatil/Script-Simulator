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
  if (!opening) {
    parts.push('options 必须有 3-4 个，体现不同态度和策略（主动/被动、坦诚/隐瞒、进攻/退缩）。');
    parts.push('values 填写本轮后的绝对值，不要填写增量；数值必须在各自 range 内。');
    parts.push('keyEvent 只有发生重大转折、冲突或情感爆发时才填字符串，否则为 null。');
    parts.push('stageHint 只是剧情阶段建议；不确定时填 null。');
  }
  parts.push(`values 只能使用这些维度 ID：${(script.dimensions || []).map(d => d.id).join(', ') || '无'}`);
  return parts;
}
