// Ordering for the cookbook catalogue and for the recipes inside one book.
//
// Same shape and the same reasoning as recipeSort.ts: the list endpoints have
// no LIMIT so the browser already holds everything, and SQLite's only
// case-insensitive collation is ASCII-only — it files "Élégance" after
// "Zucchini". Intl.Collator knows French.
//
// Pure, so the tie-breaking and the null handling can be tested without a
// browser.

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

// --- The shelf: how the books themselves are ordered ------------------------

export type CookbookSort = "recent" | "title" | "author";

export const COOKBOOK_SORTS: { value: CookbookSort; label: string }[] = [
  { value: "recent", label: "Plus récents" },
  { value: "title", label: "A → Z" },
  { value: "author", label: "Par auteur" },
];

export const COOKBOOK_SORT_KEY = "cookbook_sort";

export function isCookbookSort(value: unknown): value is CookbookSort {
  return COOKBOOK_SORTS.some((option) => option.value === value);
}

export interface SortableCookbook {
  id: number;
  title: string;
  author: string | null;
  created_at: string;
}

export function sortCookbooks<T extends SortableCookbook>(
  cookbooks: T[],
  sort: CookbookSort
): T[] {
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title);

  switch (sort) {
    case "title":
      return [...cookbooks].sort(byTitle);

    case "author":
      return [...cookbooks].sort((a, b) => {
        // "Whose book is this" has no answer for a book with no author
        // recorded, so those go last rather than leading the shelf under an
        // empty heading. Within one author, order by title.
        if (!a.author && !b.author) return byTitle(a, b);
        if (!a.author) return 1;
        if (!b.author) return -1;
        return collator.compare(a.author, b.author) || byTitle(a, b);
      });

    case "recent":
    default:
      // created_at is SQLite's "YYYY-MM-DD HH:MM:SS", which compares
      // correctly as text. Books added within the same second fall back to
      // id, so the order is stable rather than left to the input.
      return [...cookbooks].sort(
        (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id
      );
  }
}

// --- Inside one book: how its recipes are ordered ---------------------------

export type CookbookRecipeSort = "page" | "title";

export const COOKBOOK_RECIPE_SORTS: { value: CookbookRecipeSort; label: string }[] = [
  { value: "page", label: "Par page" },
  { value: "title", label: "A → Z" },
];

export const COOKBOOK_RECIPE_SORT_KEY = "cookbook_recipe_sort";

export function isCookbookRecipeSort(value: unknown): value is CookbookRecipeSort {
  return COOKBOOK_RECIPE_SORTS.some((option) => option.value === value);
}

export interface SortableCookbookRecipe {
  id: number;
  title: string;
  cookbook_page: number | null;
}

export function sortCookbookRecipes<T extends SortableCookbookRecipe>(
  recipes: T[],
  sort: CookbookRecipeSort
): T[] {
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title);

  if (sort === "title") return [...recipes].sort(byTitle);

  // By page. A recipe with no page number — added by hand, or from a book
  // with no page structure such as an EPUB — can't be placed in the book's
  // running order, so it goes after everything that can, ordered by title.
  return [...recipes].sort((a, b) => {
    if (a.cookbook_page == null && b.cookbook_page == null) return byTitle(a, b);
    if (a.cookbook_page == null) return 1;
    if (b.cookbook_page == null) return -1;
    return a.cookbook_page - b.cookbook_page || byTitle(a, b);
  });
}
