// Everything under test here is pure; no PDF and no D1 involved.
//
// The fixtures are short extracts of a real cookbook's contents (Bowls!,
// Chronicle Books) rather than invented lines, because the invented version of
// this file passed while the real book failed. Kept to titles and page
// numbers — the facts the index needs — not recipe text.

import { describe, expect, it } from "vitest";
import {
  estimatePageOffset,
  foldTitle,
  isChapterHeading,
  parseTableOfContents,
  splitTitleAndPage,
  tocScore,
  type TocPage,
} from "./cookbookToc";

// One column of a real contents page, in the order the extractor produces it.
const REAL_TOC_COLUMN = [
  "INTRODUCTION 8",
  "PART 1: Bowl Basics 11",
  "GRAINS & THE LIKE 14",
  "Barley 15",
  "Brown Rice 15",
  "Buckwheat 16",
  "Farro 17",
  "BEANS & LENTILS 21",
  "Lentils 22",
  "Basic Dried Beans 22",
  "PROTEINS 25",
  "Poached Eggs 26",
  "Soft-Boiled Eggs 27",
];

const page = (n: number, lines: string[]): TocPage => ({ page: n, lines });

/** Pads a book out to a plausible length so the front-of-book limit applies. */
function bookWith(tocPages: TocPage[], total = 60): TocPage[] {
  const pages = [...tocPages];
  for (let n = pages.length + 1; n <= total; n++) {
    pages.push(page(n, ["Du texte de recette ordinaire, sans numéro de page."]));
  }
  return pages.sort((a, b) => a.page - b.page);
}

describe("splitTitleAndPage", () => {
  it("reads an entry with no leader, which is what real books print", () => {
    expect(splitTitleAndPage("Kalefornia Bowl 112")).toEqual({
      title: "Kalefornia Bowl",
      page: 112,
    });
  });

  it("strips dot leaders when a book does use them", () => {
    expect(splitTitleAndPage("Tarte aux pommes ......... 147")).toEqual({
      title: "Tarte aux pommes",
      page: 147,
    });
    expect(splitTitleAndPage("Soupe à l'oignon···42")).toEqual({
      title: "Soupe à l'oignon",
      page: 42,
    });
  });

  it("keeps a number that belongs to the title", () => {
    // The trailing number has to be separated to count as a page.
    expect(splitTitleAndPage("Soupe pour 4")).toEqual({ title: "Soupe pour", page: 4 });
    expect(splitTitleAndPage("Gâteau 24h")).toBeNull();
  });

  it("rejects a bare folio", () => {
    expect(splitTitleAndPage("112")).toBeNull();
    expect(splitTitleAndPage("— 112 —")).toBeNull();
  });

  it("rejects a line with no number at all", () => {
    expect(splitTitleAndPage("Twisted Lowcountry Breakfast")).toBeNull();
  });
});

describe("isChapterHeading", () => {
  it("recognises the capitalised headings cookbooks use", () => {
    expect(isChapterHeading("GRAINS & THE LIKE")).toBe(true);
    expect(isChapterHeading("HIPPIE GOODNESS")).toBe(true);
    expect(isChapterHeading("FRESH + THROWN TOGETHER")).toBe(true);
    // Apostrophes and digits must not drag the ratio down.
    expect(isChapterHeading("IT’S BREAKFAST TIME")).toBe(true);
  });

  it("recognises a numbered part even in mixed case", () => {
    expect(isChapterHeading("PART 3: Full Bowls")).toBe(true);
    expect(isChapterHeading("Chapitre 2 : Les sauces")).toBe(true);
  });

  it("does not mistake a recipe for a heading", () => {
    expect(isChapterHeading("Kalefornia Bowl")).toBe(false);
    expect(isChapterHeading("Tea Salad–Style Bowl (with Chicken!)")).toBe(false);
    expect(isChapterHeading("Better-than-a-Kebab")).toBe(false);
  });

  it("ignores strings too short to judge", () => {
    expect(isChapterHeading("A")).toBe(false);
    expect(isChapterHeading("42")).toBe(false);
  });
});

describe("tocScore", () => {
  it("scores a contents page highly", () => {
    expect(tocScore(REAL_TOC_COLUMN)).toBeGreaterThan(0.9);
  });

  it("scores body text at zero", () => {
    expect(
      tocScore([
        "Dans un grand bol, mélanger la farine et le sel.",
        "Ajouter le beurre froid coupé en dés.",
        "Travailler du bout des doigts.",
        "Réserver au frais trente minutes.",
        "Étaler la pâte sur un plan fariné.",
      ])
    ).toBe(0);
  });

  it("scores the alphabetical index low, since its lines carry several numbers", () => {
    // "Kale, 45, 67, 89" ends in a number, but the title half keeps the other
    // numbers, so these are not clean entries.
    const index = [
      "Avocado, 12, 45, 89",
      "Barley, 15",
      "Beans, black, 24, 67",
      "Cabbage, 112",
      "Dressing, see Vinaigrette",
      "Eggs, 26, 27, 28",
      "Farro, 17, 101",
    ];
    expect(tocScore(index)).toBeLessThan(0.95);
  });

  it("ignores a page with too little on it to judge", () => {
    expect(tocScore(["Barley 15", "Farro 17"])).toBe(0);
    expect(tocScore([])).toBe(0);
  });
});

describe("parseTableOfContents", () => {
  it("reads a real contents column into entries with chapters", () => {
    const result = parseTableOfContents(bookWith([page(5, REAL_TOC_COLUMN)]));

    expect(result.toc_pages).toEqual([5]);
    expect(result.entries.map((e) => e.title)).toEqual([
      "Barley",
      "Brown Rice",
      "Buckwheat",
      "Farro",
      "Lentils",
      "Basic Dried Beans",
      "Poached Eggs",
      "Soft-Boiled Eggs",
    ]);
    expect(result.entries[0]).toEqual({
      title: "Barley",
      page_number: 15,
      chapter: "GRAINS & THE LIKE",
    });
    // The chapter changes partway down and the later entries follow it.
    expect(result.entries[result.entries.length - 1].chapter).toBe("PROTEINS");
  });

  it("drops front and back matter that carries a page number", () => {
    const titles = parseTableOfContents(bookWith([page(5, REAL_TOC_COLUMN)])).entries.map(
      (e) => e.title
    );
    expect(titles).not.toContain("INTRODUCTION");
    expect(titles).not.toContain("Index");
    expect(titles).not.toContain("Acknowledgments");
  });

  it("rejoins a title that wrapped onto a second line", () => {
    const result = parseTableOfContents(
      bookWith([
        page(5, [
          "IT’S BREAKFAST TIME 71",
          "Spunky Breakfast 71",
          "Twisted Lowcountry Breakfast",
          "(Lunch or Dinner) 71",
          "MIGHTY MEATY 71",
          "New Steak House 71",
          "Northern Hunt 71",
          "Old-School Taco Bowl 72",
        ]),
      ])
    );
    expect(result.entries.map((e) => e.title)).toContain(
      "Twisted Lowcountry Breakfast (Lunch or Dinner)"
    );
    // And the fragment must not also survive on its own.
    expect(result.entries.map((e) => e.title)).not.toContain("(Lunch or Dinner)");
  });

  it("does not read the alphabetical index at the back as recipes", () => {
    // Same shape as a contents page, but at the end of the book.
    const pages = bookWith([page(5, REAL_TOC_COLUMN)], 60);
    pages[54] = page(55, ["Avocado 12", "Barley 15", "Cabbage 112", "Eggs 26", "Farro 17", "Kale 89"]);
    const result = parseTableOfContents(pages);
    expect(result.toc_pages).toEqual([5]);
    expect(result.entries.map((e) => e.title)).not.toContain("Cabbage");
  });

  it("says so plainly when a book has no usable contents", () => {
    const result = parseTableOfContents(
      bookWith([page(1, ["Une page de texte sans aucune table des matières."])])
    );
    expect(result.entries).toEqual([]);
    expect(result.warning).toMatch(/table des matières/i);
  });

  it("handles an empty document without throwing", () => {
    const result = parseTableOfContents([]);
    expect(result.entries).toEqual([]);
    expect(result.warning).toBeTruthy();
  });
});

describe("estimatePageOffset", () => {
  // A book whose printed page 1 is the PDF's page 4.
  const OFFSET = 3;
  const recipes = ["Kalefornia Bowl", "Cardamom Lamb Bowl", "Budapest Bowl", "Reuben Bowl"];
  const entries = recipes.map((title, i) => ({ title, page_number: 10 + i * 10 }));
  const body: TocPage[] = entries.map((e) => page(e.page_number + OFFSET, [e.title, "du texte"]));

  it("finds the offset by locating titles in the body", () => {
    expect(estimatePageOffset([page(5, []), ...body], entries, [5])).toBe(OFFSET);
  });

  it("returns 0 for a book whose PDF and printed pages line up", () => {
    const aligned = entries.map((e) => page(e.page_number, [e.title]));
    expect(estimatePageOffset(aligned, entries)).toBe(0);
  });

  it("gives up rather than guess when too few titles are found", () => {
    expect(estimatePageOffset([page(20, ["Kalefornia Bowl"])], entries)).toBeNull();
    expect(estimatePageOffset([], entries)).toBeNull();
  });

  it("ignores the contents pages themselves, where every title also appears", () => {
    // Without the exclusion the TOC page matches every title and produces a
    // nonsense offset.
    const toc = page(5, recipes);
    const offset = estimatePageOffset([toc, ...body], entries, [5]);
    expect(offset).toBe(OFFSET);
  });
});

describe("foldTitle", () => {
  it("folds accents and case so titles compare across a book", () => {
    expect(foldTitle("Crème Brûlée à l'Érable")).toBe("creme brulee a l erable");
    expect(foldTitle("Tea Salad–Style Bowl (with Chicken!)")).toBe(
      "tea salad style bowl with chicken"
    );
  });
});
