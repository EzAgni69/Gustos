const OUTLET_ID_KEY = "gusto_selected_outlet_id";

/**
 * Reads the persisted outlet ID from localStorage.
 * Returns null during SSR (when window is not defined).
 */
export function getPersistedOutletId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(OUTLET_ID_KEY);
}

/**
 * Writes the given outlet ID to localStorage.
 * No-ops during SSR (when window is not defined).
 */
export function setPersistedOutletId(id: string): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(OUTLET_ID_KEY, id);
}
