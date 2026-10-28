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

export function getPinnedLots() {
  const list = readJson('planner-pinned-lots', []);
  return new Set(Array.isArray(list) ? list : []);
}

export function savePinnedLots(set) {
  return writeJson('planner-pinned-lots', [...set]);
}
