import { getScript, saveScript } from '../db.js';
import { navigate } from '../router.js';

export async function render(container, { scriptId }) {
  const script = await getScript(scriptId);
  if (!script) { navigate('home'); return; }

  container.innerHTML = `
    <div class="header">
      <button class="header-btn" id="btn-back">←</button>
      <h1>编辑剧本</h1>
      <button class="header-btn" id="btn-save">保存</button>
    </div>
    <div class="page-scroll">
      <div class="form-group">
        <label class="form-label">剧本名称</label>
        <input class="form-input" id="f-name" value="${esc(script.name)}">
      </div>
      <div class="form-group">
        <label class="form-label">描述</label>
        <input class="form-input" id="f-desc" value="${esc(script.description)}">
      </div>
      <div class="form-group">
        <label class="form-label">写作风格</label>
        <input class="form-input" id="f-style" value="${esc(script.rules?.writing_style || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">JSON 剧本数据（高级编辑）</label>
        <textarea class="form-input" id="f-json" rows="16" style="font-family:monospace;font-size:12px;resize:vertical">${esc(JSON.stringify(script, null, 2))}</textarea>
      </div>
    </div>
  `;

  container.querySelector('#btn-back').onclick = () => navigate('home');
  container.querySelector('#btn-save').onclick = async () => {
    try {
      const json = JSON.parse(container.querySelector('#f-json').value);
      json.id = script.id;
      json.name = container.querySelector('#f-name').value || json.name;
      json.description = container.querySelector('#f-desc').value || json.description;
      json.rules = json.rules || {};
      json.rules.writing_style = container.querySelector('#f-style').value || json.rules.writing_style;
      const { parseScript } = await import('../modules/script-engine.js');
      await saveScript(parseScript(json));
      navigate('home');
    } catch (err) {
      alert('保存失败: ' + err.message);
    }
  };
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
