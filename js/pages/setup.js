import { getScript } from '../db.js';
import { navigate } from '../router.js';
import { chat } from '../modules/llm-client.js';
import { parseScript } from '../modules/script-engine.js';
import { createSession, createGameEngine } from '../modules/session.js';
import { buildSetupPrompt } from '../modules/prompt-builder.js';
import { saveSession } from '../db.js';

export async function render(container, { scriptId }) {
  const script = await getScript(scriptId);
  if (!script) { navigate('home'); return; }

  const steps = script.setup || [];
  let currentStep = 0;
  const selections = [];

  function renderStep() {
    if (currentStep >= steps.length) {
      startGame();
      return;
    }
    const step = steps[currentStep];
    container.innerHTML = `
      <div class="wizard-step">
        <div class="wizard-progress">
          ${steps.map((_, i) => `<div class="wizard-dot ${i < currentStep ? 'done' : i === currentStep ? 'active' : ''}"></div>`).join('')}
        </div>
        <h2>${esc(step.step)}</h2>
        <p>${esc(step.description || '')}</p>
        <div class="wizard-options">
          ${(step.options || []).map((opt, i) => `
            <button class="wizard-option" data-idx="${i}">${esc(opt.label)}</button>
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
      const systemPrompt = buildSetupPrompt({ script, selections });
      const opening = await chat([{ role: 'user', content: systemPrompt }]);

      session.messages.push({ role: 'ai', content: opening, timestamp: Date.now() });

      const engine = createGameEngine(session, script);
      const { extractValues } = await import('../modules/script-engine.js');
      const newVals = extractValues(opening, script.dimensions);
      if (newVals) engine.updateValues(newVals);
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

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
