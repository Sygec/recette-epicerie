import { describe, expect, it } from "vitest";
import { buildTerms, fold, segmentStep } from "./ingredientMatch";

// Shorthand: the ingredient ids each character range resolved to, plus the
// literal text that got highlighted.
function marks(text: string, ingredients: { id: number; name: string }[]) {
  return segmentStep(text, ingredients)
    .filter((s) => s.ingredientIds?.length)
    .map((s) => `${s.ingredientIds!.join("+")}:${s.text}`);
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

  // Both "heavy cream" and "sour cream" answer to a bare "cream". It still
  // highlights, carrying both so the tooltip can show each amount; the full
  // names remain unambiguous.
  it("offers every candidate for a phrase two ingredients share", () => {
    const creams = [
      { id: 1, name: "heavy cream" },
      { id: 2, name: "sour cream" },
    ];
    expect(marks("Whip the cream.", creams)).toEqual(["1+2:cream"]);
    expect(marks("Fold in the sour cream.", creams)).toEqual(["2:sour cream"]);
    expect(marks("Whip the heavy cream.", creams)).toEqual(["1:heavy cream"]);
  });

  // A sectioned recipe lists the same ingredient under each section. Treating
  // that as unresolvable ambiguity meant a step naming three ingredients
  // highlighted none of them.
  it("still highlights an ingredient listed twice", () => {
    const sectioned = [
      { id: 1, name: "granulated sugar" },
      { id: 2, name: "vanilla extract" },
      { id: 3, name: "heavy cream" },
      { id: 4, name: "sugar" },
      { id: 5, name: "vanilla extract" },
    ];
    expect(
      marks("Whip the heavy cream, sugar, and vanilla extract until peaks form.", sectioned)
    ).toEqual(["3:heavy cream", "1+4:sugar", "2+5:vanilla extract"]);
  });

  it("highlights a name duplicated verbatim, carrying both entries", () => {
    const twice = [
      { id: 1, name: "heavy cream" },
      { id: 2, name: "heavy cream" },
    ];
    expect(marks("Whip the heavy cream.", twice)).toEqual(["1+2:heavy cream"]);
  });

  // A real imported recipe: quantities and footnote marks survive into the
  // names, and a sectioned list repeats sugar, vanilla and cream. This step
  // highlighted nothing at all before.
  describe("an imported Black Forest cake", () => {
    const cake = [
      "all-purpose flour (spooned & leveled) (219g)",
      "unsweetened natural cocoa powder*",
      "granulated sugar (350g)",
      "baking soda",
      "baking powder",
      "espresso powder (optional)*",
      "canola or vegetable oil (120ml)",
      "large eggs, at room temperature",
      "full fat sour cream, at room temperature* (180g)",
      "pure vanilla extract",
      "hot water or coffee* (120ml)",
      "dark sweet cherries in heavy syrup* (15 ounce)",
      "heavy cream or heavy whipping cream (240ml)",
      "two 4-ounce semi-sweet chocolate bars (226g), finely chopped",
      "optional: 1 Tablespoon light corn syrup*",
      "confectioners’ sugar (30g)",
      "pure vanilla extract",
    ].map((name, i) => ({ id: i + 1, name }));

    const words = (text: string) =>
      segmentStep(text, cake)
        .filter((s) => s.ingredientIds?.length)
        .map((s) => s.text);

    it("highlights every ingredient the whipped-cream step names", () => {
      expect(
        words("whip the heavy cream, sugar, and vanilla extract on medium-high speed")
      ).toEqual(["heavy cream", "sugar", "vanilla extract"]);
    });

    it("reaches a name carrying a footnote mark", () => {
      // "coffee*" would otherwise be matched literally, asterisk and all.
      expect(words("Pour the hot coffee into the batter.")).toEqual(["coffee"]);
      expect(words("Whisk in the cocoa powder.")).toEqual(["cocoa powder"]);
    });

    it("never treats a leftover measurement as an ingredient", () => {
      expect(words("Stir for 2 minutes, then add 1 Tablespoon at a time.")).toEqual([]);
    });

    it("still distinguishes the two powders", () => {
      expect(words("Add the baking soda and baking powder.")).toEqual([
        "baking soda",
        "baking powder",
      ]);
    });
  });

  // A French import: descriptors agree in number with the noun, so an
  // exact-match qualifier list let every plural through — "entiers" slipped
  // past even though "entier" was listed.
  describe("an imported macaroni chili", () => {
    const chili = [
      "Dindon du Québec, haché",
      "Oignon moyen, coupé en petits dés",
      "Poudre de chili (2 c. à soupe)",
      "Ail émincé (1 c. à thé)",
      "Haricots rouges en conserve, rincés (19 oz)",
      "Sauce tomate (1 3/4 tasse)",
      "Bouillon de légumes ou de volaille faible en sodium (3 1/2 tasses)",
      "Macaroni de grains entiers sec (3 tasses; 340 à 375 g)",
      "Lait (1/2 tasse)",
      "Fromage cheddar râpé (2 tasses)",
    ].map((name, i) => ({ id: i + 1, name }));

    const words = (text: string) =>
      segmentStep(text, chili)
        .filter((s) => s.ingredientIds?.length)
        .map((s) => s.text);

    it("does not highlight a French descriptor on its own", () => {
      // "sec" and "moyen" were both reported as bad highlights.
      expect(words("Cuire le macaroni sec dans un grand chaudron.")).toEqual(["macaroni"]);
      // The whole name appearing verbatim is the right match here; what must
      // not happen is "moyen" highlighting by itself.
      expect(words("Hacher un oignon moyen.")).toEqual(["oignon moyen"]);
      expect(words("Un plat de taille moyenne.")).toEqual([]);
      expect(words("Un bouillon faible en sodium fonctionne bien.")).toEqual(["bouillon"]);
      // "grains entiers" is genuinely part of the name, so matching it whole
      // is right; the point is that "entiers" alone never does.
      expect(words("Des grains entiers, rincés et égouttés.")).toEqual([
        "grains entiers",
      ]);
      expect(words("Utiliser des pâtes entières.")).toEqual([]);
    });

    it("still finds the ingredients themselves", () => {
      expect(
        words("Ajouter la sauce tomate, les haricots rouges et le bouillon.")
      ).toEqual(["sauce tomate", "haricots rouges", "bouillon"]);
      expect(words("Incorporer le lait et le fromage cheddar râpé.")).toEqual([
        "lait",
        "fromage cheddar râpé",
      ]);
    });
  });

  it("handles a step with no mentions", () => {
    const segments = segmentStep("Préchauffer le four à 200 °C.", ingredients);
    expect(segments).toEqual([{ text: "Préchauffer le four à 200 °C." }]);
  });

  it("copes with an empty ingredient list", () => {
    expect(segmentStep("Mélanger.", [])).toEqual([{ text: "Mélanger." }]);
  });
});
