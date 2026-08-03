// Ordering for the recipe list.
//
// Done here rather than in SQL for two reasons. The list endpoint has no
// LIMIT, so the browser already holds every recipe — sorting server-side would
// buy nothing and cost a round trip each time the order changes. And SQLite's
// only case-insensitive collation is NOCASE, which is ASCII-only: it files
// "Épinards" after "Zucchini". Intl.Collator knows French.
//
// Pure, so the tie-breaking and the null handling can be tested without a
// browser.

export type RecipeSort = "recent" | "title" | "time";

/** The options offered, in the order they appear in the menu. */
export const RECIPE_SORTS: { value: RecipeSort; label: string }[] = [
  { value: "recent", label: "Plus récentes" },
  { value: "title", label: "A → Z" },
  { value: "time", label: "Plus rapides" },
];

export const RECIPE_SORT_KEY = "recipe_sort";

/** Guards a remembered preference: localStorage can hold anything. */
export function isRecipeSort(value: unknown): value is RecipeSort {
  return RECIPE_SORTS.some((option) => option.value === value);
}

// Only the fields the ordering reads, so this doesn't drag in the whole
// Recipe type — and tests can build a recipe in one line.
export interface SortableRecipe {
  id: number;
  title: string;
  prep_time: number | null;
  cook_time: number | null;
  created_at: string;
}

/**
 * Prep plus cook, or null when the recipe gives neither. A recipe that lists
 * only one of the two is still worth ordering on what it does say.
 */
export function totalTime(recipe: SortableRecipe): number | null {
  if (recipe.prep_time == null && recipe.cook_time == null) return null;
  return (recipe.prep_time ?? 0) + (recipe.cook_time ?? 0);
}

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/** Returns a new array — React state must not be sorted in place. */
export function sortRecipes<T extends SortableRecipe>(recipes: T[], sort: RecipeSort): T[] {
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title);

  switch (sort) {
    case "title":
      return [...recipes].sort(byTitle);

    case "time":
      return [...recipes].sort((a, b) => {
        const left = totalTime(a);
        const right = totalTime(b);
        // "How long does this take" has no answer for a recipe with no times,
        // so those go last instead of leading the list as a zero would.
        if (left == null && right == null) return byTitle(a, b);
        if (left == null) return 1;
        if (right == null) return -1;
        return left - right || byTitle(a, b);
      });

    case "recent":
    default:
      // created_at is SQLite's "YYYY-MM-DD HH:MM:SS", which compares
      // correctly as text. Recipes saved within the same second fall back to
      // id, so the order is stable rather than left to the input.
      return [...recipes].sort(
        (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id
      );
  }
}
