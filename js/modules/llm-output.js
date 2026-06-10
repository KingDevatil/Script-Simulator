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

  const jsonLike = normalizeJsonLikeTurn(text, script);
  if (jsonLike.turn.narrative || jsonLike.turn.options.length) {
    return {
      status: 'json-like',
      turn: jsonLike.turn,
      errors,
      warnings: jsonLike.warnings
    };
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
    '如果原输出缺少 options，必须补出 2-4 个可交互选项。',
    '选项最多 4 个，而且每个选项必须有明显不同的行动偏向，不能只是同义改写。',
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
  // 数值更新不再存入对话历史（已在 prompt 的【当前数值】部分单独注入）
  if (turn.keyEvent) lines.push('', `【关键事件】${turn.keyEvent}`);
  return lines.join('\n').trim();
}

export function getMessageTurn(message, script = {}) {
  const parsedFromContent = parseLLMTurn(message?.content || '', script);
  if (parsedFromContent.status === 'json' && isUsableTurn(parsedFromContent.turn)) {
    return parsedFromContent.turn;
  }
  if (message?.parsed && isUsableTurn(message.parsed) && !looksLikeJsonPayload(message.parsed.narrative)) {
    return message.parsed;
  }
  if (isUsableTurn(parsedFromContent.turn)) return parsedFromContent.turn;
  return message?.parsed || parsedFromContent.turn;
}

function isUsableTurn(turn) {
  return !!(turn && (turn.narrative || turn.options?.length));
}

function looksLikeJsonPayload(text) {
  const value = String(text || '').trim();
  return value.startsWith('{') || value.startsWith('```json') || value.includes('"narrative"');
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

function normalizeJsonLikeTurn(text, script) {
  if (!String(text || '').includes('"narrative"')) {
    return normalizeTurn({}, script, 'json-like');
  }
  return normalizeTurn({
    narrative: readJsonLikeString(text, 'narrative'),
    options: readJsonLikeOptions(text),
    values: readJsonLikeValues(text),
    keyEvent: readJsonLikeString(text, 'keyEvent'),
    stageHint: readJsonLikeString(text, 'stageHint')
  }, script, 'json-like');
}

function readJsonLikeString(text, key) {
  const source = String(text || '');
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex < 0) return '';
  const colonIndex = source.indexOf(':', keyIndex);
  if (colonIndex < 0) return '';
  const afterColon = source.slice(colonIndex + 1).trimStart();
  if (afterColon.startsWith('null') || afterColon.startsWith('undefined')) return '';
  let quoteIndex = source.indexOf('"', colonIndex + 1);
  if (quoteIndex < 0) return '';
  let value = '';
  let escaped = false;
  for (let i = quoteIndex + 1; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      value += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') return value.trim();
    value += ch;
  }
  return value.trim();
}

function readJsonLikeOptions(text) {
  const source = String(text || '');
  const optionsIndex = source.indexOf('"options"');
  if (optionsIndex < 0) return [];
  const arrayStart = source.indexOf('[', optionsIndex);
  if (arrayStart < 0) return [];

  const options = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = arrayStart; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        const rawObject = source.slice(objectStart, i + 1);
        const label = readJsonLikeString(rawObject, 'label');
        const textValue = readJsonLikeString(rawObject, 'text');
        const value = readJsonLikeString(rawObject, 'value') || textValue;
        if (textValue || value) options.push({ label, text: textValue || value, value });
        objectStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }
  return options;
}

function readJsonLikeValues(text) {
  const source = String(text || '');
  const valuesIndex = source.indexOf('"values"');
  if (valuesIndex < 0) return {};
  const objectStart = source.indexOf('{', valuesIndex);
  if (objectStart < 0) return {};
  const objectText = extractBalancedObject(source.slice(objectStart)) || '';
  const values = {};
  for (const match of objectText.matchAll(/"([^"]+)"\s*:\s*(-?\d+(?:\.\d+)?)/g)) {
    values[match[1]] = Number(match[2]);
  }
  return values;
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
        value: text
      };
    })
    .filter(Boolean)
    .slice(0, 4);
}

function extractLegacyOptions(text) {
  const block = String(text || '').match(/【选项】([\s\S]*?)(?=【|$)/);
  const lines = block ? block[1].split('\n') : String(text || '').split('\n');
  return lines.map(line => {
    const m = line.match(/^([A-Z])[.、)）]\s*(.+)/);
    return m ? { label: m[1], text: m[2].trim(), value: m[2].trim() } : null;
  }).filter(Boolean).slice(0, 4);
}

/**
 * 从 AI 输出中提取角色名（"人名（身份标签）"格式）
 * 返回 {角色id: 人名} 映射
 */
export function extractCharacterNames(text, script, existingNames = {}) {
  const names = {};
  const chars = (script.characters || []).filter(c => c.id !== 'player');
  if (!chars.length || !text) return names;

  const textStr = String(text);
  for (const c of chars) {
    const label = c.name;
    const candidates = [
      ...extractBracketNames(textStr, label),
      ...extractTitlePrefixNames(textStr, label)
    ];

    for (const candidate of candidates) {
      const name = normalizeChineseNameCandidate(candidate, label);
      if (!name || names[c.id]) continue;
      if (existingNames[c.id] && existingNames[c.id] !== name && isReliableCharacterName(existingNames[c.id], label)) {
        console.warn(`角色名不一致：已确定为"${existingNames[c.id]}"，但检测到"${name}"，保持使用已确定的名称`);
        names[c.id] = existingNames[c.id];
      } else {
        names[c.id] = name;
      }
    }
  }
  return names;
}

export function buildCharacterNameExtractionPrompt(sourceText, characters) {
  return [
    '请从下面的剧情正文中识别角色真实姓名。',
    '只输出一个 JSON 对象，不要 Markdown，不要解释。',
    'JSON 的 key 必须使用给定角色 id，value 是该角色的人名。无法确定时不要输出该 key。',
    '不要把身份称谓、官职、性格描述当成人名。',
    '',
    '待识别角色：',
    ...(characters || []).map(c => `- ${c.id}: ${c.name}`),
    '',
    '剧情正文：',
    sourceText
  ].join('\n');
}

export function parseCharacterNameExtraction(rawText, characters) {
  const allowedIds = new Set((characters || []).map(c => c.id));
  const balanced = String(rawText || '').match(/\{[\s\S]*\}/)?.[0] || '{}';
  try {
    const parsed = JSON.parse(balanced);
    const names = {};
    for (const [id, name] of Object.entries(parsed || {})) {
      const value = String(name || '').trim();
      if (allowedIds.has(id) && /^[\u4e00-\u9fa5]{2,4}$/.test(value)) names[id] = value;
    }
    return names;
  } catch {
    return {};
  }
}

function extractBracketNames(text, label) {
  const escaped = escapeRegExp(label);
  const regex = new RegExp(`(?:^|[\\s，。；、：:！!？?《》“”"'])(?:${NAME_PREFIX_SOURCE})?(${CHINESE_NAME_SOURCE})[（(]${escaped}[）)]`, 'g');
  return [...text.matchAll(regex)].map(match => match[1]);
}

function extractTitlePrefixNames(text, label) {
  const aliases = getRoleLabelAliases(label).map(escapeRegExp).join('|');
  const boundary = '(?=年|是|为|乃|带|捧|领|走|来|去|入|进|出|至|到|向|朝|对|问|道|说|低|躬|跪|站|坐|看|望|笑|叹|，|。|、|；|：|:|！|!|？|\\?|\\s|$)';
  const regex = new RegExp(`(?:^|[\\s，。；、：:！!？?《》“”"'])(?:${aliases})(${CHINESE_NAME_SOURCE})${boundary}`, 'g');
  return [...text.matchAll(regex)].map(match => match[1]);
}

const CHINESE_NAME_SOURCE = '[\\u4e00-\\u9fa5]{2,3}';
const NAME_PREFIX_SOURCE = '后来|随后|接着|只见|这时|此时|而后|却见|又见|原来|其中';
const NAME_PREFIX_WORDS = /^(后来|随后|接着|只见|这时|此时|而后|却见|又见|原来|其中)/;
const NON_NAME_WORDS = new Set([
  '多疑', '深沉', '善妒', '狠辣', '圆滑', '世故', '心腹', '新人', '娘娘',
  '陛下', '公公', '宫女', '太监', '皇帝', '贵妃', '皇后', '选侍'
]);

function normalizeChineseNameCandidate(candidate, label) {
  let name = String(candidate || '').trim().replace(NAME_PREFIX_WORDS, '');
  if (!isReliableCharacterName(name, label)) return '';
  return name;
}

function isReliableCharacterName(name, label) {
  const value = String(name || '').trim();
  if (!new RegExp(`^${CHINESE_NAME_SOURCE}$`).test(value)) return false;
  if (value === label || value.includes(label) || label.includes(value)) return false;
  if (NON_NAME_WORDS.has(value)) return false;
  return true;
}

function getRoleLabelAliases(label) {
  const aliases = new Set([label]);
  if (label.includes('太监')) aliases.add(label.replace('太监', '大监'));
  if (label.includes('大监')) aliases.add(label.replace('大监', '太监'));
  return [...aliases].filter(Boolean);
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
