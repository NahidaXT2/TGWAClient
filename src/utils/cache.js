// ============================================================
// Caches
// ============================================================
function createSafeCache() {
    const store = new Map();
    return {
        get: (key) => store.get(key),
        set: (key, value) => { store.set(key, value); return true; },
        del: (key) => {
            if (key == null) return 0;
            return store.delete(key) ? 1 : 0;
        },
        flushAll: () => { store.clear(); },
    };
}

module.exports = { createSafeCache };
