import { describe, expect, it } from "vitest";
import { buildTerms, fold, segmentStep } from "./ingredientMatch";

// Shorthand: the ingredient ids each character range resolved to, plus the
// literal text that got highlighted.
function marks(text: string, ingredients: { id: number; name: string }[]) {
  return segmentStep(text, ingredients)
    .filter((s) => s.ingredientId != null)
    .map((s) => `${s.ingredientId}:${s.text}`);
}

describe("fold", () => {
  it("lowercases and strips accents", () => {
    expect(fold("Crème Sure")).toBe("creme sure");
  });

  // The whole highlighting scheme relies on an index into the folded text
  // pointing at the same character in the original. The usual NFD-and-strip
  // approach expands "é" into two code points and breaks that.
  it("preserves length so indices stay aligned", () => {
    const text = "Pâté à l'ail, œufs brouillés";
    expect(Array.from(fold(text))).toHaveLength(Array.from(text).length);
  });
});

describe("buildTerms", () => {
  it("offers every runnable phrase, longest first", () => {
    expect(buildTerms("Pommes de terre")).toEqual([
      "pommes de terre",
      "pommes",
      "terre",
    ]);
  });

  // English puts the head noun last, so leading-words-only matching found the
  // adjective and missed the ingredient on every English recipe.
  it("finds the head noun of a head-final name", () => {
    expect(buildTerms("heavy cream")).toEqual(["heavy cream", "cream"]);
    expect(buildTerms("large eggs")).toEqual(["large eggs", "eggs"]);
    expect(buildTerms("light corn syrup")).toContain("corn syrup");
  });

  it("never offers a bare descriptor as a match", () => {
    for (const name of ["heavy cream", "large eggs", "hot water", "baking powder"]) {
      const terms = buildTerms(name);
      expect(terms).not.toContain(name.split(" ")[0]);
    }
  });

  it("treats or/ou as separating real alternatives", () => {
    expect(buildTerms("hot water or coffee")).toContain("coffee");
    // ...and never runs a phrase across the separator.
    expect(buildTerms("hot water or coffee")).not.toContain("hot water or");
  });

  it("ignores measurements that leaked into a name", () => {
    const terms = buildTerms("two 9-inch cake pans");
    expect(terms.some((t) => /\d/.test(t))).toBe(false);
    expect(terms).not.toContain("two");
  });

  it("drops parentheticals", () => {
    expect(buildTerms("Guanciale (ou pancetta)")).toEqual(["guanciale"]);
  });

  it("drops preparation notes after a comma", () => {
    expect(buildTerms("Crème sure, à température ambiante")).toEqual([
      "creme sure",
      "creme",
    ]);
  });

  it("matches either number, including y/ies", () => {
    expect(buildTerms("Cherries")).toEqual(["cherries"]);
  });

  // The elided article is split off internally, so the phrase is stored as
  // "jaunes d' œufs" — an implementation detail. What matters is that the
  // noun is reachable on its own.
  it("never begins or ends a phrase on a linking word", () => {
    const terms = buildTerms("Jaunes d'œufs");
    expect(terms).toContain("jaunes");
    expect(terms).toContain("œufs");
    expect(terms).not.toContain("d");
  });
});

describe("segmentStep", () => {
  const ingredients = [
    { id: 1, name: "Spaghetti" },
    { id: 2, name: "Guanciale (ou pancetta)" },
    { id: 3, name: "Pecorino romano râpé" },
    { id: 4, name: "Oignons" },
    { id: 5, name: "Pommes de terre" },
  ];

  it("reproduces the original text exactly", () => {
    const text = "Faire revenir le guanciale avec les oignons.";
    expect(
      segmentStep(text, ingredients)
        .map((s) => s.text)
        .join("")
    ).toBe(text);
  });

  it("matches a shorter mention than the list entry", () => {
    expect(marks("Mélanger le pecorino et le poivre.", ingredients)).toEqual([
      "3:pecorino",
    ]);
  });

  it("matches through a parenthetical in the list entry", () => {
    expect(marks("Faire revenir le guanciale.", ingredients)).toEqual(["2:guanciale"]);
  });

  it("matches singular against a plural list entry, and across an apostrophe", () => {
    expect(marks("Émincer l'oignon finement.", ingredients)).toEqual(["4:oignon"]);
  });

  it("matches an elided name whole or by its noun alone", () => {
    const eggs = [{ id: 7, name: "Jaunes d'œufs" }];
    expect(marks("Mélanger les jaunes d'œufs.", eggs)).toEqual(["7:jaunes d'œufs"]);
    expect(marks("Battre les œufs.", eggs)).toEqual(["7:œufs"]);
    expect(marks("Ajouter les jaunes.", eggs)).toEqual(["7:jaunes"]);
  });

  it("prefers the more specific phrase", () => {
    // "Pommes de terre" must not be reported as some bare "pommes" match.
    expect(marks("Couper les pommes de terre en cubes.", ingredients)).toEqual([
      "5:pommes de terre",
    ]);
  });

  it("is accent-insensitive in both directions", () => {
    expect(marks("Ajouter le pécorino.", ingredients)).toEqual(["3:pécorino"]);
  });

  it("highlights every occurrence", () => {
    expect(marks("Cuire les spaghetti, égoutter les spaghetti.", ingredients)).toEqual([
      "1:spaghetti",
      "1:spaghetti",
    ]);
  });

  it("does not match inside a longer word", () => {
    const sel = [{ id: 9, name: "Sel" }];
    expect(marks("Suivre ce conseil de cuisson.", sel)).toEqual([]);
  });

  // Deliberately out of scope: a synonym the ingredient list never uses.
  // Guessing here would put a wrong quantity on the wrong word.
  it("leaves an unrelated synonym alone", () => {
    expect(marks("Égoutter les pâtes.", ingredients)).toEqual([]);
  });

  // Reported from a Black Forest cake: "heavy" and "large" were highlighted
  // while "cream" and "eggs" were not.
  it("highlights the ingredient rather than its adjective", () => {
    const english = [
      { id: 1, name: "large eggs" },
      { id: 2, name: "vegetable oil" },
      { id: 3, name: "chopped chocolate" },
    ];
    expect(marks("Beat the eggs, then add the oil and the chocolate.", english)).toEqual([
      "1:eggs",
      "2:oil",
      "3:chocolate",
    ]);
    expect(marks("Use a large bowl and a hot oven.", english)).toEqual([]);
  });

  // Both "heavy cream" and "sour cream" answer to a bare "cream", so it can't
  // be attributed and showing either quantity would be a guess.
  it("leaves a phrase two ingredients share unmatched", () => {
    const creams = [
      { id: 1, name: "heavy cream" },
      { id: 2, name: "sour cream" },
    ];
    expect(marks("Whip the cream.", creams)).toEqual([]);
    expect(marks("Fold in the sour cream.", creams)).toEqual(["2:sour cream"]);
    expect(marks("Whip the heavy cream.", creams)).toEqual(["1:heavy cream"]);
  });

  it("handles a step with no mentions", () => {
    const segments = segmentStep("Préchauffer le four à 200 °C.", ingredients);
    expect(segments).toEqual([{ text: "Préchauffer le four à 200 °C." }]);
  });

  it("copes with an empty ingredient list", () => {
    expect(segmentStep("Mélanger.", [])).toEqual([{ text: "Mélanger." }]);
  });
});
