// Pure merge logic; no D1. The behaviour that matters is what a re-scan must
// never do: lose an entry, or unlink one that has already been imported.

import { describe, expect, it } from "vitest";
import {
  findCrossBookDuplicates,
  mergeEntries,
  titleKey,
  withEndPages,
  type IncomingEntry,
  type StoredEntry,
} from "./cookbookIndex";

const stored = (
  id: number,
  title: string,
  page_number: number | null,
  extra: Partial<StoredEntry> = {}
): StoredEntry => ({
  id,
  title,
  title_key: titleKey(title),
  page_number,
  end_page: null,
  chapter: null,
  recipe_id: null,
  ...extra,
});

const incoming = (
  title: string,
  page_number: number | null,
  extra: Partial<IncomingEntry> = {}
): IncomingEntry => ({ title, page_number, ...extra });

describe("titleKey", () => {
  it("treats punctuation variants of a title as the same recipe", () => {
    // An en dash and a hyphen are the same recipe; normalizeFoodIdentity,
    // which only folds case and accents, would call these different.
    expect(titleKey("Tea Salad–Style Bowl")).toBe(titleKey("Tea Salad-Style Bowl"));
    expect(titleKey("Better-than-a-Kebab")).toBe(titleKey("Better than a Kebab"));
    expect(titleKey("Crème Brûlée")).toBe(titleKey("creme brulee"));
  });

  it("keeps genuinely different titles apart", () => {
    expect(titleKey("Reuben Bowl")).not.toBe(titleKey("Rueben Bowl"));
  });
});

describe("withEndPages", () => {
  it("ends each recipe where the next one starts", () => {
    const result = withEndPages([
      incoming("Premier", 10),
      incoming("Deuxième", 14),
      incoming("Troisième", 20),
    ]);
    expect(result.map((e) => [e.page_number, e.end_page])).toEqual([
      [10, 13],
      [14, 19],
      [20, null],
    ]);
  });

  it("gives every recipe on a shared page the same single-page span", () => {
    // A real book puts five marinades on page 31; none of them ends on 30.
    const result = withEndPages([
      incoming("Marinade teriyaki", 31),
      incoming("Marinade BBQ", 31),
      incoming("Marinade aux arachides", 31),
      incoming("Poisson grillé", 32),
    ]);
    const marinades = result.filter((e) => e.page_number === 31);
    expect(marinades).toHaveLength(3);
    expect(marinades.every((e) => e.end_page === 31)).toBe(true);
  });

  it("leaves the last entry open rather than guessing where the book ends", () => {
    expect(withEndPages([incoming("Seule", 5)])[0].end_page).toBeNull();
  });

  it("sorts by page, so contents read column by column still come out in order", () => {
    const result = withEndPages([incoming("Tard", 100), incoming("Tôt", 10)]);
    expect(result.map((e) => e.title)).toEqual(["Tôt", "Tard"]);
    expect(result[0].end_page).toBe(99);
  });

  it("handles page-less entries without producing a span", () => {
    const result = withEndPages([incoming("Sans page", null), incoming("Avec page", 5)]);
    expect(result.find((e) => e.title === "Sans page")?.end_page).toBeNull();
  });
});

describe("mergeEntries", () => {
  it("inserts what is new", () => {
    const plan = mergeEntries([stored(1, "Barley", 15)], [
      incoming("Barley", 15),
      incoming("Farro", 17),
    ]);
    expect(plan.insert.map((e) => e.title)).toEqual(["Farro"]);
    expect(plan.unchanged).toBe(1);
  });

  it("keeps entries a later scan failed to see", () => {
    // The plan contains no deletions at all — a worse parse must not destroy
    // work already done.
    const plan = mergeEntries(
      [stored(1, "Barley", 15), stored(2, "Farro", 17)],
      [incoming("Barley", 15)]
    );
    expect(plan.insert).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(Object.keys(plan)).not.toContain("delete");
  });

  it("never touches an entry that has already been imported", () => {
    const plan = mergeEntries(
      [stored(1, "Barley", 15, { recipe_id: 42, end_page: 15, chapter: "GRAINS" })],
      // A re-scan that now believes the span and chapter are different.
      [incoming("Barley", 15, { end_page: 16, chapter: "CÉRÉALES" })]
    );
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("improves the span and chapter of an entry not yet imported", () => {
    const plan = mergeEntries(
      [stored(1, "Barley", 15)],
      [incoming("Barley", 15, { end_page: 15, chapter: "GRAINS & THE LIKE" })]
    );
    expect(plan.update).toEqual([
      { id: 1, end_page: 15, chapter: "GRAINS & THE LIKE" },
    ]);
  });

  it("matches on page and title together, so a reprint on another page is new", () => {
    const plan = mergeEntries([stored(1, "Barley", 15)], [incoming("Barley", 200)]);
    expect(plan.insert).toHaveLength(1);
  });

  it("collapses a duplicate inside one payload", () => {
    // The unique index would reject the second insert; better not to send it.
    const plan = mergeEntries([], [incoming("Barley", 15), incoming("Barley", 15)]);
    expect(plan.insert).toHaveLength(1);
  });

  it("matches across punctuation differences between scans", () => {
    const plan = mergeEntries(
      [stored(1, "Better-than-a-Kebab", 143)],
      [incoming("Better than a Kebab", 143)]
    );
    expect(plan.insert).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });
});

describe("findCrossBookDuplicates", () => {
  it("flags a title you already have from another book", () => {
    const matches = findCrossBookDuplicates(
      [incoming("Kalefornia Bowl", 112), incoming("Reuben Bowl", 135)],
      [{ title: "Kalefornia Bowl", cookbook_title: "Bowls!" }]
    );
    expect(matches).toEqual([
      {
        title: "Kalefornia Bowl",
        other_title: "Kalefornia Bowl",
        other_cookbook: "Bowls!",
      },
    ]);
  });

  it("names your own recipes when the match came from no book", () => {
    const matches = findCrossBookDuplicates(
      [incoming("Tarte aux pommes", 12)],
      [{ title: "Tarte aux pommes", cookbook_title: null }]
    );
    expect(matches[0].other_cookbook).toBe("vos recettes");
  });

  it("matches despite accents and punctuation", () => {
    const matches = findCrossBookDuplicates(
      [incoming("Creme Brulee", 88)],
      [{ title: "Crème brûlée", cookbook_title: "Larousse" }]
    );
    expect(matches).toHaveLength(1);
  });

  it("reports a repeated title once", () => {
    const matches = findCrossBookDuplicates(
      [incoming("Barley", 15), incoming("Barley", 200)],
      [{ title: "Barley", cookbook_title: "Grains" }]
    );
    expect(matches).toHaveLength(1);
  });

  it("says nothing when there is nothing to say", () => {
    expect(findCrossBookDuplicates([incoming("Inédit", 1)], [])).toEqual([]);
    expect(findCrossBookDuplicates([], [{ title: "Barley", cookbook_title: null }])).toEqual([]);
  });
});
