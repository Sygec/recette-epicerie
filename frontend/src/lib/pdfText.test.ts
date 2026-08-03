import { describe, expect, it } from "vitest";
import { linesFromTextItems, TextItemLike } from "./pdfText";

// pdf.js reports positioned runs, not lines. These fixtures are shaped the way
// it reports them: [scaleX, skewY, skewX, scaleY, x, y].
function item(str: string, x: number, y: number, width = str.length * 5): TextItemLike {
  return { str, transform: [1, 0, 0, 1, x, y], width };
}

describe("linesFromTextItems", () => {
  it("groups runs that share a baseline, left to right", () => {
    // Deliberately out of reading order, as pdf.js often reports it.
    const items = [item("cups flour", 120, 700), item("1 1/2 ", 72, 700)];
    expect(linesFromTextItems(items)).toEqual(["1 1/2 cups flour"]);
  });

  // PDF y grows upwards, so a naive ascending sort reverses the page.
  it("orders lines from the top of the page down", () => {
    const items = [item("Deuxième", 72, 600), item("Premier", 72, 700)];
    expect(linesFromTextItems(items)).toEqual(["Premier", "Deuxième"]);
  });

  it("tolerates baselines that wobble within a line", () => {
    // Adjacent glyph runs: the second starts exactly where the first ends.
    const items = [item("Ingré", 72, 700, 28), item("dients", 100, 700.8)];
    expect(linesFromTextItems(items)).toEqual(["Ingrédients"]);
  });

  it("keeps genuinely separate lines apart", () => {
    const items = [item("2 oeufs", 72, 700), item("1 tasse de lait", 72, 685)];
    expect(linesFromTextItems(items)).toEqual(["2 oeufs", "1 tasse de lait"]);
  });

  it("collapses runs of whitespace and drops empty rows", () => {
    const items = [item("  Sel   et    poivre  ", 72, 700), item("   ", 72, 650)];
    expect(linesFromTextItems(items)).toEqual(["Sel et poivre"]);
  });

  it("survives a page with no text", () => {
    expect(linesFromTextItems([])).toEqual([]);
  });

  // A two-column layout interleaves on the page; runs sharing a baseline are
  // joined left to right, which is the honest reading of the geometry even
  // though it merges the columns. Documented so the behaviour isn't a
  // surprise when a magazine-style PDF comes through.
  it("joins side-by-side columns on a shared baseline", () => {
    const items = [item("colonne gauche", 72, 700, 80), item("colonne droite", 320, 700)];
    expect(linesFromTextItems(items)).toEqual(["colonne gauche colonne droite"]);
  });
});
