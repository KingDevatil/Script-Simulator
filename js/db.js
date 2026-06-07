const DB_NAME = 'ScriptSimulator';
const DB_VERSION = 1;

let db = null;

export function init() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('scripts')) {
        d.createObjectStore('scripts', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('sessions')) {
        const s = d.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('scriptId', 'scriptId', { unique: false });
      }
      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

function tx(store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

function req2p(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Scripts
export async function getAllScripts() {
  return req2p(tx('scripts').getAll());
}
export async function getScript(id) {
  return req2p(tx('scripts').get(id));
}
export async function saveScript(script) {
  return req2p(tx('scripts', 'readwrite').put(script));
}
export async function deleteScript(id) {
  return req2p(tx('scripts', 'readwrite').delete(id));
}

// Sessions
export async function getAllSessions() {
  return req2p(tx('sessions').getAll());
}
export async function getSession(id) {
  return req2p(tx('sessions').get(id));
}
export async function saveSession(session) {
  return req2p(tx('sessions', 'readwrite').put(session));
}
export async function deleteSession(id) {
  return req2p(tx('sessions', 'readwrite').delete(id));
}
export async function getSessionsByScript(scriptId) {
  const store = tx('sessions');
  const idx = store.index('scriptId');
  return req2p(idx.getAll(scriptId));
}

// Settings
export async function getSetting(key) {
  const r = await req2p(tx('settings').get(key));
  return r ? r.value : null;
}
export async function setSetting(key, value) {
  return req2p(tx('settings', 'readwrite').put({ key, value }));
}
