import { describe, expect, it } from "vitest";
import { isRecipeSort, sortRecipes, totalTime, SortableRecipe } from "./recipeSort";

let nextId = 1;
function recipe(
  title: string,
  { prep = null, cook = null, created = "2026-01-01 12:00:00" }: {
    prep?: number | null;
    cook?: number | null;
    created?: string;
  } = {}
): SortableRecipe {
  return { id: nextId++, title, prep_time: prep, cook_time: cook, created_at: created };
}

const titlesOf = (recipes: SortableRecipe[]) => recipes.map((r) => r.title);

describe("sortRecipes", () => {
  it("puts the newest first by default", () => {
    const list = [
      recipe("Vieille", { created: "2026-01-01 09:00:00" }),
      recipe("Récente", { created: "2026-03-01 09:00:00" }),
      recipe("Moyenne", { created: "2026-02-01 09:00:00" }),
    ];
    expect(titlesOf(sortRecipes(list, "recent"))).toEqual(["Récente", "Moyenne", "Vieille"]);
  });

  it("breaks a same-second tie on id rather than leaving it to chance", () => {
    const a = recipe("A");
    const b = recipe("B");
    expect(sortRecipes([a, b], "recent").map((r) => r.id)).toEqual([b.id, a.id]);
  });

  // SQLite's NOCASE is ASCII-only and would file this after "Zucchini".
  it("files an accented title where a French reader expects it", () => {
    const list = [recipe("Zucchini"), recipe("Épinards"), recipe("Avocat")];
    expect(titlesOf(sortRecipes(list, "title"))).toEqual(["Avocat", "Épinards", "Zucchini"]);
  });

  it("ignores case when sorting by title", () => {
    const list = [recipe("banane"), recipe("Abricot"), recipe("cerise")];
    expect(titlesOf(sortRecipes(list, "title"))).toEqual(["Abricot", "banane", "cerise"]);
  });

  it("orders by prep plus cook", () => {
    const list = [
      recipe("Longue", { prep: 20, cook: 60 }),
      recipe("Courte", { prep: 5, cook: 10 }),
      recipe("Moyenne", { prep: 15, cook: 15 }),
    ];
    expect(titlesOf(sortRecipes(list, "time"))).toEqual(["Courte", "Moyenne", "Longue"]);
  });

  it("counts the time a recipe does give when it gives only one", () => {
    const list = [recipe("Cuisson seule", { cook: 40 }), recipe("Prép seule", { prep: 10 })];
    expect(titlesOf(sortRecipes(list, "time"))).toEqual(["Prép seule", "Cuisson seule"]);
  });

  // A missing time is unknown, not zero: sorted as zero these would claim to
  // be the quickest recipes in the list.
  it("sends recipes with no time at all to the end", () => {
    const list = [
      recipe("Sans temps"),
      recipe("Rapide", { prep: 5 }),
      recipe("Sans temps non plus"),
      recipe("Lente", { cook: 90 }),
    ];
    expect(titlesOf(sortRecipes(list, "time"))).toEqual([
      "Rapide",
      "Lente",
      "Sans temps",
      "Sans temps non plus",
    ]);
  });

  it("breaks an equal-time tie on the title", () => {
    const list = [recipe("Bravo", { prep: 10 }), recipe("Alpha", { cook: 10 })];
    expect(titlesOf(sortRecipes(list, "time"))).toEqual(["Alpha", "Bravo"]);
  });

  it("does not sort the array it was given", () => {
    const list = [recipe("B"), recipe("A")];
    const before = titlesOf(list);
    sortRecipes(list, "title");
    expect(titlesOf(list)).toEqual(before);
  });

  it("survives an empty list", () => {
    expect(sortRecipes([], "title")).toEqual([]);
  });
});

describe("totalTime", () => {
  it("adds the two times, treating a missing one as nothing to add", () => {
    expect(totalTime(recipe("x", { prep: 10, cook: 20 }))).toBe(30);
    expect(totalTime(recipe("x", { prep: 10 }))).toBe(10);
    expect(totalTime(recipe("x"))).toBeNull();
  });
});

describe("isRecipeSort", () => {
  // localStorage can hold anything, including a value from an older build.
  it("rejects whatever else localStorage might be holding", () => {
    expect(isRecipeSort("title")).toBe(true);
    expect(isRecipeSort("alphabetique")).toBe(false);
    expect(isRecipeSort(null)).toBe(false);
  });
});
