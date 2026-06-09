import { saveSession } from '../db.js';
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
    activeEffects: [],
    snapshots: [],
    memoryState: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function createGameEngine(session, script) {
  const memoryMgr = createMemoryManager();
  if (session.memoryState) memoryMgr.loadState(session.memoryState);
  session.activeEffects = session.activeEffects || [];
  session.snapshots = session.snapshots || [];
  if (!session.snapshots.length) createSnapshot('initial');

  function getRecentMessages(count = 3) {
    return session.messages.slice(-count);
  }

  function addPlayerMessage(content) {
    session.messages.push({ role: 'player', content, timestamp: Date.now() });
    memoryMgr.addTurn('player', content);
  }

  function addAIMessage(content, parsed = null, parseStatus = null) {
    session.messages.push({ role: 'ai', content, parsed, parseStatus, timestamp: Date.now() });
    return memoryMgr.addTurn('ai', content);
  }

  function updateValues(newVals) {
    if (!newVals) return;
    Object.assign(session.values, newVals);
  }

  function createSnapshot(reason = 'manual') {
    session.snapshots.push({
      reason,
      messageCount: session.messages.length,
      values: { ...session.values },
      currentStage: session.currentStage || 0,
      activeEffects: JSON.parse(JSON.stringify(session.activeEffects || [])),
      memoryState: memoryMgr.getState(),
      timestamp: Date.now()
    });
    if (session.snapshots.length > 80) session.snapshots.splice(0, session.snapshots.length - 80);
  }

  function restoreToMessage(messageCount) {
    const snapshots = session.snapshots || [];
    let snapshot = snapshots[0];
    for (const item of snapshots) {
      if (item.messageCount <= messageCount) snapshot = item;
      else break;
    }
    session.messages.splice(messageCount);
    if (!snapshot) return;
    session.values = { ...snapshot.values };
    session.currentStage = snapshot.currentStage || 0;
    session.activeEffects = JSON.parse(JSON.stringify(snapshot.activeEffects || []));
    if (snapshot.memoryState) memoryMgr.loadState(snapshot.memoryState);
    session.memoryState = memoryMgr.getState();
    session.snapshots = snapshots.filter(item => item.messageCount <= messageCount);
    if (!session.snapshots.length) createSnapshot('restored-initial');
  }

  async function save() {
    await memoryMgr.flushPending?.();
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
    createSnapshot,
    restoreToMessage,
    save
  };
}
