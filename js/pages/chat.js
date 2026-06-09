import { getSession, getScript } from '../db.js';
import { navigate } from '../router.js';
import { chat } from '../modules/llm-client.js';
import { createGameEngine } from '../modules/session.js';
import { buildPrompt } from '../modules/prompt-builder.js';
import { addEventEffects, advanceStage, checkEnding, checkEventTriggers, extractNarrative, extractValues, processEffects } from '../modules/script-engine.js';
import { buildRepairPrompt, getMessageTurn, parseLLMTurn } from '../modules/llm-output.js';
import { showConfirm } from '../modules/dialog.js';

let engine = null;
let panelOpen = false;
let prevValues = {};

export async function render(container, { sessionId }) {
  const session = await getSession(sessionId);
  if (!session) { navigate('home'); return; }
  const script = await getScript(session.scriptId);
  if (!script) { navigate('home'); return; }

  engine = createGameEngine(session, script);
  const s = engine.session;
  prevValues = { ...s.values };

  container.innerHTML = `
    <div class="chat-page">
      <div class="header">
        <button class="header-btn" id="btn-back-chat">←</button>
        <h1 style="font-size:15px">${esc(script.name)}</h1>
        <button class="header-btn" id="btn-menu">⋯</button>
      </div>
      <div class="numerical-toggle" id="num-toggle">▲ 数值面板</div>
      <div class="numerical-panel" id="num-panel"></div>
      <div class="chat-body">
        <div class="chat-messages" id="messages"></div>
        <div class="chat-nav">
          <button class="chat-nav-btn" id="nav-top" title="顶部">∧</button>
          <button class="chat-nav-btn" id="nav-prev" title="上一轮">▵</button>
          <button class="chat-nav-btn" id="nav-next" title="下一轮">▿</button>
          <button class="chat-nav-btn" id="nav-bottom" title="底部">∨</button>
        </div>
      </div>
      <div id="memory-prompt-area"></div>
      <div class="chat-input-bar">
        <div class="chat-options" id="chat-options"></div>
        <div class="chat-row">
          <textarea class="chat-textarea" id="chat-input" placeholder="输入你的行动..." rows="1"></textarea>
          <button class="chat-send" id="btn-send">↑</button>
        </div>
      </div>
    </div>
  `;

  const msgContainer = container.querySelector('#messages');
  let currentMsgIdx = -1;

  renderNumericalPanel();
  renderMessages();
  renderEnding();

  // Auto-scroll
  msgContainer.scrollTop = msgContainer.scrollHeight;

  // Toggle panel
  container.querySelector('#num-toggle').onclick = () => {
    panelOpen = !panelOpen;
    const panel = container.querySelector('#num-panel');
    const toggle = container.querySelector('#num-toggle');
    panel.classList.toggle('open', panelOpen);
    toggle.textContent = panelOpen ? '▼ 数值面板' : '▲ 数值面板';
  };

  // Input handling
  const input = container.querySelector('#chat-input');
  input.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  };

  // Navigation buttons
  container.querySelector('#nav-top').onclick = () => {
    msgContainer.scrollTo({ top: 0, behavior: 'smooth' });
  };
  container.querySelector('#nav-bottom').onclick = () => {
    msgContainer.scrollTo({ top: msgContainer.scrollHeight, behavior: 'smooth' });
  };
  container.querySelector('#nav-prev').onclick = () => {
    scrollToMsg(-1);
  };
  container.querySelector('#nav-next').onclick = () => {
    scrollToMsg(1);
  };

  function scrollToMsg(dir) {
    const msgs = msgContainer.querySelectorAll('.msg');
    if (msgs.length === 0) return;
    currentMsgIdx = Math.max(0, Math.min(msgs.length - 1, currentMsgIdx + dir));
    msgs[currentMsgIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  container.querySelector('#btn-send').onclick = () => sendMessage();

  // Load last AI message options if available
  renderOptions();

  async function sendMessage(content) {
    const msg = content || input.value.trim();
    if (!msg || engine._sending || s.ended) return;
    input.value = '';
    input.style.height = 'auto';
    container.querySelector('#chat-options').innerHTML = '';

    engine.addPlayerMessage(msg);
    engine.createSnapshot('before-ai-response');
    renderMessages();
    await callAI(msg);
  }

  async function callAI(playerMsg) {
    engine._sending = true;
    setSendingState(true);

    const streamEl = document.createElement('div');
    streamEl.className = 'msg msg-ai';
    streamEl.textContent = '';
    msgContainer.appendChild(streamEl);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    try {
      const systemPrompt = buildPrompt({
        script,
        values: s.values,
        selections: s.selections,
        memories: engine.memoryMgr.getMemories(),
        recentMessages: engine.getRecentMessages(3),
        scenePrompt: buildScenePrompt(script, s),
        playerInput: playerMsg,
        currentStage: s.currentStage
      });

      let aiResponse = await chat(
        [{ role: 'user', content: systemPrompt }],
        {
          onChunk: (partial, reasoning) => {
            if (partial) {
              streamEl.textContent = partial;
            } else if (reasoning) {
              streamEl.innerHTML = '<span style="color:var(--text-dim);font-size:12px">思考中...</span>';
            }
            msgContainer.scrollTop = msgContainer.scrollHeight;
          }
        }
      );

      let parsedResult = parseLLMTurn(aiResponse, script);
      if (needsOutputRepair(parsedResult)) {
        try {
          streamEl.textContent = '正在修正输出格式...';
          const repaired = await chat([{ role: 'user', content: buildRepairPrompt(aiResponse, script) }]);
          const repairedResult = parseLLMTurn(repaired, script);
          if (repairedResult.status === 'json') {
            aiResponse = repaired;
            parsedResult = { ...repairedResult, status: 'repaired' };
          }
        } catch (repairErr) {
          console.warn('LLM JSON repair failed:', repairErr);
        }
      }
      if (parsedResult.warnings?.length) console.warn('LLM output warnings:', parsedResult.warnings);

      const turn = parsedResult.turn;
      engine.addAIMessage(aiResponse, turn, parsedResult.status);

      const beforeValues = { ...s.values };
      const beforeStage = s.currentStage;
      const newVals = turn.values && Object.keys(turn.values).length ? turn.values : null;
      if (newVals) engine.updateValues(newVals);

      // 处理持续效果（sticky 数值变化 + 过期清理）
      processEffects(s, script.dimensions || []);

      const triggered = checkEventTriggers(script.events, s.values, s.currentStage, s.activeEffects, s.eventState, () => engine.nextRandom());
      if (triggered.length > 0) {
        triggered.forEach(ev => addEventEffects(s, ev));
        const nextStage = advanceStage(script.stages, s.values, s.currentStage);
        if (nextStage !== s.currentStage) s.currentStage = nextStage;
      }

      const ending = checkEnding(script.endings, s.values);
      if (ending) {
        s.ended = true;
        s.ending = ending;
        if (script.stages?.length) s.currentStage = script.stages.length - 1;
      }

      engine.addTimelineEntry({
        values: diffValues(beforeValues, s.values),
        events: triggered.map(ev => ev.name),
        stageFrom: beforeStage,
        stageTo: s.currentStage,
        ending: ending ? ending.name : null
      });

      const keyEvent = turn.keyEvent;
      if (keyEvent) showMemoryPrompt();

      engine.createSnapshot('after-ai-response');
      await engine.save();
      renderMessages();
      renderNumericalPanel();
      renderEnding();
      renderOptions();
      // 选项渲染后再次滚动到底部
      requestAnimationFrame(() => {
        msgContainer.scrollTop = msgContainer.scrollHeight;
      });

      const memArea = container.querySelector('#memory-prompt-area');
      if (!keyEvent) memArea.innerHTML = '';
    } catch (err) {
      streamEl.remove();
      showSystemMessage('发送失败: ' + err.message);
    }
    engine._sending = false;
    setSendingState(false);
  }

  function setSendingState(isSending) {
    input.disabled = isSending || s.ended;
    container.querySelector('#btn-send').disabled = isSending || s.ended;
    container.querySelectorAll('.chat-option-btn').forEach(btn => { btn.disabled = isSending; });
  }

  function needsOutputRepair(result) {
    return result.status !== 'json' || !result.turn.narrative || !(result.turn.options || []).length;
  }

  function renderMessages() {
    msgContainer.innerHTML = s.messages.map((m, i) => {
      const cls = m.role === 'player' ? 'msg-player' : 'msg-ai';
      let display = m.content;
      let valChanges = '';
      if (m.role === 'ai') {
        const turn = getMessageTurn(m, script);
        display = turn.narrative || extractNarrative(m.content);
        // 只在数值有变化时显示
        const vals = turn.values && Object.keys(turn.values).length ? turn.values : extractValues(m.content, script.dimensions);
        if (vals && script.dimensions?.length) {
          const changes = script.dimensions
            .filter(d => vals[d.id] !== undefined && vals[d.id] !== prevValues[d.id])
            .map(d => {
              const old = prevValues[d.id];
              const cur = vals[d.id];
              const arrow = old !== undefined && cur > old ? '↑' : old !== undefined && cur < old ? '↓' : '';
              return `${d.name} ${cur}${arrow}`;
            })
            .slice(0, 5);
          if (changes.length) valChanges = `<div class="msg-values">${changes.join(' · ')}</div>`;
          // 更新 prevValues
          Object.assign(prevValues, vals);
        }
      }
      const regenBtn = m.role === 'ai'
        ? `<div class="msg-regen" data-idx="${i}">↻ 重新生成</div>`
        : '';
      return `<div class="msg ${cls}">${esc(display)}${valChanges}${regenBtn}</div>`;
    }).join('');
    currentMsgIdx = msgContainer.querySelectorAll('.msg').length - 1;
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  // Event delegation for regenerate buttons
  msgContainer.addEventListener('click', e => {
    const btn = e.target.closest('.msg-regen');
    if (btn) regenerate(parseInt(btn.dataset.idx));
  });

  async function regenerate(aiIdx) {
    if (engine._sending) return;
    const playerIdx = aiIdx - 1;

    // 开场白（第一条消息，无前置玩家消息）
    if (aiIdx === 0 || playerIdx < 0 || s.messages[playerIdx]?.role !== 'player') {
      engine.restoreToMessage(0);
      renderMessages();
      await callAI('请重新生成开场场景');
      return;
    }

    const playerContent = s.messages[playerIdx].content;
    engine.restoreToMessage(playerIdx);
    engine.addPlayerMessage(playerContent);
    engine.createSnapshot('before-ai-regenerate');
    renderMessages();
    await callAI(playerContent);
  }

  function renderNumericalPanel() {
    const panel = container.querySelector('#num-panel');
    if (!script.dimensions?.length) {
      panel.innerHTML = '<p style="color:var(--text-dim);font-size:13px">此剧本无数值系统</p>';
      return;
    }
    panel.innerHTML = script.dimensions.map(d => {
      const v = s.values[d.id];
      return `<div class="num-row"><span class="num-label">${esc(d.name)}</span><span class="num-value">${v ?? '-'}</span></div>`;
    }).join('') + renderTimeline();
  }

  function renderTimeline() {
    const items = (s.timeline || []).slice(-12).reverse();
    if (!items.length) return '<div class="state-timeline"><div class="timeline-title">状态时间线</div><p class="timeline-empty">暂无状态变化</p></div>';
    return `<div class="state-timeline">
      <div class="timeline-title">状态时间线</div>
      ${items.map(item => {
        const valueText = (item.values || []).map(v => `${v.name} ${v.from}→${v.to}`).join(' · ');
        const stageText = item.stageTo !== item.stageFrom ? `阶段 ${Number(item.stageFrom) + 1}→${Number(item.stageTo) + 1}` : '';
        const eventText = item.events?.length ? `事件：${item.events.join('、')}` : '';
        const endingText = item.ending ? `结局：${item.ending}` : '';
        const detail = [valueText, stageText, eventText, endingText].filter(Boolean).join('<br>');
        return `<div class="timeline-item">
          <span class="timeline-dot"></span>
          <div><div class="timeline-time">${new Date(item.timestamp).toLocaleTimeString()}</div><div class="timeline-detail">${detail || '无显著变化'}</div></div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderOptions() {
    const optContainer = container.querySelector('#chat-options');
    if (s.ended) { optContainer.innerHTML = ''; return; }
    const lastAI = [...s.messages].reverse().find(m => m.role === 'ai');
    if (!lastAI) { optContainer.innerHTML = ''; return; }

    const turn = getMessageTurn(lastAI, script);
    const opts = (turn.options || []).map(o => ({ label: `${o.label}. ${o.text}`, value: o.value || o.text }));
    if (opts.length === 0) { optContainer.innerHTML = ''; return; }
    // 最多显示4个选项
    opts.splice(4);

    optContainer.innerHTML = opts.map(o =>
      `<button class="chat-option-btn" data-value="${esc(o.value)}">${esc(o.label)}</button>`
    ).join('');

    optContainer.onclick = e => {
      const btn = e.target.closest('.chat-option-btn');
      if (btn) sendMessage(btn.dataset.value);
    };
  }

  function showTyping() {
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.id = 'typing';
    typing.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    msgContainer.appendChild(typing);
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  function hideTyping() {
    const t = container.querySelector('#typing');
    if (t) t.remove();
  }

  function showSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg msg-system';
    div.textContent = text;
    msgContainer.appendChild(div);
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  function renderEnding() {
    const area = container.querySelector('#memory-prompt-area');
    if (!s.ended || !s.ending) {
      if (area.dataset.mode === 'ending') area.innerHTML = '';
      area.dataset.mode = '';
      setSendingState(false);
      return;
    }
    area.dataset.mode = 'ending';
    area.innerHTML = `
      <div class="msg msg-system">
        <strong>${esc(s.ending.name || '结局')}</strong><br>
        ${esc(s.ending.description || '本次模拟已结束。')}
      </div>
    `;
    setSendingState(false);
  }

  function showMemoryPrompt() {
    const area = container.querySelector('#memory-prompt-area');
    area.innerHTML = `<div class="memory-prompt" id="btn-memory">📌 发生了关键事件，点击保存记忆</div>`;
    area.querySelector('#btn-memory').onclick = async () => {
      const recent = s.messages.slice(-6);
      await engine.memoryMgr.manualSummarize(recent.map(m => ({
        role: m.role === 'player' ? 'user' : 'assistant',
        content: m.content
      })));
      await engine.save();
      area.innerHTML = `<div class="msg msg-system">记忆已保存</div>`;
    };
  }

  function buildScenePrompt(script, s) {
    const stage = script.stages?.[s.currentStage];
    const stageName = stage?.name || `阶段 ${s.currentStage + 1}`;
    return `阶段：${s.currentStage + 1}/${script.stages?.length || '?'} - ${stageName}`;
  }

  function diffValues(before, after) {
    return (script.dimensions || []).filter(d => before[d.id] !== after[d.id]).map(d => ({
      id: d.id,
      name: d.name || d.id,
      from: before[d.id] ?? '-',
      to: after[d.id] ?? '-'
    }));
  }

  // Back button
  container.querySelector('#btn-back-chat').onclick = () => {
    engine.save();
    navigate('home');
  };
  container.querySelector('#btn-menu').onclick = async () => {
    if (await showConfirm('返回首页？当前进度会自动保存。', { title: '返回首页', confirmText: '返回' })) {
      engine.save();
      navigate('home');
    }
  };
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
