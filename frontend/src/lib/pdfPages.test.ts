// findGutter and splitColumns are pure, so they can be tested without pdf.js
// or a browser. The coordinates below are the real geometry of a two-column
// cookbook table of contents (Bowls!, Chronicle Books, 540pt page): titles at
// x≈54 and x≈276, page numbers at x≈131 and x≈363. That layout is what broke
// the first attempt, so it's the layout worth testing against.

import { describe, expect, it } from "vitest";
import {
  findGutter,
  looksScanned,
  splitColumns,
  type PdfPage,
} from "./pdfPages";
import type { TextItemLike } from "./pdfText";

const PAGE_WIDTH = 540;

/** A positioned run of text: pdf.js puts x and y last in the transform. */
const item = (str: string, x: number, y: number, width: number): TextItemLike => ({
  str,
  transform: [1, 0, 0, 1, x, y],
  width,
});

/** Two columns of "Title 123" rows, laid out like the real book. */
function twoColumnToc(): TextItemLike[] {
  const rows: TextItemLike[] = [];
  let y = 700;
  for (const [title, page] of [
    ["Barley", "15"],
    ["Brown Rice", "15"],
    ["Buckwheat", "16"],
    ["Bulgur", "16"],
    ["Farro", "17"],
  ] as const) {
    rows.push(item(title, 54, y, 70), item(page, 131, y, 10));
    y -= 18;
  }
  y = 700;
  for (const [title, page] of [
    ["Baked Tofu", "29"],
    ["Grilled Tofu", "30"],
    ["Broiled Tofu", "30"],
    ["Teriyaki Marinade", "31"],
    ["BBQ Marinade", "31"],
  ] as const) {
    rows.push(item(title, 276, y, 90), item(page, 363, y, 10));
    y -= 18;
  }
  return rows;
}

describe("findGutter", () => {
  it("finds the band between two columns", () => {
    const gutter = findGutter(twoColumnToc(), PAGE_WIDTH);
    expect(gutter).not.toBeNull();
    // Between where the left column's numbers end (~141) and the right
    // column's titles begin (276).
    expect(gutter!).toBeGreaterThan(141);
    expect(gutter!).toBeLessThan(276);
  });

  it("is not fooled by the left margin, which is the widest empty band", () => {
    // x starts at 54, so buckets 0..5 are empty — wider than the real gutter.
    // Taking the widest band overall and then testing whether it's central
    // finds this margin and gives up, which is the bug this guards.
    const gutter = findGutter(twoColumnToc(), PAGE_WIDTH);
    expect(gutter).not.toBeNull();
    expect(gutter!).toBeGreaterThan(PAGE_WIDTH * 0.3);
  });

  it("returns null for a single column of body text", () => {
    const prose = Array.from({ length: 20 }, (_, i) =>
      item("Une ligne de texte qui traverse la page entière", 54, 700 - i * 14, 430)
    );
    expect(findGutter(prose, PAGE_WIDTH)).toBeNull();
  });

  it("returns null when there is barely anything on the page", () => {
    expect(findGutter([item("42", 270, 40, 10)], PAGE_WIDTH)).toBeNull();
    expect(findGutter([], PAGE_WIDTH)).toBeNull();
  });

  it("ignores a page width it can't use", () => {
    expect(findGutter(twoColumnToc(), 0)).toBeNull();
  });

  it("ignores whitespace-only runs when measuring occupancy", () => {
    // A run of spaces sitting in the gutter must not fill it.
    const items = [...twoColumnToc(), item("   ", 200, 700, 70)];
    expect(findGutter(items, PAGE_WIDTH)).not.toBeNull();
  });
});

describe("findGutter, on layouts that broke earlier versions", () => {
  it("finds a gutter a few long lines reach across", () => {
    // "Baking with Less Sugar" p.6: its left column holds long entries like
    // "What's behind the science of sweets? 17" whose text reaches into the
    // gutter. Requiring a completely empty band found nothing here, and the
    // two columns arrived fused into single lines.
    const rows = twoColumnToc();
    rows.push(item("What's behind the science of sweets?", 54, 610, 215));
    rows.push(item("17", 275, 610, 10));
    expect(findGutter(rows, PAGE_WIDTH)).not.toBeNull();
  });

  it("splits at the right edge of the gap, not down its middle", () => {
    // "Bowls!" p.7: the quiet region runs from where the left column's text
    // ends (~200) to where the right column starts (~276). Its midpoint, 238,
    // puts the left column's own page numbers — which start at 240 — into the
    // right column, fusing two entries into one line.
    const rows: TextItemLike[] = [];
    let y = 700;
    for (const [title, page] of [["Simple Breakfast", "71"], ["Spunky Breakfast", "71"]] as const) {
      rows.push(item(title, 54, y, 120), item(page, 240, y, 10));
      y -= 18;
    }
    y = 700;
    for (const [title, page] of [["Tea Salad Bowl", "123"], ["Slurpy Soba", "127"]] as const) {
      rows.push(item(title, 276, y, 110), item(page, 400, y, 14));
      y -= 18;
    }
    const gutter = findGutter(rows, PAGE_WIDTH)!;
    expect(gutter).toBeGreaterThan(250);
    // The left column's page numbers must stay on the left.
    const [left] = splitColumns(rows, PAGE_WIDTH);
    expect(left.map((i) => i.str)).toContain("71");
  });

  it("still declines a page of ordinary prose", () => {
    const prose = Array.from({ length: 24 }, (_, i) =>
      item("Une ligne de texte courante qui traverse toute la largeur", 54, 700 - i * 14, 430)
    );
    expect(findGutter(prose, PAGE_WIDTH)).toBeNull();
  });
});

describe("splitColumns", () => {
  it("separates the two columns, left first", () => {
    const [left, right] = splitColumns(twoColumnToc(), PAGE_WIDTH);
    expect(left.map((i) => i.str)).toContain("Barley");
    expect(left.map((i) => i.str)).not.toContain("Baked Tofu");
    expect(right.map((i) => i.str)).toContain("Baked Tofu");
    expect(right.map((i) => i.str)).not.toContain("Barley");
  });

  it("keeps every item — nothing is dropped at the boundary", () => {
    const items = twoColumnToc();
    const split = splitColumns(items, PAGE_WIDTH).flat();
    expect(split).toHaveLength(items.length);
  });

  it("returns one column unchanged when there's no gutter", () => {
    const prose = Array.from({ length: 20 }, (_, i) =>
      item("Texte pleine largeur sur toute la page", 54, 700 - i * 14, 430)
    );
    expect(splitColumns(prose, PAGE_WIDTH)).toHaveLength(1);
  });
});

describe("looksScanned", () => {
  const page = (n: number, text: string): PdfPage => ({ page: n, lines: text ? [text] : [] });

  it("recognises a book with no text layer", () => {
    expect(looksScanned(Array.from({ length: 20 }, (_, i) => page(i + 1, "")))).toBe(true);
  });

  it("accepts a book whose pages carry text", () => {
    const pages = Array.from({ length: 20 }, (_, i) =>
      page(i + 1, "Une page avec du texte bien réel dessus")
    );
    expect(looksScanned(pages)).toBe(false);
  });

  it("tolerates the photo pages a real cookbook is full of", () => {
    // Bowls! has 27 near-empty pages out of 163 — all photography. That is a
    // normal book, not a scan.
    const pages = Array.from({ length: 163 }, (_, i) =>
      page(i + 1, i < 27 ? "" : "Une page avec du texte bien réel dessus")
    );
    expect(looksScanned(pages)).toBe(false);
  });

  it("treats an empty document as scanned rather than dividing by zero", () => {
    expect(looksScanned([])).toBe(true);
  });
});
