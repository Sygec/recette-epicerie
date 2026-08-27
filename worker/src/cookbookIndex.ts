// Turning a freshly-parsed contents list into changes against the index that
// is already stored.
//
// Re-scanning a book has to be safe to do at any time: the parser might have
// improved, or the first pass might have missed a page. So this is additive.
// It never deletes an entry that a later scan failed to see, and it never
// touches one that has already been imported — losing the link between an
// entry and the recipe it produced would make the app offer to import it
// again, which is the one thing the feature promises not to do.
//
// Pure, like cookbookToc.ts: rows in, a plan out. The route applies it.

import { foldTitle } from "./cookbookToc";

/**
 * The identity of a recipe title, for comparison.
 *
 * foldTitle rather than normalizeFoodIdentity from foodDictionary.ts, which
 * only lowercases and strips accents. Titles need punctuation flattened too —
 * a book that prints "Tea Salad–Style Bowl" with an en dash and an index that
 * recorded a hyphen are the same recipe, and so are "Better-than-a-Kebab" and
 * "Better than a Kebab".
 */
export function titleKey(title: string): string {
  return foldTitle(title);
}

export interface StoredEntry {
  id: number;
  title: string;
  title_key: string;
  page_number: number | null;
  end_page: number | null;
  chapter: string | null;
  recipe_id: number | null;
}

export interface IncomingEntry {
  title: string;
  page_number: number | null;
  end_page?: number | null;
  chapter?: string | null;
}

export interface MergePlan {
  insert: (IncomingEntry & { title_key: string })[];
  /** Entries whose page span or chapter improved on a re-scan. */
  update: { id: number; end_page: number | null; chapter: string | null }[];
  unchanged: number;
}

/** Two entries are the same when they sit on the same page under the same title. */
function keyOf(entry: { page_number: number | null; title_key: string }): string {
  return `${entry.page_number ?? "?"}::${entry.title_key}`;
}

/**
 * Fills in where each recipe ends, from where the next one starts.
 *
 * This is what lets the importer send only the pages a recipe actually
 * occupies. Entries sharing a page — a book that puts five marinades on page
 * 31 — all end on that page, so the span is found from the next *different*
 * page rather than the next entry.
 *
 * The last entry's end is left null: the contents can't say where the book
 * stops, and guessing would hand the importer the index and the
 * acknowledgements.
 */
export function withEndPages(entries: IncomingEntry[]): IncomingEntry[] {
  const sorted = [...entries].sort(
    (a, b) => (a.page_number ?? Infinity) - (b.page_number ?? Infinity)
  );

  return sorted.map((entry, i) => {
    if (entry.page_number == null) return { ...entry, end_page: null };
    const next = sorted.slice(i + 1).find(
      (other) => other.page_number != null && other.page_number > entry.page_number!
    );
    return {
      ...entry,
      end_page: next?.page_number != null ? next.page_number - 1 : null,
    };
  });
}

/**
 * Works out what a re-scan should change.
 *
 * Anything already stored stays stored. An entry that is already linked to a
 * recipe is left completely alone — even its page span — because the recipe
 * has been imported from those pages and re-cutting them retrospectively
 * would describe something that never happened.
 */
export function mergeEntries(
  stored: StoredEntry[],
  incoming: IncomingEntry[]
): MergePlan {
  const keyed = new Map(stored.map((entry) => [keyOf(entry), entry]));
  const plan: MergePlan = { insert: [], update: [], unchanged: 0 };
  const seen = new Set<string>();

  for (const entry of incoming) {
    const withKey = { ...entry, title_key: titleKey(entry.title) };
    const key = keyOf(withKey);

    // A contents page listed twice in one payload shouldn't insert twice; the
    // unique index would reject the second anyway.
    if (seen.has(key)) continue;
    seen.add(key);

    const match = keyed.get(key);
    if (!match) {
      plan.insert.push(withKey);
      continue;
    }

    if (match.recipe_id !== null) {
      plan.unchanged++;
      continue;
    }

    const endPage = withKey.end_page ?? null;
    const chapter = withKey.chapter ?? null;
    if (match.end_page !== endPage || match.chapter !== chapter) {
      plan.update.push({ id: match.id, end_page: endPage, chapter });
    } else {
      plan.unchanged++;
    }
  }

  return plan;
}

export interface CrossBookMatch {
  title: string;
  other_title: string;
  other_cookbook: string;
}

/**
 * Flags entries whose title you already have from a different book.
 *
 * Bundles overlap: the same book turns up twice under different names, and
 * different books genuinely share a classic. This doesn't decide which — it
 * just says "you already have this" so the choice is informed. Same-book
 * matches are not reported, since the page-and-title identity already covers
 * those.
 */
export function findCrossBookDuplicates(
  entries: IncomingEntry[],
  existing: { title: string; cookbook_title: string | null }[]
): CrossBookMatch[] {
  const byKey = new Map<string, { title: string; cookbook_title: string | null }>();
  for (const recipe of existing) {
    const key = titleKey(recipe.title);
    // First one wins; a title held twice already is its own problem.
    if (!byKey.has(key)) byKey.set(key, recipe);
  }

  const matches: CrossBookMatch[] = [];
  const reported = new Set<string>();

  for (const entry of entries) {
    const key = titleKey(entry.title);
    const hit = byKey.get(key);
    if (!hit || reported.has(key)) continue;
    reported.add(key);
    matches.push({
      title: entry.title,
      other_title: hit.title,
      other_cookbook: hit.cookbook_title ?? "vos recettes",
    });
  }

  return matches;
}
