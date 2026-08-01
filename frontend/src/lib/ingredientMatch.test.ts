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
  it("offers the full phrase and its leading words, longest first", () => {
    expect(buildTerms("Pommes de terre")).toEqual(["pommes de terre", "pommes"]);
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

  it("never ends a phrase on a linking word", () => {
    expect(buildTerms("Jaunes d'œufs")).toEqual(["jaunes d'œufs", "jaunes"]);
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

  it("handles a step with no mentions", () => {
    const segments = segmentStep("Préchauffer le four à 200 °C.", ingredients);
    expect(segments).toEqual([{ text: "Préchauffer le four à 200 °C." }]);
  });

  it("copes with an empty ingredient list", () => {
    expect(segmentStep("Mélanger.", [])).toEqual([{ text: "Mélanger." }]);
  });
});
