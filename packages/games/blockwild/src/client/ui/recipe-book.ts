/** Recipe book filtering and ingredient summaries (pure). */
import { countItem } from '../../shared/inventory';
import { B, I, itemName, itemOf, type ItemCategory, type Slot } from '../../shared/items';
import { canCraft, ingredientsOf, RECIPES, type Ingredient, type Recipe } from '../../shared/recipes';

export type BookTab = 'all' | 'blocks' | 'tools' | 'combat' | 'redstone' | 'food' | 'materials';
export const BOOK_TABS: readonly { id: BookTab; label: string; icon: number }[] = [
  { id: 'all', label: 'All', icon: B.crafting_table }, { id: 'blocks', label: 'Blocks', icon: B.bricks }, { id: 'tools', label: 'Tools', icon: I.stone_pickaxe },
  { id: 'combat', label: 'Combat', icon: I.iron_sword }, { id: 'redstone', label: 'Redstone', icon: I.redstone }, { id: 'food', label: 'Food', icon: I.bread },
  { id: 'materials', label: 'Materials', icon: I.stick },
];
const TAB_OF: Record<ItemCategory, BookTab> = {
  building: 'blocks', decoration: 'blocks', nature: 'blocks', tools: 'tools', combat: 'combat', food: 'food', materials: 'materials', redstone: 'redstone', nether: 'blocks',
};

export type IngredientNeed = { ids: readonly number[]; n: number; have: number };
/** Ingredients grouped by kind with the amount the inventory holds (alternatives such as any planks are summed). */
export function ingredientSummary(recipe: Recipe, inv: readonly (Slot | null)[]): IngredientNeed[] {
  const groups = new Map<string, IngredientNeed>();
  for (const ingredient of ingredientsOf(recipe)) {
    const ids = typeof ingredient === 'number' ? [ingredient] : ingredient, key = ids.join(',');
    const group = groups.get(key);
    if (group) group.n++;
    else groups.set(key, { ids, n: 1, have: ids.reduce((sum, id) => sum + countItem(inv, id), 0) });
  }
  return [...groups.values()];
}
/** Label for an ingredient: "Oak Planks" or "Any Planks" for alternatives. */
export function ingredientLabel(ingredient: Ingredient): string {
  if (typeof ingredient === 'number') return itemName(ingredient);
  const words = ingredient.map(id => itemName(id).split(' ').at(-1)!), last = words[0]!;
  return words.every(word => word === last) ? `Any ${last}` : ingredient.map(itemName).join(' or ');
}
/** What is still missing, e.g. "2 × Cobblestone, a crafting table". Empty when craftable. */
export function missingText(recipe: Recipe, inv: readonly (Slot | null)[], nearTable: boolean): string {
  const parts = ingredientSummary(recipe, inv).filter(need => need.have < need.n).map(need => `${need.n - need.have} × ${ingredientLabel(need.ids.length === 1 ? need.ids[0]! : need.ids)}`);
  if (recipe.table && !nearTable) parts.push('a crafting table');
  return parts.join(', ');
}

export type BookEntry = { recipe: Recipe; craftable: boolean; needsTable: boolean };
export type BookFilter = { tab: BookTab; query: string; craftableOnly: boolean; nearTable: boolean };
/** Visible recipes: tab, search (output name, key or ingredient names) and craftable filter; craftable entries first, stable order otherwise. */
export function filterRecipes(inv: readonly (Slot | null)[], filter: BookFilter, recipes: readonly Recipe[] = RECIPES): BookEntry[] {
  const query = filter.query.trim().toLowerCase();
  const entries: BookEntry[] = [];
  for (const recipe of recipes) {
    const item = itemOf(recipe.out.id);
    if (!item || item.hidden) continue;
    if (filter.tab !== 'all' && TAB_OF[recipe.category] !== filter.tab) continue;
    if (query && !matches(recipe, query)) continue;
    const craftable = canCraft(inv, recipe, filter.nearTable);
    if (filter.craftableOnly && !craftable) continue;
    entries.push({ recipe, craftable, needsTable: recipe.table && !filter.nearTable });
  }
  return entries.sort((a, b) => Number(b.craftable) - Number(a.craftable));
}
function matches(recipe: Recipe, query: string): boolean {
  const out = itemOf(recipe.out.id)!;
  if (out.name.toLowerCase().includes(query) || out.key.includes(query.replace(/\s+/g, '_'))) return true;
  return ingredientsOf(recipe).some(ingredient => ingredientLabel(ingredient).toLowerCase().includes(query));
}
