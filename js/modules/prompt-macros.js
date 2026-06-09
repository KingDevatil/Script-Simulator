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
      case 'player': return charMap.player || '玩家';
      case 'partner': return charMap.partner || '现任';
      case 'target': return charMap.target || '危险对象';
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
      default:
        return `{{${key}${arg ? ':' + arg : ''}}}`;
    }
  });
}
