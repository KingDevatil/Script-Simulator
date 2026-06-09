import { getScript, getSetting } from '../db.js';
import { navigate } from '../router.js';
import { chat } from '../modules/llm-client.js';
import { createSession, createGameEngine } from '../modules/session.js';
import { buildSetupPrompt } from '../modules/prompt-builder.js';
import { buildRepairPrompt, parseLLMTurn } from '../modules/llm-output.js';
import { advanceStage, checkEnding } from '../modules/script-engine.js';

export async function render(container, { scriptId }) {
  const script = await getScript(scriptId);
  if (!script) { navigate('home'); return; }

  // 检查 LLM 配置
  const [apiUrl, apiKey] = await Promise.all([getSetting('api_url'), getSetting('api_key')]);
  if (!apiUrl || !apiKey) {
    container.innerHTML = `
      <div class="wizard-step">
        <div class="icon" style="font-size:48px;margin-bottom:16px">⚙</div>
        <h2>未配置 LLM</h2>
        <p>请先在设置中配置 API 地址和 Key</p>
        <button class="btn btn-primary" id="btn-go-settings">前往设置</button>
        <button class="btn btn-secondary" style="margin-top:10px" id="btn-go-back">返回</button>
      </div>
    `;
    container.querySelector('#btn-go-settings').onclick = () => navigate('settings');
    container.querySelector('#btn-go-back').onclick = () => navigate('home');
    return;
  }

  const steps = script.setup || [];
  let currentStep = 0;
  const selections = [];

  function renderStep() {
    if (currentStep >= steps.length) {
      startGame();
      return;
    }
    const step = steps[currentStep];
    const currentValue = selections[currentStep] || '';
    container.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-progress">
          ${steps.map((_, i) => `<div class="wizard-dot ${i < currentStep ? 'done' : i === currentStep ? 'active' : ''}"></div>`).join('')}
        </div>
        <h2>${esc(step.step)}</h2>
        <p>${esc(step.description || '')}</p>
        <div class="wizard-options">
          ${(step.options || []).map((opt, i) => `
            <button class="wizard-option ${currentValue === opt.value ? 'selected' : ''}" data-idx="${i}">${esc(opt.label)}</button>
          `).join('')}
          ${step.allow_custom ? `
            <input class="form-input" id="custom-input" placeholder="自定义输入..." style="margin-top:8px">
          ` : ''}
        </div>
        <div class="wizard-nav">
          ${currentStep > 0 ? '<button class="btn btn-secondary" id="btn-prev" style="min-width:90px">上一步</button>' : ''}
          <button class="btn btn-primary" id="btn-next" disabled style="flex:1">下一步</button>
        </div>
      </div>
    `;

    let selectedIdx = null;
    const options = container.querySelectorAll('.wizard-option');
    const nextBtn = container.querySelector('#btn-next');
    nextBtn.disabled = !selections[currentStep];

    options.forEach(opt => {
      opt.onclick = () => {
        options.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedIdx = parseInt(opt.dataset.idx);
        selections[currentStep] = step.options[selectedIdx].value;
        nextBtn.disabled = false;
      };
    });

    const customInput = container.querySelector('#custom-input');
    if (customInput) {
      customInput.oninput = () => {
        if (customInput.value.trim()) {
          selections[currentStep] = customInput.value.trim();
          nextBtn.disabled = false;
          options.forEach(o => o.classList.remove('selected'));
        } else {
          nextBtn.disabled = true;
        }
      };
    }

    nextBtn.onclick = () => { currentStep++; renderStep(); };
    const prevBtn = container.querySelector('#btn-prev');
    if (prevBtn) prevBtn.onclick = () => { currentStep--; renderStep(); };
  }

  async function startGame() {
    container.innerHTML = `
      <div class="wizard-step">
        <div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
        <p style="margin-top:16px;color:var(--text-dim)">正在生成开场场景...</p>
      </div>
    `;

    try {
      const session = createSession(script, selections);
      const engine = createGameEngine(session, script);
      const systemPrompt = buildSetupPrompt({ script, selections });
      let opening = await chat([{ role: 'user', content: systemPrompt }]);
      let parsedResult = parseLLMTurn(opening, script);
      if (needsOutputRepair(parsedResult)) {
        try {
          const repaired = await chat([{ role: 'user', content: buildRepairPrompt(opening, script) }]);
          const repairedResult = parseLLMTurn(repaired, script);
          if (repairedResult.status === 'json') {
            opening = repaired;
            parsedResult = { ...repairedResult, status: 'repaired' };
          }
        } catch (repairErr) {
          console.warn('Opening JSON repair failed:', repairErr);
        }
      }

      engine.addAIMessage(opening, parsedResult.turn, parsedResult.status);
      const newVals = parsedResult.turn.values && Object.keys(parsedResult.turn.values).length ? parsedResult.turn.values : null;
      if (newVals) engine.updateValues(newVals);
      session.currentStage = advanceStage(script.stages, session.values, session.currentStage);
      const ending = checkEnding(script.endings, session.values);
      if (ending) {
        session.ended = true;
        session.ending = ending;
        if (script.stages?.length) session.currentStage = script.stages.length - 1;
      }
      engine.createSnapshot('after-opening');
      await engine.save();

      navigate('chat', { sessionId: session.id });
    } catch (err) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">⚠️</div>
          <p>${esc(err.message)}</p>
          <button class="btn btn-primary" onclick="location.reload()">重试</button>
        </div>
      `;
    }
  }

  renderStep();
}

function needsOutputRepair(result) {
  return result.status !== 'json' || !result.turn.narrative || !(result.turn.options || []).length;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
