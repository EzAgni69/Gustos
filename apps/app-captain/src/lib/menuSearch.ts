/**
 * Gusto Captain — Menu search & dietary filters
 *
 * Pure helpers used by the Menu screen:
 *  - searchMenu(): name / short-code search, ranked (exact code → name prefix
 *    → word prefix → substring), accent- and case-insensitive, multi-word.
 *  - dietary filters: Veg, Non-Veg, Spicy, Chef's Special.
 *
 * The menu schema only stores `isVeg`. "Spicy" is inferred from the item's
 * name/description; "Chef's Special" only matches an explicit marker so we
 * never guess. Both read real flags first if the API starts sending them.
 */

import type { MenuItemResponse } from "../services/api";

export type DietaryFilter = "VEG" | "NON_VEG" | "SPICY" | "CHEF_SPECIAL";

export const DIETARY_FILTERS: Array<{ id: DietaryFilter; label: string; icon: string }> = [
  { id: "VEG", label: "Pure Veg", icon: "🟢" },
  { id: "NON_VEG", label: "Non-Veg", icon: "🔴" },
  { id: "SPICY", label: "Spicy", icon: "🌶️" },
  { id: "CHEF_SPECIAL", label: "Chef's Special", icon: "🧀" },
];

/** Optional fields a richer menu API may send; used in preference to inference. */
type TaggedItem = MenuItemResponse & {
  isSpicy?: boolean;
  isChefSpecial?: boolean;
  tags?: string[] | string | null;
};

export function normalize(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents: "Città" → "citta"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function itemTags(item: TaggedItem): string[] {
  if (Array.isArray(item.tags)) return item.tags.map(normalize);
  if (typeof item.tags === "string" && item.tags.trim()) {
    try {
      const parsed = JSON.parse(item.tags);
      if (Array.isArray(parsed)) return parsed.map((t) => normalize(String(t)));
    } catch {
      return item.tags.split(",").map(normalize);
    }
  }
  return [];
}

// Chillies, jalapeños, "piccante" (Italian for spicy), peri peri, etc.
// Word-bounded so "Periphery Cheese Burst" doesn't match "peri".
const SPICY_RE =
  /\b(spicy|chill?i(e|es|s)?|chilly|jalapenos?|piccante|peri peri|piri piri|arrabbiata|diavola|schezwan|szechuan|habanero|fiery|hot sauce|sriracha|nduja)\b/;
const CHEF_SPECIAL_RE = /\bchef(s| s)? (special|recommends?|pick|choice)\b/;

export function isSpicy(item: MenuItemResponse): boolean {
  const t = item as TaggedItem;
  if (typeof t.isSpicy === "boolean") return t.isSpicy;
  if (itemTags(t).some((tag) => tag === "spicy")) return true;
  return SPICY_RE.test(`${normalize(item.name)} ${normalize(item.description)}`);
}

export function isChefSpecial(item: MenuItemResponse): boolean {
  const t = item as TaggedItem;
  if (typeof t.isChefSpecial === "boolean") return t.isChefSpecial;
  if (itemTags(t).some((tag) => tag === "chef special" || tag === "chefs special")) return true;
  return CHEF_SPECIAL_RE.test(`${normalize(item.name)} ${normalize(item.description)}`);
}

export function matchesFilter(item: MenuItemResponse, filter: DietaryFilter): boolean {
  switch (filter) {
    case "VEG":
      return item.isVeg;
    case "NON_VEG":
      return !item.isVeg;
    case "SPICY":
      return isSpicy(item);
    case "CHEF_SPECIAL":
      return isChefSpecial(item);
  }
}

/** Items must match every active filter (Veg + Spicy = spicy veg items). */
export function applyFilters(items: MenuItemResponse[], filters: ReadonlySet<DietaryFilter>): MenuItemResponse[] {
  if (filters.size === 0) return items;
  return items.filter((item) => [...filters].every((f) => matchesFilter(item, f)));
}

/**
 * Rank an item against the query; 0 = no match. Every query word must match
 * the start of a word in the name, or (for one-word queries) the short code.
 */
function scoreItem(item: MenuItemResponse & { shortCode?: string }, query: string, words: string[]): number {
  const code = normalize(item.shortCode);
  if (code && code === query) return 100; // "101" → item 101
  const name = normalize(item.name);
  if (!name) return 0;
  if (name === query) return 90;
  if (name.startsWith(query)) return 80; // "margh" → "margherita"

  const nameWords = name.split(" ");
  const allWordsPrefix = words.every((w) => nameWords.some((nw) => nw.startsWith(w)));
  if (allWordsPrefix) return 60; // "pesto pizza" / "piz pes"
  if (words.every((w) => name.includes(w))) return 40; // inner substring "herit"
  if (code && words.length === 1 && code.startsWith(query)) return 20; // partial code "10"
  return 0;
}

/** Search the whole menu by name or short code; best matches first. */
export function searchMenu(items: MenuItemResponse[], rawQuery: string): MenuItemResponse[] {
  const query = normalize(rawQuery);
  if (!query) return items;
  const words = query.split(" ");
  return items
    .map((item, index) => ({ item, index, score: scoreItem(item, query, words) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}
