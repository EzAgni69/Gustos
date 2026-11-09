/**
 * KDS-TV — Special request classifier
 *
 * Sorts item modifiers and free-text notes into tiers so the critical ones
 * (allergies, religious/dietary restrictions) can't be missed during a rush:
 *
 *   ALLERGY   — health risk: gluten/nut/dairy/egg/shellfish/sesame/soy, "allergic"
 *   DIETARY   — restriction: Jain, Swaminarayan, Satvik, vegan, no onion/garlic
 *   SPICE     — spice level: extra/less/no spicy, no chilli, mild
 *   ADJUST    — prep change: less cheese, no mayo, extra butter, less oil …
 *   COMBO     — combo component picks ("L: Margherita", "Drink: Coke")
 *   PLAIN     — anything else (e.g. "Thin crust")
 *
 * Patterns require a qualifier ("no", "less", "-free", "allergy") so menu words
 * like "Garlic Bread" or a "Bell Pepper" topping aren't flagged.
 */

export type RequestTier = "ALLERGY" | "DIETARY" | "SPICE" | "ADJUST" | "COMBO" | "PLAIN";

export interface ClassifiedRequest {
  text: string;
  tier: RequestTier;
  icon: string;
}

const ALLERGENS = "nuts?|peanuts?|cashews?|almonds?|walnuts?|pistachios?|tree[\\s-]*nuts?|gluten|wheat|dairy|milk|lactose|eggs?|shellfish|prawns?|shrimps?|seafood|fish|sesame|soy|soya|mushrooms?";

const PATTERNS: Array<{ tier: Exclude<RequestTier, "COMBO" | "PLAIN">; re: RegExp }> = [
  // Allergies
  { tier: "ALLERGY", re: /\ballerg(y|ies|ic)\b/i },
  { tier: "ALLERGY", re: /\b(celiac|coeliac|eggless|anaphyla\w*)\b/i },
  { tier: "ALLERGY", re: new RegExp(`\\b(${ALLERGENS})[\\s-]*free\\b`, "i") },
  { tier: "ALLERGY", re: new RegExp(`\\b(no|without|w\\/o|zero)\\s+(${ALLERGENS})\\b`, "i") },

  // Religious / dietary restrictions
  { tier: "DIETARY", re: /\b(jain|swaminarayan|satvik|sattvic|vegan)\b/i },
  { tier: "DIETARY", re: /\b(no|without|w\/o|zero)\s+(onions?|garlic)\b/i },
  { tier: "DIETARY", re: /\b(onion|garlic)[\s/&-]*(and\s+)?(onion|garlic)?[\s-]*free\b/i },
  { tier: "DIETARY", re: /\b(no|without)\s+(meat|beef|pork|alcohol)\b/i },

  // Spice level
  { tier: "SPICE", re: /\b(extra|more|very|less|low|no|non|mild|medium|less)[\s-]*(spicy|spice|hot)\b/i },
  { tier: "SPICE", re: /\b(no|less|extra)\s+(chill?ies|chill?is?|chilly|green\s+chill?i)\b/i },
  { tier: "SPICE", re: /^\s*(spicy|mild|medium|hot)\s*$/i },

  // Prep adjustments
  { tier: "ADJUST", re: /\b(no|less|extra|without|w\/o|light|double|add|more|lite|less\s+of)\s+[a-z]/i },
  { tier: "ADJUST", re: /\b(well[\s-]*done|on\s+the\s+side|separate|sauce\s+on\s+side)\b/i },
];

const COMBO_RE = /^\s*(l|r|left|right|pizza|drink|side|main|dessert)\s*:/i;

const TIER_RANK: Record<RequestTier, number> = { ALLERGY: 5, DIETARY: 4, SPICE: 3, ADJUST: 2, COMBO: 1, PLAIN: 0 };

export const TIER_ICON: Record<RequestTier, string> = {
  ALLERGY: "⚠️",
  DIETARY: "🚫",
  SPICE: "🌶️",
  ADJUST: "✏️",
  COMBO: "🌓",
  PLAIN: "•",
};

/** Highest-priority tier that matches the text. */
export function classifyRequest(text: string): RequestTier {
  if (!text?.trim()) return "PLAIN";
  if (COMBO_RE.test(text)) return "COMBO";
  for (const { tier, re } of PATTERNS) {
    if (re.test(text)) return tier; // PATTERNS is ordered by priority
  }
  return "PLAIN";
}

export function classify(text: string): ClassifiedRequest {
  const tier = classifyRequest(text);
  return { text, tier, icon: TIER_ICON[tier] };
}

/** Is tier `a` more urgent than tier `b`? */
export function isHigherTier(a: RequestTier, b: RequestTier): boolean {
  return TIER_RANK[a] > TIER_RANK[b];
}

/** Sort modifiers so critical requests come first (stable for equal tiers). */
export function sortByUrgency(requests: ClassifiedRequest[]): ClassifiedRequest[] {
  return requests
    .map((r, i) => ({ r, i }))
    .sort((a, b) => TIER_RANK[b.r.tier] - TIER_RANK[a.r.tier] || a.i - b.i)
    .map(({ r }) => r);
}

/**
 * Ticket-level alert: the most critical ALLERGY/DIETARY requests across the
 * given items (modifiers + notes), for the banner at the top of the card.
 */
export function getTicketAlert(
  items: Array<{ modifiers?: string[]; notes?: string | null }>
): { tier: "ALLERGY" | "DIETARY"; labels: string[] } | null {
  const found: Record<"ALLERGY" | "DIETARY", Set<string>> = { ALLERGY: new Set(), DIETARY: new Set() };
  for (const item of items) {
    for (const text of [...(item.modifiers ?? []), ...(item.notes ? [item.notes] : [])]) {
      const tier = classifyRequest(text);
      if (tier === "ALLERGY" || tier === "DIETARY") found[tier].add(text.trim());
    }
  }
  if (found.ALLERGY.size > 0) return { tier: "ALLERGY", labels: [...found.ALLERGY] };
  if (found.DIETARY.size > 0) return { tier: "DIETARY", labels: [...found.DIETARY] };
  return null;
}
