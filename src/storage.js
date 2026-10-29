// localStorage can be unavailable (private mode, blocked site data) or full.
export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Commit related values together. localStorage has no multi-key transaction,
// so restore their previous raw values if any write fails (for example quota).
export function writeJsonEntries(entries) {
  let storage;
  const previous = new Map();
  const touched = [];
  try {
    if (!Array.isArray(entries)) return false;
    const serialized = new Map();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') return false;
      const raw = JSON.stringify(entry[1]);
      if (typeof raw !== 'string') return false;
      serialized.set(entry[0], raw);
    }
    if (!serialized.size) return true;
    storage = localStorage;
    for (const key of serialized.keys()) previous.set(key, storage.getItem(key));
    for (const [key, raw] of serialized) {
      storage.setItem(key, raw);
      // setItem is atomic: a throwing call leaves that key's old value intact.
      touched.push(key);
    }
    return true;
  } catch {
    // Free space used by the partial new values before restoring the old data.
    // Restoring one key at a time without this pass can itself exceed quota.
    for (const key of touched) {
      try { storage.removeItem(key); } catch { /* Storage may have become unavailable. */ }
    }
    for (const key of touched) {
      const raw = previous.get(key);
      if (raw == null) continue;
      try { storage.setItem(key, raw); } catch { /* Best effort if storage remains unavailable. */ }
    }
    return false;
  }
}

export function getPinnedLots() {
  const list = readJson('planner-pinned-lots', []);
  return new Set(Array.isArray(list) ? list : []);
}

export function savePinnedLots(set) {
  return writeJson('planner-pinned-lots', [...set]);
}
