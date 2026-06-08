import { getAllScripts, getAllSessions, deleteScript, deleteSession } from '../db.js';
import { navigate } from '../router.js';

export async function render(container) {
  const scripts = await getAllScripts();
  const sessions = await getAllSessions();

  container.innerHTML = `
    <div class="header">
      <h1>剧本模拟器</h1>
      <button class="header-btn" id="btn-settings" title="设置">⚙</button>
    </div>
    <div class="page-scroll">
      <div class="section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h2 style="font-size:15px;color:var(--text-dim)">剧本库</h2>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-secondary" id="btn-create">+ 新建剧本</button>
            <button class="btn btn-sm btn-secondary" id="btn-import">导入剧本</button>
          </div>
        </div>
        <div id="script-list"></div>
      </div>
      <div class="section" style="margin-top:24px">
        <h2 style="font-size:15px;color:var(--text-dim);margin-bottom:12px">我的会话</h2>
        <div id="session-list"></div>
      </div>
    </div>
    <input type="file" id="file-input" accept=".json" style="display:none">
  `;

  const scriptList = container.querySelector('#script-list');
  const sessionList = container.querySelector('#session-list');

  if (scripts.length === 0) {
    scriptList.innerHTML = `
      <div class="empty-state" style="padding:30px">
        <div class="icon">📖</div>
        <p>还没有剧本，新建一个或加载示例开始吧</p>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-primary" id="btn-sample">加载示例剧本</button>
          <button class="btn btn-secondary" id="btn-create-empty">新建剧本</button>
        </div>
      </div>`;
    container.querySelector('#btn-create-empty').onclick = async () => {
      const { parseScript } = await import('../modules/script-engine.js');
      const { saveScript } = await import('../db.js');
      const newScript = parseScript({ name: '未命名剧本', description: '' });
      await saveScript(newScript);
      navigate('scriptDetail', { scriptId: newScript.id });
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
        alert('加载失败: ' + err.message);
      }
    };
  } else {
    scriptList.innerHTML = scripts.map(s => `
      <div class="card" data-script-id="${s.id}">
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.description)}</p>
        <span class="card-tag">${(s.dimensions||[]).length} 个维度</span>
        <span class="card-tag">${(s.stages||[]).length} 个阶段</span>
        <button class="btn btn-sm btn-secondary" style="margin-top:8px;margin-right:6px" data-action="play">开始</button>
        <button class="btn btn-sm btn-secondary" style="margin-top:8px;margin-right:6px" data-action="edit">编辑</button>
        <button class="btn btn-sm btn-secondary" style="margin-top:8px;color:var(--accent)" data-action="delete">删除</button>
      </div>
    `).join('');
  }

  if (sessions.length === 0) {
    sessionList.innerHTML = `<p style="color:var(--text-dim);font-size:13px">暂无会话</p>`;
  } else {
    sessionList.innerHTML = sessions.sort((a, b) => b.updatedAt - a.updatedAt).map(s => `
      <div class="card" data-session-id="${s.id}">
        <h3>${esc(s.scriptName || '未知剧本')}</h3>
        <p>阶段 ${(s.currentStage || 0) + 1} · ${(s.messages||[]).length} 条消息</p>
        <p style="font-size:11px;color:var(--text-dim)">${new Date(s.updatedAt).toLocaleString()}</p>
        <button class="btn btn-sm btn-primary" style="margin-top:8px;margin-right:6px" data-action="resume">继续</button>
        <button class="btn btn-sm btn-secondary" style="margin-top:8px;margin-right:6px" data-action="branch">复制分支</button>
        <button class="btn btn-sm btn-secondary" style="margin-top:8px;color:var(--accent)" data-action="delete">删除</button>
      </div>
    `).join('');
  }

  // Events
  container.querySelector('#btn-settings').onclick = () => navigate('settings');
  container.querySelector('#btn-create').onclick = async () => {
    const { parseScript } = await import('../modules/script-engine.js');
    const { saveScript } = await import('../db.js');
    const newScript = parseScript({ name: '未命名剧本', description: '' });
    await saveScript(newScript);
    navigate('scriptDetail', { scriptId: newScript.id });
  };
  container.querySelector('#btn-import').onclick = () => container.querySelector('#file-input').click();
  container.querySelector('#file-input').onchange = e => handleImport(e, scripts);

  scriptList.onclick = e => {
    const card = e.target.closest('[data-script-id]');
    if (!card) return;
    const id = card.dataset.scriptId;
    const action = e.target.dataset.action;
    if (action === 'play') navigate('setup', { scriptId: id });
    else if (action === 'edit') navigate('scriptDetail', { scriptId: id });
    else if (action === 'delete') { deleteScript(id); render(container); }
  };

  sessionList.onclick = e => {
    const card = e.target.closest('[data-session-id]');
    if (!card) return;
    const id = card.dataset.sessionId;
    const action = e.target.dataset.action;
    if (action === 'resume') navigate('chat', { sessionId: id });
    else if (action === 'branch') handleBranch(id, sessions);
    else if (action === 'delete') { deleteSession(id); render(container); }
  };
}

async function handleImport(e, existingScripts) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const { parseScript } = await import('../modules/script-engine.js');
    const { saveScript } = await import('../db.js');
    const script = parseScript(json);
    await saveScript(script);
    navigate('home');
  } catch (err) {
    alert('导入失败: ' + err.message);
  }
}

async function handleBranch(sessionId, sessions) {
  const { saveSession, getSession } = await import('../db.js');
  const original = await getSession(sessionId);
  if (!original) return;
  const branch = { ...original, id: crypto.randomUUID(), messages: [...original.messages], updatedAt: Date.now() };
  await saveSession(branch);
  navigate('chat', { sessionId: branch.id });
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
