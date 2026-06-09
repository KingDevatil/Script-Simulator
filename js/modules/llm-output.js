import { extractKeyEvents, extractNarrative, extractValues } from './script-engine.js';

export function parseLLMTurn(rawText, script = {}) {
  const text = String(rawText || '').trim();
  const attempts = collectJsonCandidates(text);
  const errors = [];

  for (const candidate of attempts) {
    try {
      const data = JSON.parse(candidate);
      const normalized = normalizeTurn(data, script, 'json');
      if (normalized.turn.narrative || normalized.turn.options.length) {
        return normalized;
      }
    } catch (err) {
      errors.push(err.message);
    }
  }

  const legacy = normalizeLegacyTurn(text, script);
  return {
    status: legacy.turn.narrative ? 'legacy' : 'fallback',
    turn: legacy.turn,
    errors,
    warnings: legacy.warnings
  };
}

export function buildRepairPrompt(rawText, script = {}) {
  const dimIds = (script.dimensions || []).map(d => d.id).filter(Boolean);
  return [
    '下面的模型输出不是合法 JSON，或不符合指定 schema。',
    '不要续写剧情，不要解释原因，只把原输出修复为一个 JSON 对象。',
    'schema:',
    '{',
    '  "narrative": "剧情正文字符串",',
    '  "options": [{"label":"A","text":"选项内容","value":"玩家选择时发送的文本"}],',
    '  "values": {"维度ID": 0},',
    '  "keyEvent": null,',
    '  "stageHint": null',
    '}',
    `可用维度 ID: ${dimIds.join(', ') || '无'}`,
    '原输出:',
    rawText
  ].join('\n');
}

export function formatTurnForStorage(turn) {
  const lines = [];
  if (turn.narrative) lines.push(turn.narrative.trim());
  if (turn.options?.length) {
    lines.push('', '【选项】');
    turn.options.forEach((opt, index) => {
      const label = opt.label || String.fromCharCode(65 + index);
      lines.push(`${label}. ${opt.text || opt.value || ''}`);
    });
  }
  if (turn.values && Object.keys(turn.values).length) {
    lines.push('', '【数值更新】');
    lines.push(JSON.stringify(turn.values));
  }
  if (turn.keyEvent) lines.push('', `【关键事件】${turn.keyEvent}`);
  return lines.join('\n').trim();
}

export function getMessageTurn(message, script = {}) {
  if (message?.parsed) return message.parsed;
  return parseLLMTurn(message?.content || '', script).turn;
}

function collectJsonCandidates(text) {
  const candidates = [];
  if (!text) return candidates;
  candidates.push(text);

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());

  const tagged = text.match(/(?:<json>|【JSON】)([\s\S]*?)(?:<\/json>|$)/i);
  if (tagged) candidates.push(tagged[1].trim());

  const balanced = extractBalancedObject(text);
  if (balanced) candidates.push(balanced);

  return [...new Set(candidates.map(repairJsonText))];
}

function extractBalancedObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function repairJsonText(text) {
  return String(text || '')
    .trim()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

function normalizeLegacyTurn(text, script) {
  const options = extractLegacyOptions(text);
  const values = extractValues(text, script.dimensions || []) || {};
  return normalizeTurn({
    narrative: extractNarrative(text) || text,
    options,
    values,
    keyEvent: extractKeyEvents(text),
    stageHint: null
  }, script, 'legacy');
}

function normalizeTurn(data, script, status) {
  const warnings = [];
  const dimensions = script.dimensions || [];
  const dimById = new Map(dimensions.map(d => [d.id, d]));
  const dimNameToId = new Map(dimensions.map(d => [d.name, d.id]));
  const rawValues = data?.values && typeof data.values === 'object' ? data.values : {};
  const values = {};

  for (const [key, rawValue] of Object.entries(rawValues)) {
    const dimId = dimById.has(key) ? key : dimNameToId.get(key);
    if (!dimId) {
      warnings.push(`忽略未知维度: ${key}`);
      continue;
    }
    const num = Number(rawValue);
    if (!Number.isFinite(num)) {
      warnings.push(`忽略非数字维度值: ${key}`);
      continue;
    }
    const dim = dimById.get(dimId);
    const min = Number(dim.range?.[0] ?? -Infinity);
    const max = Number(dim.range?.[1] ?? Infinity);
    const clamped = Math.max(min, Math.min(max, Math.round(num)));
    if (clamped !== num) warnings.push(`维度 ${dimId} 已限制到范围 ${min}-${max}`);
    values[dimId] = clamped;
  }

  const options = normalizeOptions(data?.options);
  if (!options.length) warnings.push('未解析到选项');

  return {
    status,
    turn: {
      narrative: typeof data?.narrative === 'string' ? data.narrative.trim() : '',
      options,
      values,
      keyEvent: typeof data?.keyEvent === 'string' && data.keyEvent.trim() ? data.keyEvent.trim() : null,
      stageHint: typeof data?.stageHint === 'string' && data.stageHint.trim() ? data.stageHint.trim() : null
    },
    errors: [],
    warnings
  };
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt, index) => {
      if (typeof opt === 'string') {
        return { label: String.fromCharCode(65 + index), text: opt.trim(), value: opt.trim() };
      }
      if (!opt || typeof opt !== 'object') return null;
      const text = String(opt.text || opt.content || opt.label || opt.value || '').trim();
      if (!text) return null;
      return {
        label: String(opt.label || String.fromCharCode(65 + index)).trim().slice(0, 3),
        text,
        value: String(opt.value || text).trim()
      };
    })
    .filter(Boolean)
    .slice(0, 4);
}

function extractLegacyOptions(text) {
  const block = String(text || '').match(/【选项】([\s\S]*?)(?=【|$)/);
  if (!block) return [];
  return block[1].split('\n').map(line => {
    const m = line.match(/^([A-Z])[.、)）]\s*(.+)/);
    return m ? { label: m[1], text: m[2].trim(), value: m[2].trim() } : null;
  }).filter(Boolean).slice(0, 4);
}
