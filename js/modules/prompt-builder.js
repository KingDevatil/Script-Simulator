// ─── 宏替换 ───
export function substituteMacros(text, ctx) {
  if (!text || typeof text !== 'string') return text;
  const { script, values, currentStage } = ctx;
  const chars = script.characters || [];
  const dims = script.dimensions || [];
  const stages = script.stages || [];

  const charMap = {};
  chars.forEach(c => { charMap[c.id] = c.name; });

  return text.replace(/\{\{(\w+)(?::([^}]*))?\}\}/g, (_, key, arg) => {
    switch (key) {
      case 'player': return charMap['player'] || '玩家';
      case 'partner': return charMap['partner'] || '现任';
      case 'target': return charMap['target'] || '危险对象';
      case 'stage': return stages[currentStage]?.name || `阶段${(currentStage || 0) + 1}`;
      case 'stage_num': return String((currentStage || 0) + 1);
      case 'dim': {
        if (!arg) return '';
        const dim = dims.find(d => d.name === arg || d.id === arg);
        if (!dim) return '';
        const val = values?.[dim.id];
        return val !== undefined ? String(val) : '';
      }
      case 'random': {
        if (!arg) return '';
        const choices = arg.split(',').map(s => s.trim()).filter(Boolean);
        return choices.length ? choices[Math.floor(Math.random() * choices.length)] : '';
      }
      default: return `{{${key}${arg ? ':' + arg : ''}}}`;
    }
  });
}

function applyMacros(text, ctx) {
  return substituteMacros(text, ctx);
}

export function buildPrompt({ script, values, memories, recentMessages, scenePrompt, playerInput, currentStage }) {
  const macroCtx = { script, values, currentStage };
  const parts = [];

  // 1. Iron rules
  parts.push('【铁律 - 永远不可违反】');
  parts.push('- 你是角色本身，不要跳出角色');
  parts.push('- 不要用 AI 的口吻解释或评价剧情');
  parts.push('- 涉及多个角色时，必须用角色名（如"现任""危险对象"）而非"他""她""你"，确保玩家能分清每句话的主体和对象');
  parts.push('- 对话场景中，每句话前必须标注说话人名字，如：现任："……"；危险对象："……"');
  parts.push('- 叙述中指代玩家时用"你"，指代其他角色时必须用名字，禁止用"他""她"指代角色');
  if (script.rules?.forbidden) {
    script.rules.forbidden.forEach(r => parts.push(`- ${applyMacros(r, macroCtx)}`));
  }
  parts.push('');

  // 2. Writing style
  if (script.rules?.writing_style) {
    parts.push('【写作规范】');
    parts.push(applyMacros(script.rules.writing_style, macroCtx));
    if (script.rules.requirements) {
      script.rules.requirements.forEach(r => parts.push(`- ${applyMacros(r, macroCtx)}`));
    }
    parts.push('');
  }

  // 3. Characters
  parts.push('【你扮演以下角色】');
  const chars = script.characters || [];
  chars.forEach(c => {
    const val = values?.[c.id] ? `，当前状态：${JSON.stringify(values[c.id])}` : '';
    parts.push(`${c.name}：${applyMacros(c.description, macroCtx)}${val}`);
  });
  parts.push('');

  // 4. Numerical values
  if (script.dimensions?.length && values) {
    parts.push('【当前数值 - 用精确数字】');
    script.dimensions.forEach(d => {
      const v = values[d.id];
      if (v === undefined) return;
      const scope = d.scope ? `（${applyMacros(d.scope, macroCtx)}）` : '';
      parts.push(`${d.name}${scope}：${v}`);
    });
    parts.push('');
  }

  // 5. Memories
  if (memories?.length) {
    parts.push('【记忆摘要】');
    memories.forEach((m, i) => parts.push(`${i + 1}. ${m}`));
    parts.push('');
  }

  // 6. Recent conversation
  if (recentMessages?.length) {
    parts.push('【最近对话】');
    recentMessages.forEach(m => {
      const role = m.role === 'player' ? '玩家' : 'AI';
      parts.push(`[${role}]：${m.content}`);
    });
    parts.push('');
  }

  // 7. Scene
  if (scenePrompt) {
    parts.push('【当前场景】');
    parts.push(scenePrompt);
    parts.push('');
  }

  // 8. Output format
  parts.push('【输出格式要求】');
  parts.push('1. 输出剧情内容（200-400字，简洁有力，重对话和关键动作，不要大段环境描写）');
  parts.push('2. 剧情结束后，必须给出 4-6 个选项供玩家选择，格式如下：');
  parts.push('【选项】');
  parts.push('A. 选项内容');
  parts.push('B. 选项内容');
  parts.push('C. 选项内容');
  parts.push('D. 选项内容');
  parts.push('选项应该体现不同的态度和策略（如：主动/被动、坦诚/隐瞒、进攻/退缩），让玩家有真正的选择空间。');
  parts.push('3. 选项之后，另起一行输出数值更新块：');
  parts.push('【数值更新】');
  parts.push('属性名 值 属性名 值 ...');
  if (script.events?.some(e => e.trigger)) {
    parts.push('4. 如果发生了关键事件（重大转折、冲突、情感爆发），在数值更新后另起一行输出：');
    parts.push('【关键事件】事件简述');
  }
  parts.push('');

  // 9. Player input
  parts.push('【玩家输入】');
  parts.push(playerInput);

  parts.push('请基于以上信息继续剧情。');

  return parts.join('\n');
}

export function buildSetupPrompt({ script, selections }) {
  const macroCtx = { script, values: {}, currentStage: 0 };
  const parts = [];
  parts.push('【铁律 - 永远不可违反】');
  parts.push('- 涉及多个角色时，必须用角色名（如"现任""危险对象"）而非"他""她""你"，确保玩家能分清每句话的主体和对象');
  parts.push('- 对话场景中，每句话前必须标注说话人名字，如：现任："……"；危险对象："……"');
  parts.push('- 叙述中指代玩家时用"你"，指代其他角色时必须用名字，禁止用"他""她"指代角色');
  parts.push('');
  parts.push('以下是玩家的开局选择：');
  script.setup?.forEach((step, i) => {
    const val = selections[i] || '随机';
    parts.push(`${step.step}：${val}`);
  });
  parts.push('');
  parts.push('请根据以上选择生成开场。要求：');
  parts.push('');
  parts.push('第一部分：状态概览（简洁，3-5句）');
  parts.push('- 玩家是谁（职业、性格）');
  parts.push('- 现任是谁（关系状态、性格）');
  parts.push('- 危险对象是谁（身份、性格）');
  parts.push('- 当前场景背景（时间、地点）');
  parts.push('');
  parts.push('第二部分：开场事件（约200-300字）');
  parts.push('- 一个自然的场景切入，引出玩家的第一个选择');
  parts.push('- 不要大段描写，简洁有力');
  parts.push('');
  parts.push('输出格式：');
  parts.push('1. 先写状态概览');
  parts.push('2. 再写开场事件');
  parts.push('3. 给出 4-6 个选项：');
  parts.push('【选项】');
  parts.push('A. 选项内容');
  parts.push('B. 选项内容');
  parts.push('C. 选项内容');
  parts.push('D. 选项内容');
  parts.push('4. 输出数值更新：');
  parts.push('【数值更新】');
  parts.push('属性名 值 ...');

  return parts.join('\n');
}
