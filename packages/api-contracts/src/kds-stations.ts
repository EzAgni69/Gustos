/**
 * Gusto — Kitchen station routing (shared by POS server, KDS and Captain app)
 *
 * Decides which KDS station prepares each item. The POS server uses the same
 * mapping to know which stations must finish a KOT before it is READY, and to
 * build the Expo (pass) checklist.
 */

export interface KDSStationItem {
  name: string;
  categoryId?: string | null;
}

export interface StationConfig {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  categories: string[];
}

export const KDS_STATIONS: StationConfig[] = [
  {
    id: "pizza-oven",
    name: "Pizza Oven",
    shortName: "PIZZA OVEN",
    icon: "🍕",
    categories: [
      "cat-pizza-reg", "cat-pizza-prem", "cat-calzones", "cat-combos",
      "5aa53373-e5f5-48bb-a71c-88da6587157b", // Regular Pizzas
      "fb728bde-fe2f-4535-a093-2d012bfbd63d", // Premium Pizzas
      "1b1a2bd0-f2c7-4c3d-9eeb-83ace0eeb567", // Calzones
      "49c3f4ca-65ca-45ac-9352-589216caeddd", // Combos & Specials
    ],
  },
  {
    id: "pasta-starters",
    name: "Pasta & Starters",
    shortName: "PASTA & STARTERS",
    icon: "🍝",
    categories: [
      "cat-pasta", "cat-starters", "cat-sandwiches", "cat-bruschetta",
      "4cd3a8d0-c68b-4072-afa3-063df179504d", // Starters
      "3f7f530a-d03b-4ec7-82a8-b92ab9dea728", // Bruschetta
      "a0c63bc4-cf92-42cb-a9e3-011766c35b96", // Sandwiches
      "a62f1fd8-cf22-49d0-ae15-dd65f5ea59a3", // Pastas
      "383a8545-3442-4c5e-b977-7af87e9a1d65", // Add-ons
    ],
  },
  {
    id: "beverages-pantry",
    name: "Beverages & Pantry",
    shortName: "PANTRY & DRINKS",
    icon: "🍹",
    categories: [
      "cat-refreshments", "cat-salads", "cat-desserts",
      "833f4bfb-902e-4837-aa97-9b4814496fcf", // Salads
      "17cb63b9-dbf5-4fcf-9f2b-8dfc1664d604", // Refreshments
      "fc524c1b-f441-46de-a2ac-d184ae06b16e", // Desserts
    ],
  },
];

/**
 * Determine which KDS station handles a given item.
 */
export function getItemStationId(item: KDSStationItem): string {
  if (item.categoryId) {
    for (const st of KDS_STATIONS) {
      if (st.categories.includes(item.categoryId)) {
        return st.id;
      }
    }
  }
  // Fallback by name heuristics if categoryId is missing
  const name = item.name.toLowerCase();
  if (
    name.includes("pizza") ||
    name.includes("calzone") ||
    name.includes("8\"") ||
    name.includes("12\"") ||
    name.includes("margherita") ||
    name.includes("marinara") ||
    name.includes("burrata")
  ) {
    return "pizza-oven";
  }
  if (
    name.includes("pasta") ||
    name.includes("spaghetti") ||
    name.includes("penne") ||
    name.includes("fettuccine") ||
    name.includes("tasca") ||
    name.includes("sandwich") ||
    name.includes("bruschetta") ||
    name.includes("starter") ||
    name.includes("garlic bread") ||
    name.includes("crostini") ||
    name.includes("fries")
  ) {
    return "pasta-starters";
  }
  if (
    name.includes("mojito") ||
    name.includes("water") ||
    name.includes("soda") ||
    name.includes("beverage") ||
    name.includes("tea") ||
    name.includes("coffee") ||
    name.includes("coke") ||
    name.includes("sprite") ||
    name.includes("fanta") ||
    name.includes("salad") ||
    name.includes("dessert") ||
    name.includes("tiramisu") ||
    name.includes("pana cotta") ||
    name.includes("brownie")
  ) {
    return "beverages-pantry";
  }
  return "pasta-starters";
}

/** Virtual station: the pass / expediter screen. Not an item-routing station. */
export const EXPO_STATION_ID = "expo";

export function getStationConfig(stationId: string): StationConfig | undefined {
  return KDS_STATIONS.find((s) => s.id === stationId);
}

/**
 * Stations that must mark a KOT ready. A KOT pinned to a known station needs
 * only that station; otherwise every station that owns one of its items.
 */
export function getRequiredStations(kot: { station?: string | null; items: KDSStationItem[] }): string[] {
  const pinned = kot.station ? KDS_STATIONS.find((s) => s.id === kot.station!.toLowerCase()) : undefined;
  if (pinned) return [pinned.id];
  const ids = new Set(kot.items.map(getItemStationId));
  // Keep the configured station order for stable display
  return KDS_STATIONS.map((s) => s.id).filter((id) => ids.has(id));
}
