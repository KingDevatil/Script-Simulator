import { getScript, saveScript } from '../db.js';
import { navigate } from '../router.js';
import { parseScript } from '../modules/script-engine.js';

let script = {};
let openSections = new Set(['basic','rules','dimensions','characters','events','stages','endings','setup']);
let editingItems = {};
let newItems = new Set();
let clickHandler = null;

export async function render(container, { scriptId }) {
  script = await getScript(scriptId);
  if (!script) { navigate('home'); return; }
  script.rules = script.rules || { writing_style: '', forbidden: [], requirements: [] };
  script.dimensions = script.dimensions || [];
  script.characters = script.characters || [];
  script.events = script.events || [];
  script.stages = script.stages || [];
  script.endings = script.endings || [];
  script.setup = script.setup || [];
  renderPage(container);
}

function renderPage(container) {
  container.innerHTML = `
    <div class="header">
      <button class="header-btn" id="btn-back">&larr;</button>
      <h1 style="font-size:15px">编辑剧本</h1>
      <div style="display:flex;gap:4px">
        <button class="header-btn" id="btn-export" title="导出 JSON">&#8681;</button>
        <button class="header-btn" id="btn-import" title="导入 JSON">&#8679;</button>
        <button class="header-btn" id="btn-save" title="保存" style="color:var(--accent)">&#10003;</button>
      </div>
    </div>
    <div class="page-scroll" id="editor-scroll">
      ${renderSection('basic', '基本信息', renderBasicInfo(), 'editor-full')}
      ${renderSection('rules', '写作规则', renderRules(), 'editor-full')}
      <div class="editor-grid">
        ${renderSection('dimensions', '数值维度', renderDimensions())}
        ${renderSection('characters', '角色设定', renderCharacters())}
        ${renderSection('events', '关键事件', renderEvents())}
        ${renderSection('stages', '剧情阶段', renderStages())}
        ${renderSection('endings', '结局设定', renderEndings())}
        ${renderSection('setup', '开局选项', renderSetup())}
      </div>
      ${renderSection('json', '高级 JSON 编辑', renderJsonAdvanced(), 'editor-full')}
    </div>
    <input type="file" id="file-import" accept=".json" style="display:none">
  `;
  attachEvents(container);
}

function renderSection(key, title, content, extraClass) {
  const open = openSections.has(key);
  return `<div class="editor-section${extraClass ? ' ' + extraClass : ''}" data-section="${key}">
    <div class="section-header ${open ? 'open' : ''}" data-section-toggle="${key}">
      <span class="section-arrow">${open ? '&#9660;' : '&#9654;'}</span>
      <span>${title}</span>
    </div>
    <div class="section-body" style="${open ? '' : 'display:none'}">${content}</div>
  </div>`;
}

function toggleSection(key) {
  if (openSections.has(key)) openSections.delete(key);
  else openSections.add(key);
}

// ─── 基本信息 ───
function renderBasicInfo() {
  return `
    <div class="form-group">
      <label class="form-label">剧本名称</label>
      <input class="form-input" data-field="name" value="${esc(script.name || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">描述</label>
      <textarea class="form-input" data-field="description" rows="3">${esc(script.description || '')}</textarea>
    </div>`;
}

// ─── 写作规则 ───
function renderRules() {
  const r = script.rules;
  return `
    <div class="form-group">
      <label class="form-label">写作风格</label>
      <textarea class="form-input" data-field="rules.writing_style" rows="3">${esc(r.writing_style || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">禁止事项</label>
      ${renderTagList(r.forbidden || [], 'rules.forbidden')}
    </div>
    <div class="form-group">
      <label class="form-label">写作要求</label>
      ${renderTagList(r.requirements || [], 'rules.requirements')}
    </div>`;
}

// ─── 数值维度 ───
function renderDimensions() {
  const dims = script.dimensions || [];
  let html = '';
  dims.forEach((d, i) => {
    const editing = editingItems[`dim_${i}`];
    if (editing) {
      html += `<div class="card" style="border-color:var(--accent)">
        <div class="form-group"><label class="form-label">ID</label><input class="form-input" value="${esc(d.id || '')}" data-dim="${i}" data-subfield="id"></div>
        <div class="form-group"><label class="form-label">名称</label><input class="form-input" value="${esc(d.name || '')}" data-dim="${i}" data-subfield="name"></div>
        <div class="form-group"><label class="form-label">作用对象（可选，支持宏如 {{target}}）</label><input class="form-input" value="${esc(d.scope || '')}" data-dim="${i}" data-subfield="scope" placeholder="如：对{{target}}"></div>
        <div style="display:flex;gap:8px">
          <div class="form-group" style="flex:1"><label class="form-label">范围 min</label><input class="form-input" type="number" value="${d.range?.[0] ?? 0}" data-dim="${i}" data-subfield="range_min"></div>
          <div class="form-group" style="flex:1"><label class="form-label">范围 max</label><input class="form-input" type="number" value="${d.range?.[1] ?? 100}" data-dim="${i}" data-subfield="range_max"></div>
        </div>
        <div style="display:flex;gap:8px">
          <div class="form-group" style="flex:1"><label class="form-label">初始 min</label><input class="form-input" type="number" value="${d.initial?.[0] ?? 0}" data-dim="${i}" data-subfield="initial_min"></div>
          <div class="form-group" style="flex:1"><label class="form-label">初始 max</label><input class="form-input" type="number" value="${d.initial?.[1] ?? 0}" data-dim="${i}" data-subfield="initial_max"></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" data-action="dim-save" data-idx="${i}">确定</button>
          <button class="btn btn-sm btn-secondary" data-action="dim-cancel" data-idx="${i}">取消</button>
        </div>
      </div>`;
    } else {
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${esc(d.name || d.id)}</strong>${d.scope ? ` <span style="color:var(--accent);font-size:11px">${esc(d.scope)}</span>` : ''} <span style="color:var(--text-dim);font-size:12px">范围 ${d.range?.[0]}-${d.range?.[1]} 初始 ${d.initial?.[0]}-${d.initial?.[1]}</span></div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm btn-secondary" data-action="dim-edit" data-idx="${i}">编辑</button>
            <button class="btn btn-sm btn-secondary" style="color:var(--accent)" data-action="dim-delete" data-idx="${i}">&times;</button>
          </div>
        </div>
      </div>`;
    }
  });
  html += `<button class="btn btn-sm btn-secondary btn-block" data-action="dim-add" style="margin-top:8px">+ 新增维度</button>`;
  return html;
}

// ─── 角色设定 ───
function renderCharacters() {
  const chars = script.characters || [];
  let html = '';
  chars.forEach((c, i) => {
    const editing = editingItems[`char_${i}`];
    if (editing) {
      html += `<div class="card" style="border-color:var(--accent)">
        <div class="form-group"><label class="form-label">ID</label><input class="form-input" value="${esc(c.id || '')}" data-char="${i}" data-subfield="id"></div>
        <div class="form-group"><label class="form-label">名称</label><input class="form-input" value="${esc(c.name || '')}" data-char="${i}" data-subfield="name"></div>
        <div class="form-group"><label class="form-label">描述</label><textarea class="form-input" rows="2" data-char="${i}" data-subfield="description">${esc(c.description || '')}</textarea></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" data-action="char-save" data-idx="${i}">确定</button>
          <button class="btn btn-sm btn-secondary" data-action="char-cancel" data-idx="${i}">取消</button>
        </div>
      </div>`;
    } else {
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${esc(c.name || c.id)}</strong> <span style="color:var(--text-dim);font-size:12px">${esc(c.description || '').substring(0, 30)}</span></div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm btn-secondary" data-action="char-edit" data-idx="${i}">编辑</button>
            <button class="btn btn-sm btn-secondary" style="color:var(--accent)" data-action="char-delete" data-idx="${i}">&times;</button>
          </div>
        </div>
      </div>`;
    }
  });
  html += `<button class="btn btn-sm btn-secondary btn-block" data-action="char-add" style="margin-top:8px">+ 新增角色</button>`;
  return html;
}

// ─── 关键事件 ───
function renderEvents() {
  const events = script.events || [];
  let html = '';
  events.forEach((e, i) => {
    const editing = editingItems[`event_${i}`];
    if (editing) {
      html += `<div class="card" style="border-color:var(--accent)">
        <div class="form-group"><label class="form-label">事件名称</label><input class="form-input" value="${esc(e.name || '')}" data-event="${i}" data-subfield="name"></div>
        <div class="form-group"><label class="form-label">所属阶段 (0-${(script.stages?.length || 1) - 1})</label><input class="form-input" type="number" min="0" value="${e.stage ?? 0}" data-event="${i}" data-subfield="stage"></div>
        <div class="form-group"><label class="form-label">触发条件</label>
          ${renderConditionEditor(e.trigger || {}, `event_${i}_trigger`)}
        </div>
        <div class="form-group"><label class="form-label">描述</label><textarea class="form-input" rows="2" data-event="${i}" data-subfield="description">${esc(e.description || '')}</textarea></div>
        <div class="form-group">
          <label class="form-label">持续效果</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px">
              <label class="form-label" style="font-size:11px">Sticky 持续轮数</label>
              <input class="form-input" type="number" min="0" placeholder="0=不启用" value="${e.effects?.sticky?.duration || ''}" data-event="${i}" data-subfield="sticky_duration">
            </div>
            <div style="flex:1;min-width:120px">
              <label class="form-label" style="font-size:11px">Cooldown 冷却轮数</label>
              <input class="form-input" type="number" min="0" placeholder="0=不启用" value="${e.effects?.cooldown || ''}" data-event="${i}" data-subfield="cooldown">
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" data-action="event-save" data-idx="${i}">确定</button>
          <button class="btn btn-sm btn-secondary" data-action="event-cancel" data-idx="${i}">取消</button>
        </div>
      </div>`;
    } else {
      const condStr = formatCondition(e.trigger);
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;word-break:break-word">
            <strong>${esc(e.name || '未命名')}</strong>
            <div style="color:var(--text-dim);font-size:12px;margin-top:2px">阶段 ${e.stage ?? 0} &middot; ${condStr}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn btn-sm btn-secondary" data-action="event-edit" data-idx="${i}">编辑</button>
            <button class="btn btn-sm btn-secondary" style="color:var(--accent)" data-action="event-delete" data-idx="${i}">&times;</button>
          </div>
        </div>
      </div>`;
    }
  });
  html += `<button class="btn btn-sm btn-secondary btn-block" data-action="event-add" style="margin-top:8px">+ 新增事件</button>`;
  return html;
}

// ─── 剧情阶段 ───
function renderStages() {
  const stages = script.stages || [];
  let html = '';
  stages.forEach((s, i) => {
    const editing = editingItems[`stage_${i}`];
    if (editing) {
      html += `<div class="card" style="border-color:var(--accent)">
        <div class="form-group"><label class="form-label">阶段名称</label><input class="form-input" value="${esc(s.name || '')}" data-stage="${i}" data-subfield="name"></div>
        <div class="form-group"><label class="form-label">过渡条件</label>
          ${renderConditionEditor(s.transition || {}, `stage_${i}_transition`)}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" data-action="stage-save" data-idx="${i}">确定</button>
          <button class="btn btn-sm btn-secondary" data-action="stage-cancel" data-idx="${i}">取消</button>
        </div>
      </div>`;
    } else {
      const condStr = formatCondition(s.transition);
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;word-break:break-word">
            <strong>${i + 1}. ${esc(s.name || '未命名')}</strong>
            ${condStr ? `<div style="color:var(--text-dim);font-size:12px;margin-top:2px">${condStr}</div>` : ''}
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn btn-sm btn-secondary" data-action="stage-edit" data-idx="${i}">编辑</button>
            <button class="btn btn-sm btn-secondary" style="color:var(--accent)" data-action="stage-delete" data-idx="${i}">&times;</button>
          </div>
        </div>
      </div>`;
    }
  });
  html += `<button class="btn btn-sm btn-secondary btn-block" data-action="stage-add" style="margin-top:8px">+ 新增阶段</button>`;
  return html;
}

// ─── 结局设定 ───
function renderEndings() {
  const endings = script.endings || [];
  let html = '';
  endings.forEach((e, i) => {
    const editing = editingItems[`ending_${i}`];
    if (editing) {
      html += `<div class="card" style="border-color:var(--accent)">
        <div class="form-group"><label class="form-label">结局名称</label><input class="form-input" value="${esc(e.name || '')}" data-ending="${i}" data-subfield="name"></div>
        <div class="form-group"><label class="form-label">达成条件</label>
          ${renderConditionEditor(e.condition || {}, `ending_${i}_condition`)}
        </div>
        <div class="form-group"><label class="form-label">描述</label><textarea class="form-input" rows="2" data-ending="${i}" data-subfield="description">${esc(e.description || '')}</textarea></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" data-action="ending-save" data-idx="${i}">确定</button>
          <button class="btn btn-sm btn-secondary" data-action="ending-cancel" data-idx="${i}">取消</button>
        </div>
      </div>`;
    } else {
      const condStr = formatCondition(e.condition);
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;word-break:break-word">
            <strong>${esc(e.name || '未命名')}</strong>
            <div style="color:var(--text-dim);font-size:12px;margin-top:2px">${condStr || '无条件'}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn btn-sm btn-secondary" data-action="ending-edit" data-idx="${i}">编辑</button>
            <button class="btn btn-sm btn-secondary" style="color:var(--accent)" data-action="ending-delete" data-idx="${i}">&times;</button>
          </div>
        </div>
      </div>`;
    }
  });
  html += `<button class="btn btn-sm btn-secondary btn-block" data-action="ending-add" style="margin-top:8px">+ 新增结局</button>`;
  return html;
}

// ─── 开局选项 ───
function renderSetup() {
  const setup = script.setup || [];
  let html = '';
  setup.forEach((s, i) => {
    const editing = editingItems[`setup_${i}`];
    if (editing) {
      html += `<div class="card" style="border-color:var(--accent)">
        <div class="form-group"><label class="form-label">步骤名称</label><input class="form-input" value="${esc(s.step || '')}" data-setup="${i}" data-subfield="step"></div>
        <div class="form-group"><label class="form-label">选项列表</label>
          ${renderOptionEditor(s.options || [], i)}
        </div>
        <div class="form-group">
          <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" ${s.allow_custom ? 'checked' : ''} data-setup="${i}" data-subfield="allow_custom" style="width:16px;height:16px">
            允许自定义输入
          </label>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" data-action="setup-save" data-idx="${i}">确定</button>
          <button class="btn btn-sm btn-secondary" data-action="setup-cancel" data-idx="${i}">取消</button>
        </div>
      </div>`;
    } else {
      const optCount = (s.options || []).length;
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;word-break:break-word">
            <strong>${esc(s.step || '未命名')}</strong>
            <div style="color:var(--text-dim);font-size:12px;margin-top:2px">${optCount} 个选项${s.allow_custom ? ' · 允许自定义' : ''}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn btn-sm btn-secondary" data-action="setup-edit" data-idx="${i}">编辑</button>
            <button class="btn btn-sm btn-secondary" style="color:var(--accent)" data-action="setup-delete" data-idx="${i}">&times;</button>
          </div>
        </div>
      </div>`;
    }
  });
  html += `<button class="btn btn-sm btn-secondary btn-block" data-action="setup-add" style="margin-top:8px">+ 新增开局选项</button>`;
  return html;
}

// ─── 高级 JSON 编辑 ───
function renderJsonAdvanced() {
  return `
    <div class="form-group">
      <label class="form-label">原始 JSON（仅在需要微调时使用）</label>
      <textarea class="form-input" id="f-json" rows="12" style="font-family:monospace;font-size:12px;resize:vertical">${esc(JSON.stringify(script, null, 2))}</textarea>
    </div>
    <button class="btn btn-sm btn-secondary" data-action="json-apply">从 JSON 同步到表单</button>`;
}

// ═══════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// 标签列表（用于 forbidden / requirements 等字符串数组）
function renderTagList(items, fieldPath) {
  let html = '<div class="field-list">';
  items.forEach((item, i) => {
    html += `<span class="field-tag">${esc(item)}<button class="field-tag-x" data-action="tag-remove" data-field="${fieldPath}" data-idx="${i}">&times;</button></span>`;
  });
  html += `</div>
    <div style="display:flex;gap:6px;margin-top:6px">
      <input class="form-input" style="flex:1" placeholder="输入内容..." data-tag-input="${fieldPath}">
      <button class="btn btn-sm btn-secondary" data-action="tag-add" data-field="${fieldPath}">添加</button>
    </div>`;
  return html;
}

// 条件编辑器（支持旧格式 + 新格式 and/or 组合）
function renderConditionEditor(condObj, prefix) {
  const dims = script.dimensions || [];
  let entries = [];
  let op = 'and';

  // 解析新格式 or 旧格式
  if (condObj && condObj.op && condObj.conditions) {
    op = condObj.op;
    entries = condObj.conditions.map(c => [c.dim || '', { min: c.min, max: c.max, probability: c.probability }]);
  } else if (condObj && typeof condObj === 'object') {
    entries = Object.entries(condObj).filter(([k]) => k !== 'op' && k !== 'conditions');
  }
  if (entries.length === 0) entries.push(['', { min: '', max: '', probability: '' }]);

  const showOp = entries.length > 1;
  let html = '';
  if (showOp) {
    html += `<div style="display:flex;gap:8px;margin-bottom:6px;align-items:center;font-size:12px;color:var(--text-dim)">
      <label style="cursor:pointer"><input type="radio" name="op_${prefix}" value="and" ${op === 'and' ? 'checked' : ''} data-cond-op="${prefix}"> 全部满足 (AND)</label>
      <label style="cursor:pointer"><input type="radio" name="op_${prefix}" value="or" ${op === 'or' ? 'checked' : ''} data-cond-op="${prefix}"> 任一满足 (OR)</label>
    </div>`;
  }
  html += '<div class="condition-list">';
  entries.forEach(([dimId, cond], ci) => {
    html += `<div class="condition-row" data-cond-prefix="${prefix}" data-cond-idx="${ci}">
      <select class="form-input cond-dim" style="flex:2;font-size:12px" data-cond-prefix="${prefix}" data-cond-idx="${ci}" data-cond-field="dimId">
        <option value="">选择维度</option>
        ${dims.map(d => `<option value="${d.id}" ${d.id === dimId ? 'selected' : ''}>${esc(d.name || d.id)}</option>`).join('')}
      </select>
      <input class="form-input cond-min" style="flex:1;font-size:12px" type="number" placeholder="min" value="${cond.min ?? ''}" data-cond-prefix="${prefix}" data-cond-idx="${ci}" data-cond-field="min">
      <input class="form-input cond-max" style="flex:1;font-size:12px" type="number" placeholder="max" value="${cond.max ?? ''}" data-cond-prefix="${prefix}" data-cond-idx="${ci}" data-cond-field="max">
      <input class="form-input cond-prob" style="flex:1;font-size:12px" type="number" step="0.1" min="0" max="1" placeholder="概率" value="${cond.probability ?? ''}" data-cond-prefix="${prefix}" data-cond-idx="${ci}" data-cond-field="probability">
      <button class="btn btn-sm btn-secondary" style="padding:4px 8px;color:var(--accent)" data-action="cond-remove" data-cond-prefix="${prefix}" data-cond-idx="${ci}">&times;</button>
    </div>`;
  });
  html += `</div>
    <button class="btn btn-sm btn-secondary" data-action="cond-add" data-cond-prefix="${prefix}" style="margin-top:6px;font-size:12px">+ 添加条件</button>`;
  return html;
}

// 选项编辑器（用于 setup.options）
function renderOptionEditor(options, setupIdx) {
  let html = '<div class="option-list">';
  options.forEach((opt, oi) => {
    html += `<div class="option-row" data-setup-idx="${setupIdx}" data-opt-idx="${oi}">
      <input class="form-input" style="flex:1;font-size:12px" placeholder="显示文本" value="${esc(opt.label || '')}" data-setup="${setupIdx}" data-opt="${oi}" data-opt-field="label">
      <input class="form-input" style="flex:1;font-size:12px" placeholder="实际值" value="${esc(opt.value || '')}" data-setup="${setupIdx}" data-opt="${oi}" data-opt-field="value">
      <button class="btn btn-sm btn-secondary" style="padding:4px 8px;color:var(--accent)" data-action="opt-remove" data-setup-idx="${setupIdx}" data-opt-idx="${oi}">&times;</button>
    </div>`;
  });
  html += `</div>
    <button class="btn btn-sm btn-secondary" data-action="opt-add" data-setup-idx="${setupIdx}" style="margin-top:6px;font-size:12px">+ 添加选项</button>`;
  return html;
}

// 格式化条件为可读文本
function formatCondition(cond) {
  if (!cond || typeof cond !== 'object') return '';
  const dims = script.dimensions || [];

  // 新格式：{ op, conditions }
  if (cond.op && cond.conditions) {
    const opLabel = cond.op === 'or' ? ' 或 ' : ' 且 ';
    return cond.conditions.map(c => {
      const dim = dims.find(d => d.id === c.dim);
      const name = dim ? dim.name : c.dim;
      const parts = [];
      if (c.min != null && c.min !== '') parts.push(`>=${c.min}`);
      if (c.max != null && c.max !== '') parts.push(`<=${c.max}`);
      if (c.probability != null && c.probability !== '') parts.push(`p=${c.probability}`);
      return `${name} ${parts.join(' ')}`;
    }).filter(Boolean).join(opLabel);
  }

  // 旧格式：{ dimId: { min, max, probability } }
  return Object.entries(cond).map(([dimId, c]) => {
    if (!c || typeof c !== 'object') return '';
    const dim = dims.find(d => d.id === dimId);
    const name = dim ? dim.name : dimId;
    const parts = [];
    if (c.min != null && c.min !== '') parts.push(`>=${c.min}`);
    if (c.max != null && c.max !== '') parts.push(`<=${c.max}`);
    if (c.probability != null && c.probability !== '') parts.push(`p=${c.probability}`);
    return `${name} ${parts.join(' ')}`;
  }).filter(Boolean).join(', ');
}

// 从 DOM 收集条件数据（单条件=旧格式，多条件=新格式 and/or）
function collectConditions(prefix) {
  const rows = document.querySelectorAll(`[data-cond-prefix="${prefix}"]`);
  const conditions = [];
  const seen = new Set();
  rows.forEach(row => {
    const ci = row.dataset.condIdx;
    if (seen.has(ci)) return;
    seen.add(ci);
    const dimId = document.querySelector(`[data-cond-prefix="${prefix}"][data-cond-idx="${ci}"][data-cond-field="dimId"]`)?.value;
    if (!dimId) return;
    const min = document.querySelector(`[data-cond-prefix="${prefix}"][data-cond-idx="${ci}"][data-cond-field="min"]`)?.value;
    const max = document.querySelector(`[data-cond-prefix="${prefix}"][data-cond-idx="${ci}"][data-cond-field="max"]`)?.value;
    const prob = document.querySelector(`[data-cond-prefix="${prefix}"][data-cond-idx="${ci}"][data-cond-field="probability"]`)?.value;
    const entry = { dim: dimId };
    if (min !== '' && min !== undefined) entry.min = Number(min);
    if (max !== '' && max !== undefined) entry.max = Number(max);
    if (prob !== '' && prob !== undefined) entry.probability = Number(prob);
    conditions.push(entry);
  });
  if (conditions.length === 0) return {};
  // 单条件：输出旧格式（向后兼容）
  if (conditions.length === 1) {
    const c = conditions[0];
    const result = {};
    const val = {};
    if (c.min !== undefined) val.min = c.min;
    if (c.max !== undefined) val.max = c.max;
    if (c.probability !== undefined) val.probability = c.probability;
    result[c.dim] = val;
    return result;
  }
  // 多条件：输出新格式
  const opEl = document.querySelector(`[data-cond-op="${prefix}"]:checked`);
  const op = opEl?.value || 'and';
  return { op, conditions };
}

// 从 DOM 收集选项数据
function collectOptions(setupIdx) {
  const opts = [];
  document.querySelectorAll(`[data-setup-idx="${setupIdx}"][data-opt-idx]`).forEach(row => {
    const oi = row.dataset.optIdx;
    const label = document.querySelector(`[data-setup="${setupIdx}"][data-opt="${oi}"][data-opt-field="label"]`)?.value?.trim();
    const value = document.querySelector(`[data-setup="${setupIdx}"][data-opt="${oi}"][data-opt-field="value"]`)?.value?.trim();
    if (label) opts.push({ label, value: value || label });
  });
  return opts;
}

// 读取表单字段值并同步到 script 对象
function syncFieldsToScript(container) {
  const get = sel => container.querySelector(sel)?.value;
  script.name = get('[data-field="name"]') || script.name;
  script.description = get('[data-field="description"]') ?? script.description;
  if (script.rules) script.rules.writing_style = get('[data-field="rules.writing_style"]') ?? script.rules.writing_style;
}

// 重新渲染页面（保持滚动位置和编辑状态）
function rerender(container) {
  const scrollEl = container.querySelector('#editor-scroll');
  const scrollTop = scrollEl?.scrollTop || 0;
  syncFieldsToScript(container);
  renderPage(container);
  const newScrollEl = container.querySelector('#editor-scroll');
  if (newScrollEl) newScrollEl.scrollTop = scrollTop;
}

// ═══════════════════════════════════════════
//  事件处理
// ═══════════════════════════════════════════

function attachEvents(container) {
  // 页头按钮
  container.querySelector('#btn-back').onclick = () => navigate('home');

  container.querySelector('#btn-save').onclick = async () => {
    syncFieldsToScript(container);
    const parsed = parseScript(script);
    await saveScript(parsed);
    alert('已保存');
  };

  container.querySelector('#btn-export').onclick = () => {
    syncFieldsToScript(container);
    const blob = new Blob([JSON.stringify(script, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${script.name || 'script'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  container.querySelector('#btn-import').onclick = () => container.querySelector('#file-import').click();
  container.querySelector('#file-import').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      script = parseScript(json);
      script.id = (await getScript(script.id))?.id || script.id;
      editingItems = {};
      rerender(container);
    } catch (err) { alert('导入失败: ' + err.message); }
  };

  // 折叠面板
  container.querySelectorAll('[data-section-toggle]').forEach(el => {
    el.onclick = () => {
      const key = el.dataset.sectionToggle;
      toggleSection(key);
      const body = el.nextElementSibling;
      const arrow = el.querySelector('.section-arrow');
      const isOpen = openSections.has(key);
      body.style.display = isOpen ? '' : 'none';
      el.classList.toggle('open', isOpen);
      arrow.innerHTML = isOpen ? '&#9660;' : '&#9654;';
    };
  });

  // 委托所有 data-action 点击（先移除旧监听器防止叠加）
  if (clickHandler) container.removeEventListener('click', clickHandler);
  clickHandler = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const idx = parseInt(btn.dataset.idx);

    // ── 数值维度 ──
    if (action === 'dim-add') {
      script.dimensions.push({ id: '', name: '', range: [0, 100], initial: [0, 0] });
      const k = `dim_${script.dimensions.length - 1}`;
      editingItems[k] = true;
      newItems.add(k);
      rerender(container);
    } else if (action === 'dim-edit') {
      editingItems[`dim_${idx}`] = true;
      rerender(container);
    } else if (action === 'dim-cancel') {
      const k = `dim_${idx}`;
      if (newItems.has(k)) { script.dimensions.splice(idx, 1); newItems.delete(k); }
      delete editingItems[k];
      rerender(container);
    } else if (action === 'dim-save') {
      saveDimFromDOM(container, idx);
      delete editingItems[`dim_${idx}`];
      newItems.delete(`dim_${idx}`);
      rerender(container);
    } else if (action === 'dim-delete') {
      script.dimensions.splice(idx, 1);
      rerender(container);
    }

    // ── 角色 ──
    else if (action === 'char-add') {
      script.characters.push({ id: '', name: '', description: '' });
      const k = `char_${script.characters.length - 1}`;
      editingItems[k] = true;
      newItems.add(k);
      rerender(container);
    } else if (action === 'char-edit') {
      editingItems[`char_${idx}`] = true;
      rerender(container);
    } else if (action === 'char-cancel') {
      const k = `char_${idx}`;
      if (newItems.has(k)) { script.characters.splice(idx, 1); newItems.delete(k); }
      delete editingItems[k];
      rerender(container);
    } else if (action === 'char-save') {
      saveCharFromDOM(container, idx);
      delete editingItems[`char_${idx}`];
      newItems.delete(`char_${idx}`);
      rerender(container);
    } else if (action === 'char-delete') {
      script.characters.splice(idx, 1);
      rerender(container);
    }

    // ── 事件 ──
    else if (action === 'event-add') {
      script.events.push({ name: '', stage: 0, trigger: {}, description: '' });
      const k = `event_${script.events.length - 1}`;
      editingItems[k] = true;
      newItems.add(k);
      rerender(container);
    } else if (action === 'event-edit') {
      editingItems[`event_${idx}`] = true;
      rerender(container);
    } else if (action === 'event-cancel') {
      const k = `event_${idx}`;
      if (newItems.has(k)) { script.events.splice(idx, 1); newItems.delete(k); }
      delete editingItems[k];
      rerender(container);
    } else if (action === 'event-save') {
      saveEventFromDOM(container, idx);
      delete editingItems[`event_${idx}`];
      newItems.delete(`event_${idx}`);
      rerender(container);
    } else if (action === 'event-delete') {
      script.events.splice(idx, 1);
      rerender(container);
    }

    // ── 阶段 ──
    else if (action === 'stage-add') {
      script.stages.push({ name: '', transition: {} });
      const k = `stage_${script.stages.length - 1}`;
      editingItems[k] = true;
      newItems.add(k);
      rerender(container);
    } else if (action === 'stage-edit') {
      editingItems[`stage_${idx}`] = true;
      rerender(container);
    } else if (action === 'stage-cancel') {
      const k = `stage_${idx}`;
      if (newItems.has(k)) { script.stages.splice(idx, 1); newItems.delete(k); }
      delete editingItems[k];
      rerender(container);
    } else if (action === 'stage-save') {
      saveStageFromDOM(container, idx);
      delete editingItems[`stage_${idx}`];
      newItems.delete(`stage_${idx}`);
      rerender(container);
    } else if (action === 'stage-delete') {
      script.stages.splice(idx, 1);
      rerender(container);
    }

    // ── 结局 ──
    else if (action === 'ending-add') {
      script.endings.push({ name: '', condition: {}, description: '' });
      const k = `ending_${script.endings.length - 1}`;
      editingItems[k] = true;
      newItems.add(k);
      rerender(container);
    } else if (action === 'ending-edit') {
      editingItems[`ending_${idx}`] = true;
      rerender(container);
    } else if (action === 'ending-cancel') {
      const k = `ending_${idx}`;
      if (newItems.has(k)) { script.endings.splice(idx, 1); newItems.delete(k); }
      delete editingItems[k];
      rerender(container);
    } else if (action === 'ending-save') {
      saveEndingFromDOM(container, idx);
      delete editingItems[`ending_${idx}`];
      newItems.delete(`ending_${idx}`);
      rerender(container);
    } else if (action === 'ending-delete') {
      script.endings.splice(idx, 1);
      rerender(container);
    }

    // ── 开局选项 ──
    else if (action === 'setup-add') {
      script.setup.push({ step: '', options: [], allow_custom: false });
      const k = `setup_${script.setup.length - 1}`;
      editingItems[k] = true;
      newItems.add(k);
      rerender(container);
    } else if (action === 'setup-edit') {
      editingItems[`setup_${idx}`] = true;
      rerender(container);
    } else if (action === 'setup-cancel') {
      const k = `setup_${idx}`;
      if (newItems.has(k)) { script.setup.splice(idx, 1); newItems.delete(k); }
      delete editingItems[k];
      rerender(container);
    } else if (action === 'setup-save') {
      saveSetupFromDOM(container, idx);
      delete editingItems[`setup_${idx}`];
      newItems.delete(`setup_${idx}`);
      rerender(container);
    } else if (action === 'setup-delete') {
      script.setup.splice(idx, 1);
      rerender(container);
    }

    // ── 标签 (forbidden / requirements) ──
    else if (action === 'tag-add') {
      const field = btn.dataset.field;
      const input = container.querySelector(`[data-tag-input="${field}"]`);
      const val = input?.value?.trim();
      if (!val) return;
      const arr = getNestedValue(script, field) || [];
      arr.push(val);
      setNestedValue(script, field, arr);
      input.value = '';
      rerender(container);
    } else if (action === 'tag-remove') {
      const field = btn.dataset.field;
      const i = parseInt(btn.dataset.idx);
      const arr = getNestedValue(script, field) || [];
      arr.splice(i, 1);
      setNestedValue(script, field, arr);
      rerender(container);
    }

    // ── 条件 ──
    else if (action === 'cond-add') {
      // Handled by adding a new empty entry; we re-render with an extra empty row
      const prefix = btn.dataset.condPrefix;
      // Read current conditions, add empty entry, re-render
      const [module, idxStr, field] = prefix.split('_');
      const i = parseInt(idxStr);
      const currentCond = collectConditions(prefix);
      currentCond[''] = { min: '', max: '', probability: '' };
      // Store temporarily
      if (module === 'event') script.events[i].trigger = currentCond;
      else if (module === 'stage') script.stages[i].transition = currentCond;
      else if (module === 'ending') script.endings[i].condition = currentCond;
      rerender(container);
      editingItems[`${module}_${i}`] = true;
      rerender(container);
    } else if (action === 'cond-remove') {
      const prefix = btn.dataset.condPrefix;
      const ci = btn.dataset.condIdx;
      const [module, idxStr, field] = prefix.split('_');
      const i = parseInt(idxStr);
      const currentCond = collectConditions(prefix);
      const keys = Object.keys(currentCond);
      if (keys[ci]) delete currentCond[keys[ci]];
      if (module === 'event') script.events[i].trigger = currentCond;
      else if (module === 'stage') script.stages[i].transition = currentCond;
      else if (module === 'ending') script.endings[i].condition = currentCond;
      editingItems[`${module}_${i}`] = true;
      rerender(container);
    }

    // ── 选项 ──
    else if (action === 'opt-add') {
      const si = parseInt(btn.dataset.setupIdx);
      script.setup[si].options = script.setup[si].options || [];
      script.setup[si].options.push({ label: '', value: '' });
      editingItems[`setup_${si}`] = true;
      rerender(container);
    } else if (action === 'opt-remove') {
      const si = parseInt(btn.dataset.setupIdx);
      const oi = parseInt(btn.dataset.optIdx);
      script.setup[si].options.splice(oi, 1);
      editingItems[`setup_${si}`] = true;
      rerender(container);
    }

    // ── JSON 同步 ──
    else if (action === 'json-apply') {
      try {
        const json = JSON.parse(container.querySelector('#f-json').value);
        script = parseScript(json);
        editingItems = {};
        rerender(container);
      } catch (err) { alert('JSON 解析失败: ' + err.message); }
    }
  };
  container.addEventListener('click', clickHandler);
}

// ── 从 DOM 保存各模块数据 ──

function saveDimFromDOM(container, i) {
  const get = f => container.querySelector(`[data-dim="${i}"][data-subfield="${f}"]`)?.value;
  const scope = get('scope')?.trim();
  script.dimensions[i] = {
    id: get('id') || `dim_${i}`,
    name: get('name') || '',
    ...(scope ? { scope } : {}),
    range: [Number(get('range_min') || 0), Number(get('range_max') || 100)],
    initial: [Number(get('initial_min') || 0), Number(get('initial_max') || 0)]
  };
}

function saveCharFromDOM(container, i) {
  const get = f => container.querySelector(`[data-char="${i}"][data-subfield="${f}"]`)?.value;
  script.characters[i] = {
    id: get('id') || `char_${i}`,
    name: get('name') || '',
    description: get('description') || ''
  };
}

function saveEventFromDOM(container, i) {
  const get = f => container.querySelector(`[data-event="${i}"][data-subfield="${f}"]`)?.value;
  const effects = {};
  const stickyDur = Number(get('sticky_duration') || 0);
  const cooldown = Number(get('cooldown') || 0);
  if (stickyDur > 0) effects.sticky = { dims: {}, duration: stickyDur };
  if (cooldown > 0) effects.cooldown = cooldown;
  script.events[i] = {
    name: get('name') || '',
    stage: Number(get('stage') || 0),
    trigger: collectConditions(`event_${i}_trigger`),
    description: get('description') || '',
    ...(Object.keys(effects).length > 0 ? { effects } : {})
  };
}

function saveStageFromDOM(container, i) {
  const get = f => container.querySelector(`[data-stage="${i}"][data-subfield="${f}"]`)?.value;
  script.stages[i] = {
    name: get('name') || '',
    transition: collectConditions(`stage_${i}_transition`)
  };
}

function saveEndingFromDOM(container, i) {
  const get = f => container.querySelector(`[data-ending="${i}"][data-subfield="${f}"]`)?.value;
  script.endings[i] = {
    name: get('name') || '',
    condition: collectConditions(`ending_${i}_condition`),
    description: get('description') || ''
  };
}

function saveSetupFromDOM(container, i) {
  const step = container.querySelector(`[data-setup="${i}"][data-subfield="step"]`)?.value || '';
  const allowCustom = container.querySelector(`[data-setup="${i}"][data-subfield="allow_custom"]`)?.checked || false;
  script.setup[i] = {
    step,
    options: collectOptions(i),
    allow_custom: allowCustom
  };
}

// 嵌套属性读写
function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}
function setNestedValue(obj, path, val) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = val;
}
