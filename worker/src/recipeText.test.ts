import { describe, expect, it } from "vitest";
import { parseRecipeText } from "./recipeText";
import { parseLeadingQuantity, splitIngredientLine } from "./recipeImport";

// splitIngredientLine and parseLeadingQuantity had no tests at all, and the
// PDF importer just gave them a second caller. Pin the behaviour now rather
// than discover it from a regression.
describe("parseLeadingQuantity", () => {
  it("reads the shapes recipes actually use", () => {
    expect(parseLeadingQuantity("2 cups")?.value).toBe(2);
    expect(parseLeadingQuantity("2.5 cups")?.value).toBe(2.5);
    expect(parseLeadingQuantity("2,5 tasses")?.value).toBe(2.5);
    expect(parseLeadingQuantity("3/4 cup")?.value).toBeCloseTo(0.75);
    expect(parseLeadingQuantity("1 1/2 cups")?.value).toBeCloseTo(1.5);
    expect(parseLeadingQuantity("1 and 3/4 cups")?.value).toBeCloseTo(1.75);
    expect(parseLeadingQuantity("½ tasse")?.value).toBeCloseTo(0.5);
    expect(parseLeadingQuantity("1½ tasse")?.value).toBeCloseTo(1.5);
  });

  it("keeps only the first number of a range", () => {
    expect(parseLeadingQuantity("2-3 oignons")?.value).toBe(2);
    expect(parseLeadingQuantity("2 à 3 oignons")?.value).toBe(2);
  });

  // Anchored attempts, most specific first, so the "3" of "3/4" can't win
  // over the fraction.
  it("prefers the fraction over its leading digit", () => {
    const parsed = parseLeadingQuantity("3/4 cup");
    expect(parsed?.consumed).toBe(3);
  });

  it("returns nothing when there is no leading quantity", () => {
    expect(parseLeadingQuantity("sel et poivre")).toBeUndefined();
  });
});

describe("splitIngredientLine", () => {
  it("splits quantity, unit and name", () => {
    expect(splitIngredientLine("1 1/2 cups flour")).toEqual({
      name: "flour",
      quantity: 1.5,
      unit: "cups",
    });
  });

  it("handles multi-word French units", () => {
    expect(splitIngredientLine("2 c. à soupe de poudre de chili")).toEqual({
      name: "poudre de chili",
      quantity: 2,
      unit: "c. à soupe",
    });
  });

  it("keeps a line with no quantity intact", () => {
    expect(splitIngredientLine("Sel et poivre")).toEqual({ name: "Sel et poivre" });
  });

  it("moves measurement debris into a parenthetical rather than dropping it", () => {
    expect(splitIngredientLine("1 boîte de 796 ml (28 oz) de tomates broyées")).toEqual({
      name: "tomates broyées (796 ml; 28 oz)",
      quantity: 1,
      unit: "boîte",
    });
  });
});

describe("parseRecipeText", () => {
  const french = `
# Chili au macaroni

Portions : 6
Préparation : 20 minutes
Cuisson : 25 minutes

Ingrédients

- 1 lb de dindon haché
- 1 oignon moyen, coupé en dés
- 2 c. à soupe de poudre de chili
- 540 ml de haricots rouges en conserve
- Sel et poivre

Préparation

1. Faire revenir le dindon dans une grande casserole.
2. Ajouter l'oignon et la poudre de chili, puis cuire 5 minutes.
3. Incorporer les haricots et laisser mijoter 15 minutes.

Notes

Se congèle très bien en portions individuelles.
`;

  it("pulls a French recipe apart at its headings", () => {
    const recipe = parseRecipeText(french);
    expect(recipe.title).toBe("Chili au macaroni");
    expect(recipe.servings).toBe(6);
    expect(recipe.prep_time).toBe(20);
    expect(recipe.cook_time).toBe(25);
    expect(recipe.ingredients).toHaveLength(5);
    expect(recipe.steps).toHaveLength(3);
    expect(recipe.source).toBe("pdf");
    expect(recipe.warning).toBeUndefined();
  });

  it("parses quantities out of the ingredient lines", () => {
    const recipe = parseRecipeText(french);
    expect(recipe.ingredients[0]).toEqual({
      name: "dindon haché",
      quantity: 1,
      unit: "lb",
    });
    expect(recipe.ingredients[2]).toEqual({
      name: "poudre de chili",
      quantity: 2,
      unit: "c. à soupe",
    });
    expect(recipe.ingredients[4]).toEqual({ name: "Sel et poivre" });
  });

  it("stops at a trailing Notes section", () => {
    const recipe = parseRecipeText(french);
    expect(recipe.steps.join(" ")).not.toContain("congèle");
  });

  it("strips the numbering from steps", () => {
    const recipe = parseRecipeText(french);
    expect(recipe.steps[0]).toBe("Faire revenir le dindon dans une grande casserole.");
  });

  const english = `
Black Forest Cake

Yield: 12 servings
Prep Time: 30 minutes
Cook Time: 35 minutes

INGREDIENTS

1 3/4 cups all-purpose flour
2 large eggs
1/2 cup vegetable oil
1 cup heavy cream

DIRECTIONS

1. Preheat the oven to 350°F.
2. Whisk the flour and eggs together until smooth.
`;

  it("handles an English recipe with uppercase headings", () => {
    const recipe = parseRecipeText(english);
    expect(recipe.title).toBe("Black Forest Cake");
    expect(recipe.servings).toBe(12);
    expect(recipe.prep_time).toBe(30);
    expect(recipe.cook_time).toBe(35);
    expect(recipe.ingredients).toHaveLength(4);
    expect(recipe.ingredients[0]).toEqual({
      name: "all-purpose flour",
      quantity: 1.75,
      unit: "cups",
    });
    expect(recipe.steps).toHaveLength(2);
  });

  it("rejoins a step the document wrapped mid-sentence", () => {
    const wrapped = `Ingrédients

- 2 oeufs

Préparation

1. Battre les oeufs dans un grand bol jusqu'à ce que le mélange
   soit pâle et mousseux, environ 4 minutes.
2. Verser dans le moule.
`;
    const recipe = parseRecipeText(wrapped);
    expect(recipe.steps).toHaveLength(2);
    expect(recipe.steps[0]).toBe(
      "Battre les oeufs dans un grand bol jusqu'à ce que le mélange soit pâle et mousseux, environ 4 minutes."
    );
  });

  it("falls back to line shape when there are no headings, and says so", () => {
    const headingless = `Salade de quinoa

1 tasse de quinoa
2 tomates
Rincer le quinoa et le cuire dans deux fois son volume d'eau salée.
Couper les tomates en dés et mélanger le tout.
`;
    const recipe = parseRecipeText(headingless);
    expect(recipe.title).toBe("Salade de quinoa");
    expect(recipe.ingredients.map((i) => i.name)).toEqual(["quinoa", "tomates"]);
    expect(recipe.steps).toHaveLength(2);
    expect(recipe.warning).toMatch(/approximatif/);
  });

  it("warns rather than returning a confident empty recipe", () => {
    const recipe = parseRecipeText("Une page sans rien d'utile.");
    expect(recipe.ingredients).toHaveLength(0);
    expect(recipe.steps).toHaveLength(0);
    expect(recipe.warning).toMatch(/Aucun ingrédient/);
    expect(recipe.warning).toMatch(/Aucune étape/);
  });

  it("drops page furniture and running headers", () => {
    const withFurniture = `Ma Recette
monsite.com
1
Ingrédients
monsite.com
- 2 oeufs
2
monsite.com
Préparation
1. Battre les oeufs.
3
`;
    const recipe = parseRecipeText(withFurniture);
    expect(recipe.ingredients).toHaveLength(1);
    expect(recipe.steps).toEqual(["Battre les oeufs."]);
  });

  // "Préparation : 20 minutes" in the header band is metadata; the bare
  // "Préparation" heading further down is what opens the steps.
  it("does not mistake a timing line for the steps heading", () => {
    const recipe = parseRecipeText(french);
    expect(recipe.steps[0]).not.toMatch(/20 minutes/);
  });

  // A printed recipe often puts the whole header band on one line. Reading to
  // the end of the line gave prep and cook the same value — the sum of both.
  it("keeps times apart when several labels share a line", () => {
    const recipe = parseRecipeText(
      "Tarte aux pommes\nPortions : 6 Préparation : 20 minutes Cuisson : 25 minutes\n"
    );
    expect(recipe.servings).toBe(6);
    expect(recipe.prep_time).toBe(20);
    expect(recipe.cook_time).toBe(25);
  });

  it("still adds up the parts of a single duration", () => {
    const recipe = parseRecipeText("Cuisson : 1 h 30\n");
    expect(recipe.cook_time).toBe(90);
  });

  // The bare-minutes shortcut used to fire here too, taking the "3" of "30"
  // and reading 1 hour 3 minutes.
  it("reads hours and minutes when both carry a unit", () => {
    expect(parseRecipeText("Cuisson : 1 hour 30 mins\n").cook_time).toBe(90);
    expect(parseRecipeText("Cuisson : 1h 30m\n").cook_time).toBe(90);
  });

  // A recipe printed from a website lays its header out as a table, so each
  // value lands on the line below its label rather than beside it.
  const printedFromWeb = `Poke Bowl
URL
https://cooking.nytimes.com/recipes/1024634-poke-bowl
Preperation Time
15m
Cook Time
1h 30m
Total Time
1h 45m
Servings
4 servings
Ingredients
For the Poke:
1/4 cup soy sauce, plus more as needed
Crushed red pepper, to taste (optional)
For the Rice:
1 1/2 cups sushi or Calrose rice
Steps
Prepare the rice: rinse it until the water runs clear, cook it and let stand,
covered, for 10 minutes. (Alternatively, use a rice cooker.)
Set up a poke bowl bar with the poke, rice and toppings of choice.
`;

  it("reads a header band whose values sit under their labels", () => {
    const recipe = parseRecipeText(printedFromWeb);
    expect(recipe.title).toBe("Poke Bowl");
    expect(recipe.servings).toBe(4);
    expect(recipe.prep_time).toBe(15);
    expect(recipe.cook_time).toBe(90);
  });

  // "Total Time" sits between "Cook Time" and its own value in this layout;
  // reading past the first value would give cook_time the total.
  it("does not let a later label claim an earlier one's value", () => {
    expect(parseRecipeText(printedFromWeb).cook_time).not.toBe(105);
  });

  it("keeps the source URL the document prints", () => {
    expect(parseRecipeText(printedFromWeb).source_url).toBe(
      "https://cooking.nytimes.com/recipes/1024634-poke-bowl"
    );
  });

  // Ingredients are a flat list, so a group label kept as an ingredient turns
  // into a quantity-less row that follows the recipe onto a grocery list.
  it("drops the labels that divide an ingredient list into groups", () => {
    const names = parseRecipeText(printedFromWeb).ingredients.map((i) => i.name);
    expect(names).toEqual([
      "soy sauce, plus more as needed",
      "Crushed red pepper, to taste (optional)",
      "sushi or Calrose rice",
    ]);
  });

  // A step ending "...rice cooker.)" reads as unfinished unless the closing
  // bracket is allowed after the full stop — and every step after it was
  // being appended to it.
  it("ends a step that closes a bracket after its full stop", () => {
    const steps = parseRecipeText(printedFromWeb).steps;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatch(/rice cooker\.\)$/);
    expect(steps[1]).toBe("Set up a poke bowl bar with the poke, rice and toppings of choice.");
  });

  it("survives empty input", () => {
    const recipe = parseRecipeText("");
    expect(recipe.title).toBe("Recette importée");
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.steps).toEqual([]);
  });
});
