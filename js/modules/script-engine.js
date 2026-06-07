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

export function checkEventTriggers(events, values, currentStage) {
  const triggered = [];
  for (const event of events) {
    if (event.stage !== undefined && event.stage !== currentStage) continue;
    if (!event.trigger) continue;

    let shouldTrigger = true;
    for (const [dimId, condition] of Object.entries(event.trigger)) {
      const val = values[dimId];
      if (val === undefined) { shouldTrigger = false; break; }
      if (condition.min !== undefined && val < condition.min) { shouldTrigger = false; break; }
      if (condition.max !== undefined && val > condition.max) { shouldTrigger = false; break; }
      if (condition.probability !== undefined) {
        if (Math.random() > condition.probability) { shouldTrigger = false; break; }
      }
    }
    if (shouldTrigger) triggered.push(event);
  }
  return triggered;
}

export function checkStageTransition(stages, values, currentStage) {
  if (currentStage >= stages.length - 1) return currentStage;
  const nextStage = stages[currentStage + 1];
  if (!nextStage?.transition) return currentStage;

  for (const [dimId, condition] of Object.entries(nextStage.transition)) {
    const val = values[dimId];
    if (val === undefined) return currentStage;
    if (condition.min !== undefined && val < condition.min) return currentStage;
    if (condition.max !== undefined && val > condition.max) return currentStage;
  }
  return currentStage + 1;
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
