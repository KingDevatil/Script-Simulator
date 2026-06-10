import { getSetting, setSetting } from '../db.js';
import { navigate } from '../router.js';
import { showAlert } from '../modules/dialog.js';

const MODEL_PRESETS = [
  { id: '', label: '自定义配置', url: '', model: '', thinking: null, effort: 'high', temperature: 0.85, proxy: false },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash', thinking: false, effort: 'high', temperature: 0.85, proxy: false },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-pro', thinking: true, effort: 'high', temperature: 0.85, proxy: false },
  { id: 'mimo-v2.5', label: 'Xiaomi MiMo V2.5', url: 'https://api.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.5', thinking: false, effort: 'high', temperature: 1.0, proxy: false },
  { id: 'mimo-v2.5-pro', label: 'Xiaomi MiMo V2.5 Pro', url: 'https://api.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.5-pro', thinking: false, effort: 'high', temperature: 1.0, proxy: false },
  { id: 'openai-gpt-4o-mini', label: 'OpenAI GPT-4o mini', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', thinking: false, effort: 'high', temperature: 0.7, proxy: false },
  { id: 'proxy', label: '后端代理', url: '/api/chat/completions', model: 'deepseek-v4-flash', thinking: false, effort: 'high', temperature: 0.85, proxy: true }
];

export async function render(container) {
  const [apiUrl, apiKey, apiModel, memoryInterval, thinkingEnabled, reasoningEffort, temperature, apiProxyEnabled] = await Promise.all([
    getSetting('api_url'), getSetting('api_key'),
    getSetting('api_model'), getSetting('memory_interval'),
    getSetting('thinking_enabled'), getSetting('reasoning_effort'),
    getSetting('temperature'), getSetting('api_proxy_enabled')
  ]);

  const isThinking = thinkingEnabled !== false; // 默认开启
  const isProxy = !!apiProxyEnabled;

  container.innerHTML = `
    <div class="header">
      <button class="header-btn editor-back-btn" id="btn-back">返回</button>
      <h1>设置</h1>
    </div>
    <div class="page-scroll">
      <div class="settings-section">
        <h3>LLM API 配置</h3>
        <div class="form-group">
          <label class="form-label">模型预设</label>
          <select class="form-input" id="f-preset">
            ${MODEL_PRESETS.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">API 地址</label>
          <input class="form-input" id="f-url" value="${esc(apiUrl || 'https://api.deepseek.com/chat/completions')}" placeholder="https://api.deepseek.com/chat/completions">
        </div>
        <div class="form-group">
          <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="f-proxy" ${isProxy ? 'checked' : ''} style="width:16px;height:16px">
            使用后端代理模式（前端不保存 API Key）
          </label>
          <p style="font-size:12px;color:var(--text-dim);margin-top:4px">生产环境建议使用代理或 token broker，由后端保存长期密钥。</p>
        </div>
        <div class="form-group">
          <label class="form-label">API Key</label>
          <input class="form-input" id="f-key" type="password" value="${esc(isProxy ? '' : (apiKey || ''))}" placeholder="sk-..." ${isProxy ? 'disabled' : ''}>
        </div>
        <div class="form-group">
          <label class="form-label">模型名称</label>
          <input class="form-input" id="f-model" value="${esc(apiModel || 'deepseek-v4-flash')}" placeholder="deepseek-v4-flash">
        </div>
      </div>

      <div class="settings-section">
        <h3>思考模式</h3>
        <div class="form-group">
          <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="f-thinking" ${isThinking ? 'checked' : ''} style="width:16px;height:16px">
            启用思考模式
          </label>
          <p style="font-size:12px;color:var(--text-dim);margin-top:4px">开启后模型会先推理再回答，剧情质量更高，但响应较慢且不支持 temperature 调节</p>
        </div>
        <div class="form-group" id="effort-group" style="${isThinking ? '' : 'display:none'}">
          <label class="form-label">思考强度</label>
          <select class="form-input" id="f-effort">
            <option value="high" ${reasoningEffort !== 'max' ? 'selected' : ''}>high - 普通（推荐）</option>
            <option value="max" ${reasoningEffort === 'max' ? 'selected' : ''}>max - 深度思考</option>
          </select>
        </div>
        <div class="form-group" id="temp-group" style="${isThinking ? 'display:none' : ''}">
          <label class="form-label">Temperature: <span id="temp-val">${temperature ?? 0.85}</span></label>
          <input type="range" id="f-temp" min="0" max="2" step="0.05" value="${temperature ?? 0.85}" style="width:100%">
          <p style="font-size:12px;color:var(--text-dim);margin-top:4px">越高越随机有创意，越低越稳定保守。思考模式下此参数无效</p>
        </div>
      </div>

      <div class="settings-section">
        <h3>记忆系统</h3>
        <div class="form-group">
          <label class="form-label">自动总结间隔（轮数）</label>
          <input class="form-input" id="f-memory" type="number" min="3" max="50" value="${memoryInterval || 10}">
        </div>
      </div>

      <div class="settings-section">
        <h3>测试连接</h3>
        <button class="btn btn-secondary btn-block" id="btn-test">测试 API 连接</button>
        <p id="test-result" style="margin-top:8px;font-size:13px;color:var(--text-dim)"></p>
      </div>

      <button class="btn btn-primary btn-block" id="btn-save">保存设置</button>
    </div>
  `;

  // Toggle thinking mode UI
  container.querySelector('#f-thinking').onchange = e => {
    const on = e.target.checked;
    container.querySelector('#effort-group').style.display = on ? '' : 'none';
    container.querySelector('#temp-group').style.display = on ? 'none' : '';
  };
  container.querySelector('#f-proxy').onchange = e => {
    const keyInput = container.querySelector('#f-key');
    keyInput.disabled = e.target.checked;
    if (e.target.checked) keyInput.value = '';
  };
  container.querySelector('#f-preset').onchange = e => {
    const preset = MODEL_PRESETS.find(p => p.id === e.target.value);
    if (!preset || !preset.id) return;
    container.querySelector('#f-url').value = preset.url;
    container.querySelector('#f-model').value = preset.model;
    container.querySelector('#f-proxy').checked = preset.proxy;
    container.querySelector('#f-proxy').dispatchEvent(new Event('change'));
    if (preset.thinking !== null) {
      container.querySelector('#f-thinking').checked = preset.thinking;
      container.querySelector('#f-thinking').dispatchEvent(new Event('change'));
    }
    container.querySelector('#f-effort').value = preset.effort;
    tempSlider.value = preset.temperature;
    tempVal.textContent = String(preset.temperature);
  };

  // Temperature slider
  const tempSlider = container.querySelector('#f-temp');
  const tempVal = container.querySelector('#temp-val');
  tempSlider.oninput = () => { tempVal.textContent = tempSlider.value; };

  container.querySelector('#btn-back').onclick = () => navigate('home');

  container.querySelector('#btn-save').onclick = async () => {
    const saveBtn = container.querySelector('#btn-save');
    saveBtn.disabled = true;
    const originalText = saveBtn.textContent;
    try {
      await Promise.all([
        setSetting('api_url', container.querySelector('#f-url').value.trim()),
        setSetting('api_key', container.querySelector('#f-proxy').checked ? '' : container.querySelector('#f-key').value.trim()),
        setSetting('api_proxy_enabled', container.querySelector('#f-proxy').checked),
        setSetting('api_model', container.querySelector('#f-model').value.trim()),
        setSetting('memory_interval', parseInt(container.querySelector('#f-memory').value) || 10),
        setSetting('thinking_enabled', container.querySelector('#f-thinking').checked),
        setSetting('reasoning_effort', container.querySelector('#f-effort').value),
        setSetting('temperature', parseFloat(tempSlider.value))
      ]);
      saveBtn.textContent = '已保存';
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }, 1200);
    } catch (err) {
      saveBtn.textContent = originalText;
      saveBtn.disabled = false;
      await showAlert('保存失败: ' + err.message, { title: '保存失败', tone: 'danger' });
    }
  };

  container.querySelector('#btn-test').onclick = async () => {
    const result = container.querySelector('#test-result');
    result.textContent = '测试中...';
    result.style.color = 'var(--text-dim)';

    const url = container.querySelector('#f-url').value.trim();
    const key = container.querySelector('#f-key').value.trim();
    const proxy = container.querySelector('#f-proxy').checked;
    const model = container.querySelector('#f-model').value.trim();
    const thinking = container.querySelector('#f-thinking').checked;
    const effort = container.querySelector('#f-effort').value;

    if (!url || (!proxy && !key)) {
      result.textContent = '✗ 请先填写 API 地址和 Key，或启用后端代理模式';
      result.style.color = 'var(--accent)';
      return;
    }

    const maxTokensKey = isMiMoApi(fullUrl) ? 'max_completion_tokens' : 'max_tokens';
    const body = {
      model: model || 'deepseek-v4-flash',
      messages: [{ role: 'user', content: '回复"连接成功"' }],
      [maxTokensKey]: 20
    };
    if (thinking) {
      body.thinking = { type: 'enabled', reasoning_effort: effort };
    }

    try {
      const fullUrl = url.endsWith('/chat/completions') ? url : url.replace(/\/+$/, '') + '/chat/completions';
      result.textContent = `测试中... (${fullUrl})`;
      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: buildTestHeaders({ url: fullUrl, key, proxy }),
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || '';
      result.textContent = '✓ 连接成功' + (reply ? ` - "${reply.slice(0, 50)}"` : '');
      result.style.color = '#4caf50';
    } catch (err) {
      result.textContent = '✗ ' + err.message;
      result.style.color = 'var(--accent)';
    }
  };
}

function buildTestHeaders({ url, key, proxy }) {
  const headers = { 'Content-Type': 'application/json' };
  if (proxy || !key) return headers;
  if (isMiMoApi(url)) headers['api-key'] = key;
  else headers.Authorization = `Bearer ${key}`;
  return headers;
}

function isMiMoApi(url) {
  return String(url || '').includes('xiaomimimo.com');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
