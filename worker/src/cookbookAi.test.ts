// The prompt building, the mapping, and the costing are pure — no network and
// no API key. The call itself isn't tested here; what matters is that what
// goes in is right and what comes back is mapped faithfully.

import { describe, expect, it } from "vitest";
import {
  AISLE_CATEGORIES,
  buildExtractionPrompt,
  describeApiError,
  estimateCost,
  toImportedRecipe,
  type ExtractedRecipe,
} from "./cookbookAi";

const recipe = (over: Partial<ExtractedRecipe> = {}): ExtractedRecipe => ({
  title: "Kalefornia Bowl",
  description: null,
  servings: null,
  prep_time: null,
  cook_time: null,
  ingredients: [],
  steps: [],
  tags: [],
  ...over,
});

describe("buildExtractionPrompt", () => {
  it("gives the model the titles the contents promised for this page", () => {
    // This is what keeps a page of eight recipes from coming back as three.
    const prompt = buildExtractionPrompt("du texte", [
      "Teriyaki Marinade",
      "BBQ Marinade",
    ]);
    expect(prompt).toContain("Teriyaki Marinade");
    expect(prompt).toContain("BBQ Marinade");
    expect(prompt).toContain("du texte");
  });

  it("omits the expected-titles section when the index has nothing to offer", () => {
    const prompt = buildExtractionPrompt("du texte", []);
    expect(prompt).not.toContain("table of contents");
    expect(prompt).toContain("du texte");
  });

  it("is written in English, so it doesn't nudge an English book into French", () => {
    // A French prompt around English book text is what made the model
    // translate a whole cookbook, against an explicit rule not to.
    const prompt = buildExtractionPrompt("page text", ["Budapest Bowl"]);
    expect(prompt).not.toMatch(/D'après|Voici|Rends une entrée/);
    expect(prompt).toContain("table of contents");
  });
});

describe("toImportedRecipe", () => {
  it("maps an extracted recipe onto the app's existing import shape", () => {
    const mapped = toImportedRecipe(
      recipe({
        servings: 4,
        prep_time: 20,
        ingredients: [
          { name: "chou kale", quantity: 200, unit: "g", aisle_category: "Fruits et légumes" },
        ],
        steps: ["Mélanger."],
        tags: ["Salades"],
      })
    );
    expect(mapped).toEqual({
      title: "Kalefornia Bowl",
      description: undefined,
      servings: 4,
      prep_time: 20,
      cook_time: undefined,
      ingredients: [
        { name: "chou kale", quantity: 200, unit: "g", aisle_category: "Fruits et légumes" },
      ],
      steps: ["Mélanger."],
      tags: ["Salades"],
      source: "pdf",
    });
  });

  it("turns nulls into absent fields rather than passing null through", () => {
    const mapped = toImportedRecipe(
      recipe({ ingredients: [{ name: "sel", quantity: null, unit: null, aisle_category: null }] })
    );
    expect(mapped.ingredients[0]).toEqual({
      name: "sel",
      quantity: undefined,
      unit: undefined,
      aisle_category: undefined,
    });
  });

  it("drops blank ingredients, steps and tags", () => {
    const mapped = toImportedRecipe(
      recipe({
        ingredients: [
          { name: "  ", quantity: null, unit: null, aisle_category: null },
          { name: " sel ", quantity: null, unit: null, aisle_category: null },
        ],
        steps: ["", "  ", "Mélanger."],
        tags: ["", "Salades"],
      })
    );
    // And trims what it keeps.
    expect(mapped.ingredients).toEqual([
      { name: "sel", quantity: undefined, unit: undefined, aisle_category: undefined },
    ]);
    expect(mapped.steps).toEqual(["Mélanger."]);
    expect(mapped.tags).toEqual(["Salades"]);
  });
});

describe("AISLE_CATEGORIES", () => {
  it("matches the aisles seeded in schema.sql", () => {
    // The model picks from this list, so a drift from the database would
    // produce categories no grocery list can group by.
    expect(AISLE_CATEGORIES).toHaveLength(17);
    expect(AISLE_CATEGORIES[0]).toBe("Fruits et légumes");
    expect(AISLE_CATEGORIES[AISLE_CATEGORIES.length - 1]).toBe("Autres / Non classé");
  });
});

describe("estimateCost", () => {
  it("prices a page at Sonnet 5's published rates", () => {
    // $2 per Mtok in, $10 per Mtok out.
    expect(estimateCost({ input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(2);
    expect(estimateCost({ input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(10);
  });

  it("gives a realistic page a fraction of a cent", () => {
    const cost = estimateCost({ input_tokens: 1200, output_tokens: 1500 });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.03);
  });

  it("costs nothing when nothing was spent", () => {
    expect(estimateCost({ input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
});

describe("describeApiError", () => {
  it("names the remedy for an empty balance, and rules out the subscription", () => {
    // The one people hit first, and the one where "buy credits" is not
    // obvious — a Claude Pro subscription does not cover API usage.
    const message = describeApiError(
      new Error('400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}')
    );
    expect(message).toMatch(/crédits/i);
    expect(message).toMatch(/Pro/);
    expect(message).not.toMatch(/\{/);
  });

  it("points at the key when the key is refused", () => {
    expect(describeApiError(new Error('401 {"error":{"type":"authentication_error"}}'))).toMatch(
      /ANTHROPIC_API_KEY/
    );
  });

  it("says an interrupted import can simply be resumed", () => {
    const message = describeApiError(new Error('429 rate_limit_error'));
    expect(message).toMatch(/refactur/i);
  });

  it("keeps an unrecognised message rather than swallowing it", () => {
    expect(describeApiError(new Error("something unexpected"))).toContain(
      "something unexpected"
    );
  });

  it("survives a thrown non-Error", () => {
    expect(describeApiError("plain string")).toContain("plain string");
  });
});
