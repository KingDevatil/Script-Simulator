import { getSession, getScript } from '../db.js';
import { navigate } from '../router.js';
import { chat } from '../modules/llm-client.js';
import { createGameEngine } from '../modules/session.js';
import { buildPrompt } from '../modules/prompt-builder.js';
import { addEventEffects, advanceStage, checkEnding, checkEventTriggers, extractNarrative, extractValues, processEffects } from '../modules/script-engine.js';
import { buildCharacterNameExtractionPrompt, buildRepairPrompt, extractCharacterNames, formatTurnForStorage, getMessageTurn, parseCharacterNameExtraction, parseLLMTurn } from '../modules/llm-output.js';
let engine = null;
let sidebarOpen = false;
let prevValues = {};
let characterEditOpen = false;
const FALLBACK_OPTIONS = [
  { label: 'A', text: '先观察局势，再决定下一步。', value: '先观察局势，再决定下一步。' },
  { label: 'B', text: '主动开口试探对方的反应。', value: '主动开口试探对方的反应。' },
  { label: 'C', text: '先稳住情绪，避免暴露真实意图。', value: '先稳住情绪，避免暴露真实意图。' },
  { label: 'D', text: '直接采取行动，推进当前局面。', value: '直接采取行动，推进当前局面。' }
];

export async function render(container, { sessionId }) {
  const session = await getSession(sessionId);
  if (!session) { navigate('home'); return; }
  const script = await getScript(session.scriptId);
  if (!script) { navigate('home'); return; }

  engine = createGameEngine(session, script);
  const s = engine.session;
  prevValues = { ...s.values };
  if (refreshCharacterNamesFromHistory()) await engine.save();

  container.innerHTML = `
    <div class="chat-page">
      <div class="header">
        <button class="header-btn editor-back-btn" id="btn-back-chat">返回</button>
        <h1 style="font-size:15px">${esc(script.name)}</h1>
        <button class="header-btn editor-action-btn" id="btn-sidebar" title="打开侧边栏">侧栏</button>
      </div>
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
          <button class="chat-send" id="btn-send">发送</button>
        </div>
      </div>
      <div class="chat-sidebar-backdrop" id="sidebar-backdrop"></div>
      <aside class="chat-sidebar" id="chat-sidebar" aria-label="会话侧边栏">
        <div class="chat-sidebar-header">
          <div>
            <div class="chat-sidebar-kicker">当前会话</div>
            <h2>信息面板</h2>
          </div>
          <button class="chat-sidebar-close" id="btn-sidebar-close" title="关闭侧边栏">×</button>
        </div>
        <div class="chat-sidebar-content" id="sidebar-content"></div>
      </aside>
    </div>
  `;

  const msgContainer = container.querySelector('#messages');
  const input = container.querySelector('#chat-input');
  let currentMsgIdx = -1;

  renderSidebar();
  renderMessages();
  renderEnding();

  // Auto-scroll
  msgContainer.scrollTop = msgContainer.scrollHeight;

  setSidebarOpen(false);
  container.querySelector('#btn-sidebar').onclick = () => setSidebarOpen(true);
  container.querySelector('#btn-sidebar-close').onclick = () => setSidebarOpen(false);
  container.querySelector('#sidebar-backdrop').onclick = () => setSidebarOpen(false);

  // Input handling
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
        currentStage: s.currentStage,
        characterNames: s.characterNames
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
      const displayResponse = formatTurnForStorage(turn) || aiResponse;
      engine.addAIMessage(displayResponse, turn, parsedResult.status);

      // 提取角色名并存储（解决角色名不一致问题）
      const extractedNames = extractCharacterNames(displayResponse, script, s.characterNames);
      if (Object.keys(extractedNames).length) {
        Object.assign(s.characterNames, extractedNames);
      }

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
        // 在对话中显示结局
        const endingMsg = `【结局】${ending.name || '结局'}\n${ending.description || '本次模拟已结束。'}`;
        engine.addAIMessage(endingMsg, { narrative: endingMsg }, 'ending');
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
      renderSidebar();
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
    if (!input) return;
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
      let isEnding = false;
      
      if (m.role === 'ai') {
        // 检测是否是结局消息
        if (m.content.startsWith('【结局】')) {
          isEnding = true;
          display = m.content;
        } else {
          const turn = getMessageTurn(m, script);
          display = turn.narrative || extractNarrative(m.content);
          // 过滤身份标签，只保留人名
          display = filterRoleTags(display);
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
      }
      
      // 结局消息使用特殊样式
      if (isEnding) {
        const lines = display.split('\n');
        const title = lines[0]?.replace('【结局】', '') || '结局';
        const desc = lines.slice(1).join('\n') || '';
        return `<div class="msg msg-ending"><strong>${esc(title)}</strong>${esc(desc)}</div>`;
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

  function refreshCharacterNamesFromHistory() {
    const refreshed = {};
    for (const message of s.messages || []) {
      if (message.role !== 'ai') continue;
      const turn = getMessageTurn(message, script);
      const sourceText = turn.narrative || extractNarrative(message.content) || message.content;
      Object.assign(refreshed, extractCharacterNames(sourceText, script, refreshed));
    }
    let changed = false;
    s.characterNames = s.characterNames || {};
    for (const [id, name] of Object.entries(refreshed)) {
      if (!s.characterNames[id] || s.characterNames[id] !== name) {
        s.characterNames[id] = name;
        changed = true;
      }
    }
    return changed;
  }

  function setSidebarOpen(open) {
    sidebarOpen = open;
    const sidebar = container.querySelector('#chat-sidebar');
    const backdrop = container.querySelector('#sidebar-backdrop');
    sidebar.classList.toggle('open', sidebarOpen);
    backdrop.classList.toggle('open', sidebarOpen);
  }

  function renderSidebar() {
    const panel = container.querySelector('#sidebar-content');
    panel.innerHTML = [
      renderCharacterModule(),
      renderValueModule(),
      renderTimeline(),
      renderMemoryModule()
    ].join('');

    const memoryBtn = panel.querySelector('#btn-generate-memory');
    if (memoryBtn) memoryBtn.onclick = () => generateIncrementalMemory(memoryBtn);
    const identifyBtn = panel.querySelector('#btn-identify-characters');
    if (identifyBtn) identifyBtn.onclick = () => identifyCharacterNamesWithAI(identifyBtn);
    const editBtn = panel.querySelector('#btn-edit-characters');
    if (editBtn) editBtn.onclick = () => { characterEditOpen = true; renderSidebar(); };
    const cancelEditBtn = panel.querySelector('#btn-cancel-character-edit');
    if (cancelEditBtn) cancelEditBtn.onclick = () => { characterEditOpen = false; renderSidebar(); };
    const saveEditBtn = panel.querySelector('#btn-save-character-edit');
    if (saveEditBtn) saveEditBtn.onclick = () => saveCharacterNames(panel);
  }

  function renderCharacterModule() {
    const characterNames = s.characterNames || {};
    const chars = script.characters || [];
    const unresolvedCount = chars.filter(c => c.id !== 'player' && !characterNames[c.id]).length;
    const rows = chars
      .filter(c => c.id !== 'player')
      .map(c => {
        const realName = characterNames[c.id];
        const value = realName ? esc(realName) : '未揭示';
        return `<div class="num-row"><span class="num-label">${esc(c.name || c.id)}</span><span class="num-value">${value}</span></div>`;
      });
    Object.entries(characterNames)
      .filter(([id]) => id !== 'player' && !chars.some(c => c.id === id))
      .forEach(([id, name]) => {
        rows.push(`<div class="num-row"><span class="num-label">${esc(id)}</span><span class="num-value">${esc(name)}</span></div>`);
      });

    return `<section class="sidebar-module">
      <div class="sidebar-module-title-row">
        <div class="sidebar-module-title">角色信息</div>
        <div class="sidebar-title-actions">
          ${unresolvedCount ? `<span class="sidebar-badge">${unresolvedCount} 个未揭示</span>` : ''}
          <button class="sidebar-link-btn" id="btn-edit-characters">${characterEditOpen ? '编辑中' : '修改'}</button>
        </div>
      </div>
      ${characterEditOpen ? renderCharacterEditor(chars, characterNames) : (rows.length ? rows.join('') : '<p class="sidebar-empty">暂无角色信息</p>')}
      ${characterEditOpen ? '' : (unresolvedCount ? '<button class="btn btn-secondary btn-block btn-sm sidebar-module-action" id="btn-identify-characters">AI 识别角色名</button>' : '')}
    </section>`;
  }

  function renderCharacterEditor(chars, characterNames) {
    const rows = chars
      .filter(c => c.id !== 'player')
      .map(c => `<label class="character-edit-row">
        <span>${esc(c.name || c.id)}</span>
        <input class="form-input character-edit-input" data-character-id="${esc(c.id)}" value="${esc(characterNames[c.id] || '')}" placeholder="未揭示">
      </label>`)
      .join('');
    return `<div class="character-edit-list">
      ${rows || '<p class="sidebar-empty">暂无角色信息</p>'}
      <div class="character-edit-actions">
        <button class="btn btn-secondary btn-sm" id="btn-cancel-character-edit">取消</button>
        <button class="btn btn-primary btn-sm" id="btn-save-character-edit">保存</button>
      </div>
    </div>`;
  }

  async function saveCharacterNames(panel) {
    const nextNames = { ...(s.characterNames || {}) };
    panel.querySelectorAll('.character-edit-input').forEach(input => {
      const id = input.dataset.characterId;
      const value = input.value.trim();
      if (!id) return;
      if (value) nextNames[id] = value;
      else delete nextNames[id];
    });
    s.characterNames = nextNames;
    characterEditOpen = false;
    await engine.save();
    renderSidebar();
    showSystemMessage('角色信息已更新');
  }

  function renderValueModule() {
    const dimensionsHtml = script.dimensions?.length ? script.dimensions.map(d => {
      const v = s.values[d.id];
      return `<div class="num-row"><span class="num-label">${esc(d.name)}</span><span class="num-value">${v ?? '-'}</span></div>`;
    }).join('') : '';

    return `<section class="sidebar-module">
      <div class="sidebar-module-title">数值模块</div>
      ${dimensionsHtml || '<p class="sidebar-empty">此剧本无数值系统</p>'}
    </section>`;
  }

  function renderTimeline() {
    const items = (s.timeline || []).slice(-12).reverse();
    if (!items.length) return '<section class="sidebar-module state-timeline"><div class="sidebar-module-title">状态时间线</div><p class="timeline-empty">暂无状态变化</p></section>';
    return `<section class="sidebar-module state-timeline">
      <div class="sidebar-module-title">状态时间线</div>
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
    </section>`;
  }

  function renderMemoryModule() {
    const state = engine.memoryMgr.getState();
    const memories = state.memories || [];
    const pendingCount = state.pendingMessages?.length || 0;
    return `<section class="sidebar-module">
      <div class="sidebar-module-title-row">
        <div class="sidebar-module-title">记忆模块</div>
        <span class="sidebar-badge">${pendingCount} 条待总结</span>
      </div>
      <div class="memory-list">
        ${memories.length
          ? memories.map((memory, idx) => renderMemoryItem(memory, idx)).join('')
          : '<p class="sidebar-empty">当前会话暂无记忆</p>'}
      </div>
      <button class="btn btn-secondary btn-block btn-sm" id="btn-generate-memory" ${pendingCount ? '' : 'disabled'}>增量生成记忆</button>
    </section>`;
  }

  function renderMemoryItem(memory, idx) {
    const text = String(memory ?? '').trim();
    return `<details class="memory-item" open>
      <summary class="memory-index">记忆 ${idx + 1}</summary>
      <p>${esc(text)}</p>
    </details>`;
  }

  async function generateIncrementalMemory(button) {
    if (engine._summarizingMemory) return;
    const state = engine.memoryMgr.getState();
    if (!state.pendingMessages?.length) {
      renderSidebar();
      return;
    }
    engine._summarizingMemory = true;
    button.disabled = true;
    button.textContent = '生成中...';
    const summary = await engine.memoryMgr.summarizePending();
    await engine.save();
    engine._summarizingMemory = false;
    renderSidebar();
    showSystemMessage(summary ? '记忆已更新' : '记忆生成失败，请稍后重试');
  }

  async function identifyCharacterNamesWithAI(button) {
    if (engine._identifyingCharacters) return;
    const unresolved = (script.characters || []).filter(c => c.id !== 'player' && !s.characterNames?.[c.id]);
    if (!unresolved.length) return;
    const sourceText = collectCharacterEvidenceText();
    if (!sourceText) {
      showSystemMessage('暂无可用于识别角色名的会话正文');
      return;
    }

    engine._identifyingCharacters = true;
    button.disabled = true;
    button.textContent = '识别中...';
    try {
      const prompt = buildCharacterNameExtractionPrompt(sourceText, unresolved);
      const response = await chat([{ role: 'user', content: prompt }], { timeoutMs: 30000, retries: 0 });
      const names = parseCharacterNameExtraction(response, unresolved);
      if (Object.keys(names).length) {
        s.characterNames = { ...(s.characterNames || {}), ...names };
        await engine.save();
        renderSidebar();
        showSystemMessage('角色名已更新');
      } else {
        showSystemMessage('未能识别出新的角色名');
      }
    } catch (err) {
      showSystemMessage('角色名识别失败: ' + err.message);
    } finally {
      engine._identifyingCharacters = false;
      renderSidebar();
    }
  }

  function collectCharacterEvidenceText() {
    return (s.messages || [])
      .filter(message => message.role === 'ai')
      .map(message => {
        const turn = getMessageTurn(message, script);
        return turn.narrative || extractNarrative(message.content) || message.content;
      })
      .filter(Boolean)
      .join('\n\n')
      .slice(-6000);
  }

  function renderOptions() {
    const optContainer = container.querySelector('#chat-options');
    if (s.ended) { optContainer.innerHTML = ''; return; }
    const lastAI = [...s.messages].reverse().find(m => m.role === 'ai');
    if (!lastAI) { optContainer.innerHTML = ''; return; }

    const turn = getMessageTurn(lastAI, script);
    const sourceOptions = (turn.options || []).length ? turn.options : FALLBACK_OPTIONS;
    const opts = sourceOptions.map(o => ({ label: `${o.label}. ${o.text}`, value: o.value || o.text }));
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
    // 结局已在对话中显示，这里只显示返回按钮
    area.innerHTML = `
      <div style="text-align:center;padding:12px">
        <button class="btn btn-primary" id="btn-back-ending">返回首页</button>
      </div>
    `;
    area.querySelector('#btn-back-ending').onclick = () => {
      engine.save();
      navigate('home');
    };
    setSendingState(false);
  }

  function showMemoryPrompt() {
    const area = container.querySelector('#memory-prompt-area');
    area.innerHTML = `<div class="memory-prompt" id="btn-memory">📌 发生了关键事件，点击保存记忆</div>`;
    area.querySelector('#btn-memory').onclick = async () => {
      const summary = await engine.memoryMgr.summarizePending();
      await engine.save();
      renderSidebar();
      area.innerHTML = `<div class="msg msg-system">${summary ? '记忆已保存' : '暂无新的会话内容可保存'}</div>`;
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
}

// 过滤身份标签，只保留人名
// 例如："张明（现任）" -> "张明"
function filterRoleTags(text) {
  if (!text) return text;
  // 匹配中文人名后面的身份标签，格式为"人名（身份标签）"或"人名(身份标签)"
  return text.replace(/([\u4e00-\u9fa5]{2,4})[（(][^）)]*[）)]/g, '$1');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
