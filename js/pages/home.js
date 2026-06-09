import { getAllScripts, getAllSessions, deleteScript, deleteSession } from '../db.js';
import { navigate } from '../router.js';
import { showAlert, showConfirm } from '../modules/dialog.js';

export async function render(container) {
  const scripts = await getAllScripts();
  const sessions = await getAllSessions();
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const lastSession = sortedSessions[0];
  const sessionStats = buildSessionStats(sessions);

  container.innerHTML = `
    <div class="header home-header">
      <div>
        <h1>剧本模拟器</h1>
        <p>${scripts.length ? '管理剧本，继续你的模拟对话' : '导入或创建剧本后开始模拟'}</p>
      </div>
      <button class="header-btn" id="btn-settings" title="设置">⚙</button>
    </div>
    <div class="page-scroll home-scroll">
      <div class="home-summary">
        <div class="summary-item">
          <span class="summary-value">${scripts.length}</span>
          <span class="summary-label">剧本</span>
        </div>
        <div class="summary-item">
          <span class="summary-value">${sessions.length}</span>
          <span class="summary-label">会话</span>
        </div>
        <div class="summary-item summary-wide">
          <span class="summary-value">${lastSession ? formatTime(lastSession.updatedAt) : '暂无'}</span>
          <span class="summary-label">最近更新</span>
        </div>
      </div>

      <section class="home-section">
        <div class="section-toolbar">
          <h2>剧本库</h2>
          <div class="toolbar-actions">
            <button class="btn btn-sm btn-secondary" id="btn-create">新建</button>
            <button class="btn btn-sm btn-primary" id="btn-import">导入 JSON</button>
          </div>
        </div>
        <div id="script-list" class="home-list"></div>
      </section>

      <section class="home-section">
        <div class="section-toolbar">
          <h2>我的会话</h2>
          <span class="section-count">${sessions.length} 个</span>
        </div>
        <div id="session-list" class="home-list"></div>
      </section>
    </div>
    <input type="file" id="file-input" accept=".json" style="display:none">
  `;

  const scriptList = container.querySelector('#script-list');
  const sessionList = container.querySelector('#session-list');

  if (scripts.length === 0) {
    scriptList.innerHTML = `
      <div class="empty-panel">
        <div class="empty-mark">JSON</div>
        <h3>还没有剧本</h3>
        <p>新建一个空剧本，或加载示例剧本快速体验完整流程。</p>
        <div class="empty-actions">
          <button class="btn btn-primary" id="btn-sample">加载示例</button>
          <button class="btn btn-secondary" id="btn-create-empty">新建剧本</button>
        </div>
      </div>`;
    container.querySelector('#btn-create-empty').onclick = async () => {
      navigate('scriptDetail', { draft: true });
    };
    container.querySelector('#btn-sample').onclick = async () => {
      try {
        let json;
        if (window.__SAMPLE_SCRIPT__) {
          json = window.__SAMPLE_SCRIPT__;
        } else {
          const res = await fetch('/data/scripts/dangerous-relationships.json');
          json = await res.json();
        }
        const { parseScript } = await import('../modules/script-engine.js');
        const { saveScript } = await import('../db.js');
        await saveScript(parseScript(json));
        render(container);
      } catch (err) {
        await showAlert('加载失败: ' + err.message, { title: '加载失败', tone: 'danger' });
      }
    };
  } else {
    scriptList.innerHTML = scripts.map(s => `
      <article class="card home-card" data-script-id="${s.id}">
        ${(() => {
          const stats = sessionStats.get(s.id) || { count: 0, latest: null };
          return `<div class="card-meta-line">${stats.count} 个会话${stats.latest ? ` · 最近 ${formatTime(stats.latest)}` : ''}</div>`;
        })()}
        <div class="card-main">
          <h3>${esc(s.name)}</h3>
          <p>${esc(s.description || '暂无描述')}</p>
          <div class="card-tags">
            <span class="card-tag">${(s.dimensions || []).length} 维度</span>
            <span class="card-tag">${(s.stages || []).length} 阶段</span>
            <span class="card-tag">${(s.characters || []).length} 角色</span>
            <span class="card-tag">${(s.events || []).length} 事件</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-sm btn-primary" data-action="play">开始</button>
          <button class="btn btn-sm btn-secondary" data-action="edit">编辑</button>
          <button class="btn btn-sm btn-danger" data-action="delete">删除</button>
        </div>
      </article>
    `).join('');
  }

  if (sessions.length === 0) {
    sessionList.innerHTML = `<div class="muted-row">暂无会话</div>`;
  } else {
    sessionList.innerHTML = sortedSessions.map(s => `
      <article class="card home-card" data-session-id="${s.id}">
          <div class="card-main">
            <h3>${esc(s.scriptName || '未知剧本')}</h3>
          <p>阶段 ${(s.currentStage || 0) + 1} · ${(s.messages || []).length} 条消息${s.ended ? ' · 已结束' : ''}</p>
          <div class="card-tags">
            ${s.seed ? `<span class="card-tag">seed ${s.seed}</span>` : ''}
            ${(s.timeline || []).length ? `<span class="card-tag">${s.timeline.length} 状态变更</span>` : ''}
          </div>
          <p class="card-time">${new Date(s.updatedAt).toLocaleString()}</p>
        </div>
        <div class="card-actions">
          <button class="btn btn-sm btn-primary" data-action="resume">继续</button>
          <button class="btn btn-sm btn-secondary" data-action="branch">复制分支</button>
          <button class="btn btn-sm btn-danger" data-action="delete">删除</button>
        </div>
      </article>
    `).join('');
  }

  container.querySelector('#btn-settings').onclick = () => navigate('settings');
  container.querySelector('#btn-create').onclick = async () => {
    navigate('scriptDetail', { draft: true });
  };
  container.querySelector('#btn-import').onclick = () => container.querySelector('#file-input').click();
  container.querySelector('#file-input').onchange = e => handleImport(e);

  scriptList.onclick = async e => {
    const card = e.target.closest('[data-script-id]');
    if (!card) return;
    const id = card.dataset.scriptId;
    const action = e.target.dataset.action;
    if (action === 'play') navigate('setup', { scriptId: id });
    else if (action === 'edit') navigate('scriptDetail', { scriptId: id });
    else if (action === 'delete' && await showConfirm('确定删除这个剧本吗？相关会话不会自动删除。', { title: '删除剧本', tone: 'danger', confirmText: '删除' })) {
      await deleteScript(id);
      render(container);
    }
  };

  sessionList.onclick = async e => {
    const card = e.target.closest('[data-session-id]');
    if (!card) return;
    const id = card.dataset.sessionId;
    const action = e.target.dataset.action;
    if (action === 'resume') navigate('chat', { sessionId: id });
    else if (action === 'branch') handleBranch(id);
    else if (action === 'delete' && await showConfirm('确定删除这个会话吗？此操作无法撤销。', { title: '删除会话', tone: 'danger', confirmText: '删除' })) {
      await deleteSession(id);
      render(container);
    }
  };
}

function buildSessionStats(sessions) {
  const stats = new Map();
  sessions.forEach(session => {
    const current = stats.get(session.scriptId) || { count: 0, latest: null };
    current.count += 1;
    current.latest = Math.max(current.latest || 0, session.updatedAt || 0);
    stats.set(session.scriptId, current);
  });
  return stats;
}

async function handleImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  let text = '';
  try {
    text = await file.text();
    const json = JSON.parse(text);
    const { parseScript } = await import('../modules/script-engine.js');
    const { formatValidationResult, validateScript } = await import('../modules/script-validator.js');
    const { saveScript } = await import('../db.js');
    const script = parseScript(json);
    const validation = validateScript(script);
    if (!validation.ok) {
      const err = new Error(formatValidationResult(validation));
      err.validation = validation;
      throw err;
    }
    if (validation.warnings.length && !await showConfirm(`导入校验有警告，是否继续？\n\n${formatValidationResult(validation)}`, { title: '导入警告', confirmText: '继续导入' })) return;
    await saveScript(script);
    navigate('home');
  } catch (err) {
    await showAlert(formatImportError(err, text), { title: '导入失败', tone: 'danger' });
  }
}

function formatImportError(err, text = '') {
  if (err.validation) return `导入失败：schema 校验未通过\n\n${err.message}`;
  if (err instanceof SyntaxError) return `导入失败：JSON 解析错误\n\n${jsonErrorLocation(err, text)}${err.message}`;
  return `导入失败：${err.message}`;
}

function jsonErrorLocation(err, text) {
  const match = String(err.message).match(/position\s+(\d+)/i);
  if (!match || !text) return '';
  const pos = Number(match[1]);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  return `位置：第 ${line} 行，第 ${column} 列\n`;
}

async function handleBranch(sessionId) {
  const { saveSession, getSession } = await import('../db.js');
  const original = await getSession(sessionId);
  if (!original) return;
  const branch = { ...original, id: crypto.randomUUID(), messages: [...original.messages], updatedAt: Date.now() };
  await saveSession(branch);
  navigate('chat', { sessionId: branch.id });
}

function formatTime(ts) {
  if (!ts) return '暂无';
  const diff = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  return new Date(ts).toLocaleDateString();
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
