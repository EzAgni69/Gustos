import type { MenuItem, Recipe } from "@gusto/api-contracts";

/**
 * Calculates the estimated cost per serving for a recipe.
 *
 * Sums (quantity × costPerUnit) for each ingredient and rounds to 2 decimal
 * places. Returns 0 when the ingredients array is empty.
 *
 * Requirements: 6.5
 */
export function calculateRecipeCost(
  ingredients: { quantity: number; costPerUnit: number }[]
): number {
  if (ingredients.length === 0) return 0;

  const total = ingredients.reduce(
    (sum, { quantity, costPerUnit }) => sum + quantity * costPerUnit,
    0
  );

  return Math.round(total * 100) / 100;
}

/**
 * Counts how many menu items have a recipe configured.
 *
 * A menu item is considered "configured" when its `id` appears as the
 * `menuItemId` on at least one Recipe.
 *
 * Returns `{ configured: number; total: number }` where:
 *   - `total`      = menuItems.length
 *   - `configured` = count of menuItems whose id is found in recipes
 *
 * Requirements: 6.1
 */
export function countConfiguredRecipes(
  menuItems: MenuItem[],
  recipes: Recipe[]
): { configured: number; total: number } {
  const configuredIds = new Set(recipes.map((r) => r.menuItemId));

  const configured = menuItems.filter((item) =>
    configuredIds.has(item.id)
  ).length;

  return { configured, total: menuItems.length };
}
