// Pure ordering logic — no DOM, no API. The cases that matter are the ones
// SQLite would get wrong (accents) and the ones a naive comparator would get
// wrong (missing author, missing page number).

import { describe, expect, it } from "vitest";
import {
  isCookbookRecipeSort,
  isCookbookSort,
  sortCookbookRecipes,
  sortCookbooks,
  type SortableCookbook,
  type SortableCookbookRecipe,
} from "./cookbookSort";

const book = (
  id: number,
  title: string,
  author: string | null = null,
  created_at = "2026-01-01 00:00:00"
): SortableCookbook => ({ id, title, author, created_at });

const recipe = (
  id: number,
  title: string,
  cookbook_page: number | null
): SortableCookbookRecipe => ({ id, title, cookbook_page });

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe("sortCookbooks", () => {
  it("files accented titles where French expects, not where ASCII would", () => {
    const shelf = [book(1, "Zucchini"), book(2, "Élégance"), book(3, "Avocat")];
    // NOCASE would put "Élégance" last, after "Zucchini".
    expect(titles(sortCookbooks(shelf, "title"))).toEqual([
      "Avocat",
      "Élégance",
      "Zucchini",
    ]);
  });

  it("orders by author, then by title within one author", () => {
    const shelf = [
      book(1, "Plats du soir", "Ottolenghi"),
      book(2, "Desserts", "Ottolenghi"),
      book(3, "Bowls", "Franzen"),
    ];
    expect(titles(sortCookbooks(shelf, "author"))).toEqual([
      "Bowls",
      "Desserts",
      "Plats du soir",
    ]);
  });

  it("puts books with no author last rather than first", () => {
    const shelf = [book(1, "Anonyme", null), book(2, "Bowls", "Franzen")];
    expect(titles(sortCookbooks(shelf, "author"))).toEqual(["Bowls", "Anonyme"]);
  });

  it("falls back to title when neither book has an author", () => {
    const shelf = [book(1, "Zeste", null), book(2, "Amande", null)];
    expect(titles(sortCookbooks(shelf, "author"))).toEqual(["Amande", "Zeste"]);
  });

  it("puts the most recently added first, breaking ties by id", () => {
    const shelf = [
      book(1, "Premier", null, "2026-01-01 10:00:00"),
      book(2, "Même seconde", null, "2026-02-01 10:00:00"),
      book(3, "Aussi", null, "2026-02-01 10:00:00"),
    ];
    expect(titles(sortCookbooks(shelf, "recent"))).toEqual([
      "Aussi",
      "Même seconde",
      "Premier",
    ]);
  });

  it("returns a new array — React state must not be sorted in place", () => {
    const shelf = [book(2, "B"), book(1, "A")];
    const sorted = sortCookbooks(shelf, "title");
    expect(sorted).not.toBe(shelf);
    expect(titles(shelf)).toEqual(["B", "A"]);
  });
});

describe("sortCookbookRecipes", () => {
  it("follows the book's running order by page", () => {
    const recipes = [recipe(1, "Dernier", 149), recipe(2, "Premier", 12), recipe(3, "Milieu", 87)];
    expect(titles(sortCookbookRecipes(recipes, "page"))).toEqual([
      "Premier",
      "Milieu",
      "Dernier",
    ]);
  });

  it("orders several recipes sharing one page by title", () => {
    const recipes = [
      recipe(1, "Marinade teriyaki", 31),
      recipe(2, "Marinade BBQ", 31),
      recipe(3, "Tofu grillé", 30),
    ];
    expect(titles(sortCookbookRecipes(recipes, "page"))).toEqual([
      "Tofu grillé",
      "Marinade BBQ",
      "Marinade teriyaki",
    ]);
  });

  it("puts page-less recipes after the ones that have a page", () => {
    const recipes = [recipe(1, "Ajoutée à la main", null), recipe(2, "Page 5", 5)];
    expect(titles(sortCookbookRecipes(recipes, "page"))).toEqual([
      "Page 5",
      "Ajoutée à la main",
    ]);
  });

  it("ignores the page number entirely when sorting by title", () => {
    const recipes = [recipe(1, "Zeste", 1), recipe(2, "Épinards", 99), recipe(3, "Avocat", 50)];
    expect(titles(sortCookbookRecipes(recipes, "title"))).toEqual([
      "Avocat",
      "Épinards",
      "Zeste",
    ]);
  });
});

describe("preference guards", () => {
  it("rejects anything localStorage might be holding", () => {
    expect(isCookbookSort("title")).toBe(true);
    expect(isCookbookSort("page")).toBe(false);
    expect(isCookbookSort(null)).toBe(false);
    expect(isCookbookRecipeSort("page")).toBe(true);
    expect(isCookbookRecipeSort("author")).toBe(false);
    expect(isCookbookRecipeSort(undefined)).toBe(false);
  });
});
