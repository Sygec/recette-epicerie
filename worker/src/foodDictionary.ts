// Cross-language ingredient recognition (Phase 2).
//
// Free-text ingredient/grocery-item names are matched against the seeded
// food_dictionary (via food_aliases) to find a canonical "food" identity.
// That identity drives two things when an item is added to the grocery
// list: which aisle category it defaults to, and whether it should merge
// into an existing unchecked line rather than create a duplicate. No
// translation ever happens — the name the user typed or the recipe
// provided is always what's displayed; the dictionary only informs
// categorization and merge-matching.

export function normalizeFoodText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface AliasRow {
  alias: string;
  food_id: number;
  category_id: number | null;
}

export interface FoodMatch {
  food_id: number;
  category_id: number | null;
}

// "c. à thé" / "cuillère à café" are common French phrasings for teaspoon —
// literally "spoon at tea/coffee" — a holdover from teaspoons historically
// being for tea. Ingredient names often carry one of these as a size
// conversion ("coriandre moulue (2 c. à thé)"), which otherwise
// false-matches against the beverage entries "thé"/"café" — "thé" there is
// a properly word-bounded token, not a substring-inside-another-word case,
// so the normal boundary check doesn't catch it. Excluded whenever
// immediately preceded by "à ", since that combination is essentially
// always a unit/container reference (cuillère/tasse/verre à thé|café),
// never a direct purchase of the beverage itself.
const UNIT_IDIOM_EXCLUSIONS = new Set(["thé", "café"]);

// Matches as a whole word/phrase within the given text, not as a substring
// of some unrelated longer word ("sel" must not match inside "conseil").
// When multiple aliases match, the longest wins — so a specific compound
// alias like "crème sure" is preferred over the shorter "crème" for
// "1 tasse de crème sure, à température ambiante".
export function matchFood(text: string, aliasRows: AliasRow[]): FoodMatch | null {
  const normalized = normalizeFoodText(text);
  let best: AliasRow | null = null;

  for (const row of aliasRows) {
    const aliasNorm = normalizeFoodText(row.alias);
    const boundary = "[^a-zà-ÿ]";
    const exclude = UNIT_IDIOM_EXCLUSIONS.has(aliasNorm) ? "(?<!à )" : "";
    const pattern = new RegExp(
      `(^|${boundary})${exclude}${escapeRegExp(aliasNorm)}(${boundary}|$)`,
      "i"
    );
    if (pattern.test(normalized) && (!best || aliasNorm.length > normalizeFoodText(best.alias).length)) {
      best = row;
    }
  }

  return best ? { food_id: best.food_id, category_id: best.category_id } : null;
}

// Some units are the exact same real quantity across languages/phrasing —
// not different scales needing conversion math, just different words for
// the same count: "boîte"/"can", "pincée"/"pinch", "gousse"/"clove", or
// simply singular vs plural ("tablespoon"/"tablespoons"). These are safe to
// treat as equal for merge purposes, since summing "1 boîte" + "1 can" = 2
// of that same container needs no unit math. This deliberately does NOT
// attempt actual measurement conversion (ml <-> tablespoon <-> cup) — a
// recipe's French and English versions routinely lead with different
// primary units for the same real amount ("45 ml (3 c. à soupe)" vs
// "3 tablespoons (45 ml)"), and those stay as separate lines rather than
// silently guessing at a conversion.
const UNIT_SYNONYM_GROUPS: string[][] = [
  ["boîte", "boite", "can"],
  ["pincée", "pincee", "pinch"],
  ["gousse", "clove"],
  ["tasse", "cup"],
  ["sachet", "packet", "package"],
  ["tranche", "slice"],
  ["botte", "bunch"],
];

function canonicalUnit(unit: string): string {
  const normalized = normalizeFoodText(unit);
  // Cheap plural fold for units not covered by the synonym groups above
  // (tablespoon/tablespoons, teaspoon/teaspoons, gram/grams...). Guarded by
  // length so short non-plural units (oz, cs) aren't mangled.
  const singularish =
    normalized.endsWith("s") && normalized.length > 3
      ? normalized.slice(0, -1)
      : normalized;
  for (const group of UNIT_SYNONYM_GROUPS) {
    if (group.some((g) => singularish === g || singularish === `${g}s`)) {
      return group[0];
    }
  }
  return singularish;
}

export function unitsMatch(a: string | null, b: string | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return canonicalUnit(a) === canonicalUnit(b);
}

export async function loadAliasRows(db: D1Database): Promise<AliasRow[]> {
  const { results } = await db
    .prepare(
      `SELECT fa.alias AS alias, fd.id AS food_id, fd.category_id AS category_id
       FROM food_aliases fa
       JOIN food_dictionary fd ON fd.id = fa.food_id`
    )
    .all<AliasRow>();
  return results;
}
