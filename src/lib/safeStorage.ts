/** Storage is optional: blocked access or quota errors must not break the UI. */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Keep the in-memory preference when persistence is unavailable.
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage may be blocked even when reading it previously succeeded.
    }
  },
};
