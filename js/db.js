// IndexedDB layer: remembers every folder ("root") the user has granted
// access to, caches a scanned index per root (so reopening the same
// folder is instant), and stores history / playlists / settings.
const LTDB = (() => {
  const DB_NAME = 'localtube';
  const DB_VERSION = 2;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('roots')) db.createObjectStore('roots', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('index')) db.createObjectStore('index');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode) {
    const db = await open();
    return db.transaction(store, mode).objectStore(store);
  }
  function wrap(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now();
  }

  return {
    uuid,

    // --- legacy single-handle helpers (kept for backwards compatibility) ---
    async setHandle(key, handle) { const s = await tx('handles', 'readwrite'); return wrap(s.put(handle, key)); },
    async getHandle(key) { const s = await tx('handles', 'readonly'); return wrap(s.get(key)).then(r => r || null); },

    // --- roots (folders the user has picked) ---
    async listRoots() {
      const s = await tx('roots', 'readonly');
      const all = await wrap(s.getAll());
      return (all || []).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    },
    async addRoot({ name, handle, kind }) {
      const root = { id: uuid(), name, handle: handle || null, kind, addedAt: Date.now() };
      const s = await tx('roots', 'readwrite');
      await wrap(s.put(root));
      return root;
    },
    async removeRoot(id) {
      const s = await tx('roots', 'readwrite');
      await wrap(s.delete(id));
      const idx = await tx('index', 'readwrite');
      await wrap(idx.delete(id));
    },
    async findRootByHandle(handle) {
      if (!handle || !handle.isSameEntry) return null;
      const roots = await this.listRoots();
      for (const r of roots) {
        if (r.handle) {
          try { if (await handle.isSameEntry(r.handle)) return r; } catch (e) { /* ignore */ }
        }
      }
      return null;
    },

    // --- per-root cached index of scanned videos ---
    async getIndex(rootId) {
      const s = await tx('index', 'readonly');
      const rec = await wrap(s.get(rootId));
      return rec ? rec.entries : null;
    },
    async setIndex(rootId, entries) {
      // Strip transient/non-storable fields before persisting.
      const clean = entries.map(e => ({
        name: e.name, folder: e.folder, size: e.size, lastModified: e.lastModified,
        duration: e.duration || 0, width: e.width || 0, height: e.height || 0,
        isShort: !!e.isShort, thumb: e.thumb || null,
        kind: e.kind, fileHandle: e.kind === 'handle' ? e.fileHandle : undefined
      }));
      const s = await tx('index', 'readwrite');
      return wrap(s.put({ rootId, updatedAt: Date.now(), entries: clean }, rootId));
    },

    // --- generic key/value (history, playlists, settings) ---
    async setKV(key, value) { const s = await tx('kv', 'readwrite'); return wrap(s.put(value, key)); },
    async getKV(key) { const s = await tx('kv', 'readonly'); return wrap(s.get(key)); }
  };
})();
