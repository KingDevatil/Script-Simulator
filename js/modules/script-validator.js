export function validateScript(script) {
  const errors = [];
  const warnings = [];
  const dimensions = Array.isArray(script?.dimensions) ? script.dimensions : [];
  const characters = Array.isArray(script?.characters) ? script.characters : [];
  const events = Array.isArray(script?.events) ? script.events : [];
  const stages = Array.isArray(script?.stages) ? script.stages : [];
  const endings = Array.isArray(script?.endings) ? script.endings : [];

  if (!script || typeof script !== 'object') errors.push('剧本必须是 JSON 对象');
  if (!script?.name) warnings.push('缺少剧本名称');

  checkIds(dimensions, '维度', errors);
  checkIds(characters, '角色', errors);
  if (!characters.some(c => c.id === 'player')) errors.push('必须包含 id 为 player 的玩家角色');

  const dimIds = new Set(dimensions.map(d => d.id).filter(Boolean));
  dimensions.forEach((dim, index) => {
    if (!dim.id) errors.push(`维度 ${index + 1} 缺少 id`);
    if (!dim.name) errors.push(`维度 ${dim.id || index + 1} 缺少名称`);
    if (!isNumberPair(dim.range)) errors.push(`维度 ${dim.id || index + 1} 的 range 必须是两个数字`);
    if (!isNumberPair(dim.initial)) warnings.push(`维度 ${dim.id || index + 1} 缺少合法 initial，将使用默认值`);
  });

  events.forEach((event, index) => {
    if (!event.name) warnings.push(`事件 ${index + 1} 缺少名称`);
    const eventStages = getEventStages(event);
    if (event.stage !== undefined && event.stages !== undefined) {
      warnings.push(`事件 ${event.name || index + 1} 同时包含 stage 和 stages，将优先使用 stages`);
    }
    if (event.stages !== undefined && !Array.isArray(event.stages)) {
      errors.push(`事件 ${event.name || index + 1} 的 stages 必须是数组`);
    }
    if (Array.isArray(event.stages) && event.stages.length === 0) {
      warnings.push(`事件 ${event.name || index + 1} 的 stages 为空，将视为全阶段`);
    }
    if (event.stages !== undefined && Array.isArray(event.stages) && event.stages.some(v => !Number.isInteger(Number(v)))) {
      errors.push(`事件 ${event.name || index + 1} 的 stages 必须全部是整数`);
    }
    if (eventStages.some(stage => !isStageIndex(stage, stages.length))) {
      errors.push(`事件 ${event.name || index + 1} 的阶段配置超出阶段范围`);
    }
    ['cooldown', 'maxTriggers'].forEach(key => {
      if (event[key] !== undefined && (!Number.isInteger(Number(event[key])) || Number(event[key]) < 0)) {
        errors.push(`事件 ${event.name || index + 1} 的 ${key} 必须是非负整数`);
      }
    });
    if (event.once !== undefined && typeof event.once !== 'boolean') {
      errors.push(`事件 ${event.name || index + 1} 的 once 必须是布尔值`);
    }
    validateCondition(event.trigger, dimIds, `事件 ${event.name || index + 1} 触发条件`, errors);
    validateEffectDims(event.effects, dimIds, `事件 ${event.name || index + 1}`, errors);
  });

  stages.forEach((stage, index) => {
    validateCondition(stage.transition, dimIds, `阶段 ${stage.name || index + 1} 过渡条件`, errors);
  });

  endings.forEach((ending, index) => {
    validateCondition(ending.condition, dimIds, `结局 ${ending.name || index + 1} 条件`, errors);
  });

  return { ok: errors.length === 0, errors, warnings };
}

function getEventStages(event) {
  if (Array.isArray(event?.stages)) {
    return [...new Set(event.stages.map(v => Number(v)).filter(Number.isInteger))];
  }
  if (event?.stage === undefined || event.stage === null || event.stage === '') return [];
  return Number.isInteger(Number(event.stage)) ? [Number(event.stage)] : [];
}

export function assertValidScript(script) {
  const result = validateScript(script);
  if (!result.ok) {
    const err = new Error(result.errors.join('\n'));
    err.validation = result;
    throw err;
  }
  return result;
}

export function formatValidationResult(result) {
  const lines = [];
  if (result.errors?.length) {
    lines.push('错误:');
    result.errors.forEach(e => lines.push(`- ${e}`));
  }
  if (result.warnings?.length) {
    lines.push('警告:');
    result.warnings.forEach(w => lines.push(`- ${w}`));
  }
  return lines.join('\n') || '校验通过';
}

function checkIds(items, label, errors) {
  const seen = new Set();
  items.forEach((item, index) => {
    if (!item.id) return;
    if (seen.has(item.id)) errors.push(`${label} id 重复: ${item.id}`);
    seen.add(item.id);
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(item.id)) {
      errors.push(`${label} ${index + 1} 的 id 只能使用英文、数字、下划线或短横线，并且不能以数字开头`);
    }
  });
}

function isNumberPair(value) {
  return Array.isArray(value) && value.length === 2 && value.every(v => Number.isFinite(Number(v)));
}

function isStageIndex(value, stageCount) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && (stageCount === 0 || n < stageCount);
}

function validateCondition(condition, dimIds, path, errors) {
  if (!condition || typeof condition !== 'object' || !Object.keys(condition).length) return;

  if (condition.op) {
    if (!['and', 'or', 'not'].includes(condition.op)) errors.push(`${path} 使用未知 op: ${condition.op}`);
    if (!Array.isArray(condition.conditions)) {
      errors.push(`${path} 的 conditions 必须是数组`);
      return;
    }
    condition.conditions.forEach((child, index) => validateCondition(child, dimIds, `${path}.${index + 1}`, errors));
    return;
  }

  if (condition.dim) {
    if (!dimIds.has(condition.dim)) errors.push(`${path} 引用了不存在的维度: ${condition.dim}`);
    validateConditionNumbers(condition, path, errors);
    return;
  }

  for (const [dimId, value] of Object.entries(condition)) {
    if (!dimIds.has(dimId)) errors.push(`${path} 引用了不存在的维度: ${dimId}`);
    if (value && typeof value === 'object') validateConditionNumbers(value, `${path}.${dimId}`, errors);
  }
}

function validateConditionNumbers(condition, path, errors) {
  ['min', 'max', 'probability'].forEach(key => {
    if (condition[key] !== undefined && !Number.isFinite(Number(condition[key]))) {
      errors.push(`${path}.${key} 必须是数字`);
    }
  });
  if (condition.probability !== undefined) {
    const p = Number(condition.probability);
    if (p < 0 || p > 1) errors.push(`${path}.probability 必须在 0 到 1 之间`);
  }
}

function validateEffectDims(effects, dimIds, path, errors) {
  const stickyDims = effects?.sticky?.dims;
  if (!stickyDims || typeof stickyDims !== 'object') return;
  for (const [dimId, value] of Object.entries(stickyDims)) {
    if (!dimIds.has(dimId)) errors.push(`${path} 的持续效果引用了不存在的维度: ${dimId}`);
    if (!Number.isFinite(Number(value))) errors.push(`${path} 的持续效果 ${dimId} 必须是数字`);
  }
}
