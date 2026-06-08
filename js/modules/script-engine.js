export function parseScript(json) {
  return {
    id: json.id || crypto.randomUUID(),
    name: json.name || '未命名剧本',
    description: json.description || '',
    cover: json.cover || '',
    rules: json.rules || { writing_style: '', forbidden: [], requirements: [] },
    dimensions: json.dimensions || [],
    characters: json.characters || [],
    events: json.events || [],
    stages: json.stages || [],
    endings: json.endings || [],
    setup: json.setup || [],
    createdAt: Date.now()
  };
}

// ─── 条件求值（支持 and/or/not 组合 + 旧格式兼容） ───
export function evaluateCondition(condition, values) {
  if (!condition) return false;

  // 新格式：组合条件
  if (condition.op) {
    const sub = (condition.conditions || []).map(c => evaluateCondition(c, values));
    switch (condition.op) {
      case 'and': return sub.every(Boolean);
      case 'or': return sub.some(Boolean);
      case 'not': return sub.length ? !sub[0] : false;
      default: return false;
    }
  }

  // 新格式：叶子条件 { dim, min, max, probability }
  if (condition.dim) {
    const val = values[condition.dim];
    if (val === undefined) return false;
    if (condition.min !== undefined && val < condition.min) return false;
    if (condition.max !== undefined && val > condition.max) return false;
    if (condition.probability !== undefined && Math.random() > condition.probability) return false;
    return true;
  }

  // 旧格式：{ "dimId": { min, max, probability } }（向后兼容）
  for (const [dimId, cond] of Object.entries(condition)) {
    const val = values[dimId];
    if (val === undefined) return false;
    if (cond.min !== undefined && val < cond.min) return false;
    if (cond.max !== undefined && val > cond.max) return false;
    if (cond.probability !== undefined && Math.random() > cond.probability) return false;
  }
  return true;
}

export function checkEventTriggers(events, values, currentStage, activeEffects) {
  const cooldowns = new Set();
  if (activeEffects) {
    activeEffects.forEach(e => { if (e.type === 'cooldown') cooldowns.add(e.eventName); });
  }
  const triggered = [];
  for (const event of events) {
    if (event.stage !== undefined && event.stage !== currentStage) continue;
    if (!event.trigger) continue;
    if (cooldowns.has(event.name)) continue;
    if (evaluateCondition(event.trigger, values)) triggered.push(event);
  }
  return triggered;
}

// ─── 持续效果处理 ───
export function processEffects(session) {
  if (!session.activeEffects || session.activeEffects.length === 0) return;
  const toRemove = [];
  session.activeEffects.forEach((effect, i) => {
    if (effect.type === 'sticky' && effect.dims) {
      for (const [dimId, delta] of Object.entries(effect.dims)) {
        session.values[dimId] = (session.values[dimId] || 0) + delta;
      }
    }
    effect.remaining--;
    if (effect.remaining <= 0) toRemove.push(i);
  });
  for (let i = toRemove.length - 1; i >= 0; i--) {
    session.activeEffects.splice(toRemove[i], 1);
  }
}

export function addEventEffects(session, event) {
  if (!event.effects) return;
  if (!session.activeEffects) session.activeEffects = [];
  if (event.effects.sticky) {
    session.activeEffects.push({
      eventName: event.name,
      type: 'sticky',
      dims: event.effects.sticky.dims || {},
      remaining: event.effects.sticky.duration || 3
    });
  }
  if (event.effects.cooldown) {
    session.activeEffects.push({
      eventName: event.name,
      type: 'cooldown',
      remaining: event.effects.cooldown
    });
  }
}

export function checkStageTransition(stages, values, currentStage) {
  if (currentStage >= stages.length - 1) return currentStage;
  const nextStage = stages[currentStage + 1];
  if (!nextStage?.transition) return currentStage;
  return evaluateCondition(nextStage.transition, values) ? currentStage + 1 : currentStage;
}

export function extractValues(text, dimensions) {
  const values = {};
  const blockMatch = text.match(/【数值更新】([\s\S]*?)(?=【|$)/);
  if (!blockMatch) return null;

  const block = blockMatch[1];
  for (const dim of dimensions) {
    const regex = new RegExp(`${dim.name}\\s*[：:]?\\s*(\\d+)`);
    const m = block.match(regex);
    if (m) values[dim.id] = parseInt(m[1], 10);
  }
  return Object.keys(values).length ? values : null;
}

export function extractKeyEvents(text) {
  const match = text.match(/【关键事件】(.+)/);
  return match ? match[1].trim() : null;
}

export function extractNarrative(text) {
  return text
    .replace(/【选项】[\s\S]*$/, '')
    .replace(/【数值更新】[\s\S]*$/, '')
    .replace(/【关键事件】[\s\S]*$/, '')
    .trim();
}
