/* Settings and reading progress, kept in this browser only. Storage can be unavailable
   (private windows, blocked site data): everything still works, it just is not remembered. */

const KEYS = { settings: "firefly.settings", progress: "firefly.progress" };

export const DEFAULT_SETTINGS = { mode: "listen", autoTurn: true, largeText: false, music: true, muted: false };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not remembered */ }
}

export const loadSettings = () => read(KEYS.settings, DEFAULT_SETTINGS);
export const saveSettings = (s) => write(KEYS.settings, s);

/** { [bookId]: { page, read: [pageIndex...], finished } } */
export const loadProgress = () => read(KEYS.progress, {});
export const saveProgress = (p) => write(KEYS.progress, p);
