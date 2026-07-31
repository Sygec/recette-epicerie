// Pins the behaviour of the food-matching and unit-merging logic.
//
// This mattered less while the dictionary was a hand-edited seed in
// schema.sql. Now that it is editable at runtime (see /api/foods), a user can
// add an alias that changes how every other item matches — so the rules these
// tests describe are the contract the dictionary manager is built on top of.
//
// Everything under test here is pure; no D1 involved (loadAliasRows is the
// only DB-touching export and is not covered).

import { describe, expect, it } from "vitest";
import {
  canonicalUnit,
  convertForMerge,
  findMergeTarget,
  matchFood,
  normalizeFoodIdentity,
  unitsMatch,
  updateNameConversionNote,
} from "./foodDictionary";

// A small stand-in for the seeded dictionary, using the real ids/categories
// for the entries the tests care about.
const SUCRE = { alias: "sucre", food_id: 50, category_id: 9 };
const SUGAR = { alias: "sugar", food_id: 50, category_id: 9 };
const CREME = { alias: "crème", food_id: 20, category_id: 4 };
const CREME_SURE = { alias: "crème sure", food_id: 21, category_id: 4 };
const SEL = { alias: "sel", food_id: 60, category_id: 9 };
const THE = { alias: "thé", food_id: 70, category_id: 13 };
const OIGNON = { alias: "oignon", food_id: 1, category_id: 1 };
const ONION = { alias: "onion", food_id: 1, category_id: 1 };

const ALIASES = [SUCRE, SUGAR, CREME, CREME_SURE, SEL, THE, OIGNON, ONION];

describe("normalizeFoodIdentity", () => {
  it("folds case, accents and repeated whitespace", () => {
    expect(normalizeFoodIdentity("  Bœuf   HACHÉ ")).toBe("bœuf hache");
    expect(normalizeFoodIdentity("Crème Sure")).toBe("creme sure");
  });
});

describe("matchFood", () => {
  it("matches a plain name", () => {
    expect(matchFood("sucre", ALIASES)).toEqual({ food_id: 50, category_id: 9 });
  });

  it("matches across languages to the same food", () => {
    expect(matchFood("onion", ALIASES)?.food_id).toBe(1);
    expect(matchFood("oignon", ALIASES)?.food_id).toBe(1);
  });

  // There is no plural folding for food names (unlike units, see
  // canonicalUnit) — the word-boundary check treats the trailing "s" as part
  // of the word, so "onions" does not match the alias "onion". This is why
  // the seed in schema.sql lists plural forms as their own aliases, and why
  // the dictionary manager prompts for them when a food is created.
  it("does not fold plurals — each form needs its own alias", () => {
    expect(matchFood("onions", ALIASES)).toBeNull();
    expect(matchFood("onions", [...ALIASES, { alias: "onions", food_id: 1, category_id: 1 }])
      ?.food_id).toBe(1);
  });

  it("is accent-insensitive", () => {
    expect(matchFood("creme sure", ALIASES)?.food_id).toBe(21);
  });

  it("only matches on word boundaries", () => {
    // "sel" must not be found inside "conseil".
    expect(matchFood("conseil", ALIASES)).toBeNull();
  });

  it("prefers the longest matching alias", () => {
    // The whole reason matching is containment-based: a recipe line carries
    // preparation notes around the ingredient name, and the more specific
    // compound alias has to win over the shorter one it contains.
    const match = matchFood("1 tasse de crème sure, à température ambiante", ALIASES);
    expect(match?.food_id).toBe(21);
  });

  it("does not treat a French teaspoon idiom as the beverage", () => {
    expect(matchFood("coriandre moulue (2 c. à thé)", ALIASES)).toBeNull();
    expect(matchFood("thé vert", ALIASES)?.food_id).toBe(70);
  });

  it("returns null when nothing matches", () => {
    expect(matchFood("quinoa", ALIASES)).toBeNull();
  });

  // The behaviour behind the "sucre en poudre" report: containment matching
  // has no notion of a modifier that makes something a different product, so
  // an unqualified alias swallows its own compounds. The fix is to give the
  // compound its own dictionary entry — which is exactly what the next test
  // covers — not to change the matching rule.
  it("collapses a compound into its base food when no specific alias exists", () => {
    expect(matchFood("sucre en poudre", ALIASES)?.food_id).toBe(50);
  });

  it("keeps a compound distinct once it has its own alias", () => {
    const withCompound = [
      ...ALIASES,
      { alias: "sucre en poudre", food_id: 81, category_id: 9 },
    ];
    expect(matchFood("sucre en poudre", withCompound)?.food_id).toBe(81);
    expect(matchFood("sucre", withCompound)?.food_id).toBe(50);
  });
});

describe("canonicalUnit / unitsMatch", () => {
  it("treats cross-language synonyms as the same unit", () => {
    expect(unitsMatch("tasse", "cup")).toBe(true);
    expect(unitsMatch("boîte", "can")).toBe(true);
    expect(unitsMatch("pincee", "pinch")).toBe(true);
  });

  it("folds plurals", () => {
    expect(unitsMatch("tablespoon", "tablespoons")).toBe(true);
    expect(canonicalUnit("grams")).toBe("gram");
  });

  // The plural fold is guarded by length so short units aren't mangled
  // ("oz" must not become "o"). "lbs" is three characters and so survives the
  // guard intact; WEIGHT_TO_G carries both "lb" and "lbs" for that reason.
  it("leaves short units alone rather than mangling them", () => {
    expect(canonicalUnit("oz")).toBe("oz");
    expect(canonicalUnit("lbs")).toBe("lbs");
    expect(convertForMerge(1, "lbs", "g")).toBeCloseTo(453.592);
  });

  it("treats two missing units as matching, but not one", () => {
    expect(unitsMatch(null, null)).toBe(true);
    expect(unitsMatch(null, "g")).toBe(false);
  });
});

describe("convertForMerge", () => {
  it("converts within the volume dimension", () => {
    expect(convertForMerge(45, "ml", "c. à soupe")).toBeCloseTo(3);
    expect(convertForMerge(1, "tasse", "ml")).toBe(240);
  });

  it("converts within the weight dimension", () => {
    expect(convertForMerge(1, "kg", "g")).toBe(1000);
  });

  it("never crosses dimensions", () => {
    expect(convertForMerge(1, "tasse", "g")).toBeUndefined();
  });

  it("gives up on unrecognized units rather than guessing", () => {
    expect(convertForMerge(2, "gousse", "g")).toBeUndefined();
  });
});

describe("findMergeTarget", () => {
  it("prefers an exact unit match over a conversion", () => {
    const rows = [
      { id: 1, quantity: 3, unit: "tablespoon" },
      { id: 2, quantity: 45, unit: "ml" },
    ];
    const target = findMergeTarget(rows, 45, "ml");
    expect(target?.row.id).toBe(2);
    expect(target?.mergedQuantity).toBe(90);
  });

  it("falls back to conversion when no unit matches exactly", () => {
    const rows = [{ id: 1, quantity: 3, unit: "tablespoon" }];
    const target = findMergeTarget(rows, 15, "ml");
    expect(target?.row.id).toBe(1);
    expect(target?.mergedQuantity).toBe(4);
  });

  it("merges two unitless rows", () => {
    const rows = [{ id: 1, quantity: 2, unit: null }];
    expect(findMergeTarget(rows, 3, null)?.mergedQuantity).toBe(5);
  });

  it("keeps incompatible units as separate lines", () => {
    const rows = [{ id: 1, quantity: 200, unit: "g" }];
    expect(findMergeTarget(rows, 1, "tasse")).toBeUndefined();
  });

  it("returns no target when there are no candidates", () => {
    expect(findMergeTarget([], 1, "g")).toBeUndefined();
  });
});

describe("updateNameConversionNote", () => {
  it("recomputes a stale conversion note against the new quantity", () => {
    expect(updateNameConversionNote("poudre de chili (1/4 tasse)", "ml", 120)).toBe(
      "poudre de chili (0.5 tasse)"
    );
  });

  it("leaves free-text parentheticals alone", () => {
    expect(updateNameConversionNote("noix (ou pacanes)", "g", 100)).toBe(
      "noix (ou pacanes)"
    );
  });

  it("leaves multi-part notes alone", () => {
    expect(updateNameConversionNote("beurre (8 Tbsp; 113g)", "g", 226)).toBe(
      "beurre (8 Tbsp; 113g)"
    );
  });

  it("leaves the name untouched with no unit or quantity to work from", () => {
    expect(updateNameConversionNote("sucre (1 tasse)", null, 2)).toBe("sucre (1 tasse)");
    expect(updateNameConversionNote("sucre (1 tasse)", "ml", null)).toBe("sucre (1 tasse)");
  });
});
