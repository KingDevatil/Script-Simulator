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

export function createSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const data = new Uint32Array(1);
    globalThis.crypto.getRandomValues(data);
    return data[0] || Date.now();
  }
  return Date.now();
}

export function nextSeedValue(seed) {
  let t = Number(seed) || 1;
  t = (t + 0x6D2B79F5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
  return {
    seed: t,
    value: ((r ^ (r >>> 14)) >>> 0) / 4294967296
  };
}

export function createSeededRandom(seed) {
  let state = Number(seed) || 1;
  return () => {
    const next = nextSeedValue(state);
    state = next.seed;
    return next.value;
  };
}

export function initializeValues(dimensions = [], seed = createSeed()) {
  const values = {};
  const rng = createSeededRandom(seed);
  dimensions.forEach(d => {
    values[d.id] = resolveInitialValue(d.initial, rng);
    values[d.id] = clampValue(values[d.id], d);
  });
  return { values, seed };
}

export function resolveInitialValue(initial, rng = Math.random) {
  if (Array.isArray(initial)) {
    const min = Number(initial[0] ?? 50);
    const max = Number(initial[1] ?? min);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return 50;
    if (min === max) return Math.round(min);
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return Math.round(low + rng() * (high - low));
  }
  const value = Number(initial);
  return Number.isFinite(value) ? Math.round(value) : 50;
}

export function clampValue(value, dimension) {
  const min = Number(dimension?.range?.[0] ?? -Infinity);
  const max = Number(dimension?.range?.[1] ?? Infinity);
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(min, Math.min(max, Math.round(num)));
}

export function clampValues(values, dimensions = []) {
  const dimById = new Map(dimensions.map(d => [d.id, d]));
  const result = {};
  const warnings = [];
  for (const [dimId, value] of Object.entries(values || {})) {
    const dim = dimById.get(dimId);
    if (!dim) continue;
    const clamped = clampValue(value, dim);
    if (clamped === null) continue;
    if (clamped !== Number(value)) warnings.push(`维度 ${dimId} 已限制到范围 ${dim.range?.[0]}-${dim.range?.[1]}`);
    result[dimId] = clamped;
  }
  return { values: result, warnings };
}

// ─── 条件求值（支持 and/or/not 组合 + 旧格式兼容） ───
export function evaluateCondition(condition, values, random = Math.random) {
  if (!condition) return false;

  // 新格式：组合条件
  if (condition.op) {
    const sub = (condition.conditions || []).map(c => evaluateCondition(c, values, random));
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
    if (condition.probability !== undefined && random() > condition.probability) return false;
    return true;
  }

  // 旧格式：{ "dimId": { min, max, probability } }（向后兼容）
  for (const [dimId, cond] of Object.entries(condition)) {
    const val = values[dimId];
    if (val === undefined) return false;
    if (cond.min !== undefined && val < cond.min) return false;
    if (cond.max !== undefined && val > cond.max) return false;
    if (cond.probability !== undefined && random() > cond.probability) return false;
  }
  return true;
}

export function checkEventTriggers(events, values, currentStage, activeEffects, eventState = {}, random = Math.random) {
  const cooldowns = new Set();
  if (activeEffects) {
    activeEffects.forEach(e => { if (e.type === 'cooldown') cooldowns.add(e.eventName); });
  }
  const triggered = [];
  for (const event of events) {
    const state = eventState[event.name] || { count: 0 };
    if (event.stage !== undefined && event.stage !== currentStage) continue;
    if (!event.trigger) continue;
    if (event.once && state.count > 0) continue;
    if (event.maxTriggers !== undefined && state.count >= event.maxTriggers) continue;
    if (cooldowns.has(event.name)) continue;
    if (evaluateCondition(event.trigger, values, random)) triggered.push(event);
  }
  return triggered;
}

// ─── 持续效果处理 ───
export function processEffects(session, dimensions = []) {
  if (!session.activeEffects || session.activeEffects.length === 0) return;
  const dimById = new Map(dimensions.map(d => [d.id, d]));
  const toRemove = [];
  session.activeEffects.forEach((effect, i) => {
    if (effect.type === 'sticky' && effect.dims) {
      for (const [dimId, delta] of Object.entries(effect.dims)) {
        const next = (session.values[dimId] || 0) + delta;
        session.values[dimId] = dimById.has(dimId) ? clampValue(next, dimById.get(dimId)) : next;
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
  session.eventState = session.eventState || {};
  const state = session.eventState[event.name] || { count: 0 };
  state.count += 1;
  state.lastTriggeredAt = Date.now();
  session.eventState[event.name] = state;

  if (!session.activeEffects) session.activeEffects = [];
  if (event.effects?.sticky) {
    session.activeEffects.push({
      eventName: event.name,
      type: 'sticky',
      dims: event.effects.sticky.dims || {},
      remaining: event.effects.sticky.duration || 3
    });
  }
  const cooldown = event.cooldown || event.effects?.cooldown;
  if (cooldown) {
    session.activeEffects.push({
      eventName: event.name,
      type: 'cooldown',
      remaining: cooldown
    });
  }
}

export function checkStageTransition(stages, values, currentStage) {
  if (currentStage >= stages.length - 1) return currentStage;
  const nextStage = stages[currentStage + 1];
  if (!nextStage?.transition) return currentStage;
  return evaluateCondition(nextStage.transition, values) ? currentStage + 1 : currentStage;
}

export function advanceStage(stages, values, currentStage) {
  let stage = currentStage;
  while (stage < (stages || []).length - 1) {
    const next = checkStageTransition(stages, values, stage);
    if (next === stage) break;
    stage = next;
  }
  return stage;
}

export function checkEnding(endings = [], values = {}) {
  return endings.find(ending => evaluateCondition(ending.condition, values)) || null;
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
