import { saveSession, getSession as dbGet } from '../db.js';
import { createMemoryManager } from './memory.js';

export function createSession(script, selections = {}) {
  const values = {};
  (script.dimensions || []).forEach(d => {
    values[d.id] = d.initial?.[0] ?? 50;
  });

  return {
    id: crypto.randomUUID(),
    scriptId: script.id,
    scriptName: script.name,
    selections,
    values,
    messages: [],
    currentStage: 0,
    memoryState: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function createGameEngine(session, script) {
  const memoryMgr = createMemoryManager();
  if (session.memoryState) memoryMgr.loadState(session.memoryState);

  function getRecentMessages(count = 3) {
    return session.messages.slice(-count);
  }

  function addPlayerMessage(content) {
    session.messages.push({ role: 'player', content, timestamp: Date.now() });
    memoryMgr.addTurn('player', content);
  }

  function addAIMessage(content) {
    session.messages.push({ role: 'ai', content, timestamp: Date.now() });
    return memoryMgr.addTurn('ai', content);
  }

  function updateValues(newVals) {
    if (!newVals) return;
    Object.assign(session.values, newVals);
  }

  function save() {
    session.memoryState = memoryMgr.getState();
    session.updatedAt = Date.now();
    return saveSession({ ...session });
  }

  return {
    session,
    script,
    memoryMgr,
    getRecentMessages,
    addPlayerMessage,
    addAIMessage,
    updateValues,
    save
  };
}
