import { summarize as defaultSummarize } from './llm-client.js';

export function createMemoryManager({ autoInterval = 10, maxMemories = 10, summarizeFn = defaultSummarize } = {}) {
  let memories = [];
  let turnCount = 0;
  let pendingMessages = [];
  let pendingSummary = null;

  function addTurn(role, content) {
    turnCount++;
    pendingMessages.push({ role, content });
    if (turnCount % autoInterval === 0) {
      pendingSummary = autoSummarize().finally(() => { pendingSummary = null; });
      return pendingSummary;
    }
    return null;
  }

  async function autoSummarize() {
    if (pendingMessages.length === 0) return null;
    const msgs = pendingMessages.splice(0);
    try {
      const summary = await summarizeFn(msgs.map(m => ({
        role: m.role === 'player' ? 'user' : 'assistant',
        content: m.content
      })));
      if (!isValidSummary(summary)) {
        pendingMessages.unshift(...msgs);
        return null;
      }
      memories.push(summary);
      compressIfNeeded();
      return summary;
    } catch {
      pendingMessages.unshift(...msgs);
      return null;
    }
  }

  async function manualSummarize(recentMessages) {
    if (!recentMessages?.length) return null;
    try {
      const summary = await summarizeFn(recentMessages.map(m => ({
        role: m.role === 'player' ? 'user' : 'assistant',
        content: m.content
      })));
      if (!isValidSummary(summary)) return null;
      memories.push(summary);
      compressIfNeeded();
      return summary;
    } catch {
      return null;
    }
  }

  async function summarizePending() {
    if (pendingMessages.length === 0) return null;
    const msgs = pendingMessages.splice(0);
    try {
      const summary = await summarizeFn(msgs.map(m => ({
        role: m.role === 'player' ? 'user' : 'assistant',
        content: m.content
      })));
      if (!isValidSummary(summary)) {
        pendingMessages.unshift(...msgs);
        return null;
      }
      memories.push(summary);
      compressIfNeeded();
      return summary;
    } catch {
      pendingMessages.unshift(...msgs);
      return null;
    }
  }

  function compressIfNeeded() {
    if (memories.length <= maxMemories) return;
    const excess = memories.length - maxMemories;
    const toMerge = memories.splice(0, Math.max(excess, 2));
    const merged = toMerge.map(m => String(m || '').trim()).filter(Boolean).join('；');
    if (merged) memories.unshift(merged);
  }

  function getMemories() { return [...memories]; }

  function getState() {
    return { memories: [...memories], turnCount, pendingMessages: [...pendingMessages] };
  }

  function loadState(state) {
    memories = (state.memories || []).filter(isValidSummary);
    turnCount = state.turnCount || 0;
    pendingMessages = state.pendingMessages || [];
  }

  async function flushPending() {
    if (pendingSummary) await pendingSummary;
  }

  return { addTurn, autoSummarize, manualSummarize, summarizePending, flushPending, getMemories, getState, loadState };
}

function isValidSummary(summary) {
  return typeof summary === 'string' && summary.trim().length > 0;
}
