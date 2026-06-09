import { summarize } from './llm-client.js';

export function createMemoryManager({ autoInterval = 10, maxMemories = 10 } = {}) {
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
      const summary = await summarize(msgs.map(m => ({
        role: m.role === 'player' ? 'user' : 'assistant',
        content: m.content
      })));
      memories.push(summary);
      compressIfNeeded();
      return summary;
    } catch {
      return null;
    }
  }

  async function manualSummarize(recentMessages) {
    if (!recentMessages?.length) return null;
    try {
      const summary = await summarize(recentMessages.map(m => ({
        role: m.role === 'player' ? 'user' : 'assistant',
        content: m.content
      })));
      memories.push(summary);
      compressIfNeeded();
      return summary;
    } catch {
      return null;
    }
  }

  function compressIfNeeded() {
    if (memories.length <= maxMemories) return;
    const excess = memories.length - maxMemories;
    const toMerge = memories.splice(0, Math.max(excess, 2));
    const merged = toMerge.join('；');
    memories.unshift(merged);
  }

  function getMemories() { return [...memories]; }

  function getState() {
    return { memories: [...memories], turnCount, pendingMessages: [...pendingMessages] };
  }

  function loadState(state) {
    memories = state.memories || [];
    turnCount = state.turnCount || 0;
    pendingMessages = state.pendingMessages || [];
  }

  async function flushPending() {
    if (pendingSummary) await pendingSummary;
  }

  return { addTurn, autoSummarize, manualSummarize, flushPending, getMemories, getState, loadState };
}
