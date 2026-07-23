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

import { parseLeadingQuantity } from "./recipeImport";

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
  // length so short non-plural units (oz, cs) aren't mangled. Only reaches
  // the last word of a phrase, which is why the multi-word volume table
  // below lists French plural forms ("cuillères à soupe") explicitly rather
  // than relying on this fold.
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

// Real unit conversion, scoped to two dimensions only: volume and weight.
// Never crosses dimensions (a volume never converts to a weight — that
// needs the ingredient's density, which isn't tracked), and never touches a
// bare count ("2 onions" vs "300 g" always stays as two lines, correctly —
// they aren't the same kind of quantity). This is what actually lets a
// French source's "45 ml (3 c. à soupe)" merge with an English source's
// "3 tablespoons (45 ml)" for the same ingredient, where the two round-trip
// to the exact same real amount just expressed differently.
const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  millilitre: 1,
  cl: 10,
  centilitre: 10,
  l: 1000,
  litre: 1000,
  liter: 1000,
  teaspoon: 5,
  tsp: 5,
  "c. à thé": 5,
  "cuillère à thé": 5,
  "cuillères à thé": 5,
  "c. à café": 5,
  "cuillère à café": 5,
  "cuillères à café": 5,
  tablespoon: 15,
  tbsp: 15,
  "c. à soupe": 15,
  "cuillère à soupe": 15,
  "cuillères à soupe": 15,
  cup: 240,
  tasse: 240,
};

// Bare "oz" defaults to weight (the more common meaning); fluid ounces need
// to say so explicitly.
const WEIGHT_TO_G: Record<string, number> = {
  g: 1,
  gram: 1,
  gramme: 1,
  kg: 1000,
  kilogram: 1000,
  kilogramme: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
};

// Re-expresses `quantity` (in `fromUnit`) as an equivalent quantity in
// `toUnit`, if both units belong to the same dimension (both volume, or
// both weight). Identical or synonym units (e.g. "cup"/"tasse") return the
// quantity unchanged. Returns undefined if the units aren't in the same
// dimension, or aren't recognized at all.
export function convertForMerge(
  quantity: number,
  fromUnit: string,
  toUnit: string
): number | undefined {
  const from = canonicalUnit(fromUnit);
  const to = canonicalUnit(toUnit);
  if (from === to) return quantity;

  const fromMl = VOLUME_TO_ML[from];
  const toMl = VOLUME_TO_ML[to];
  if (fromMl !== undefined && toMl !== undefined) return (quantity * fromMl) / toMl;

  const fromG = WEIGHT_TO_G[from];
  const toG = WEIGHT_TO_G[to];
  if (fromG !== undefined && toG !== undefined) return (quantity * fromG) / toG;

  return undefined;
}

// The ingredient-import pipeline appends a trailing "(<number> <unit>)"
// conversion note to a name when a size/weight conversion precedes the real
// ingredient name in the source text — e.g. "poudre de chili (1/4 tasse)".
// That note describes the ORIGINAL quantity; once a merge changes the row's
// quantity, the note goes stale (still "1/4 tasse" after the row is really
// "1/2 tasse" worth). Recomputes it when the note cleanly parses as just a
// number + a unit in the same dimension as the row's primary unit; leaves
// the name untouched otherwise (multi-part notes like "(8 Tbsp; 113g)", or
// free-text asides like "(or pecans)") rather than risk mangling something
// that isn't actually a stale conversion.
export function updateNameConversionNote(
  name: string,
  primaryUnit: string | null,
  newQuantity: number | null
): string {
  if (primaryUnit == null || newQuantity == null) return name;

  const match = name.match(/^(.*)\s\(([^)]+)\)$/);
  if (!match) return name;
  const [, core, noteContent] = match;

  const parsed = parseLeadingQuantity(noteContent);
  if (!parsed) return name;
  const noteUnit = noteContent.slice(parsed.consumed).trim();
  if (!noteUnit) return name; // no unit word after the number — not a "<qty> <unit>" note

  const converted = convertForMerge(newQuantity, primaryUnit, noteUnit);
  if (converted === undefined) return name; // different dimension, or an unrecognized unit

  const rounded = Math.round(converted * 100) / 100;
  return `${core} (${rounded} ${noteUnit})`;
}

interface GroceryRowLike {
  quantity: number | null;
  unit: string | null;
}

// Finds which existing grocery-list row (if any) the incoming quantity
// should merge into, and what the resulting quantity should be. Tries an
// exact/synonym unit match first (no rounding involved) before falling back
// to unit conversion, so "45 ml" prefers merging with an existing "45 ml"
// row over converting into a "3 tablespoons" row if both happen to exist.
export function findMergeTarget<T extends GroceryRowLike>(
  candidates: T[],
  incomingQuantity: number | null,
  incomingUnit: string | null
): { row: T; mergedQuantity: number | null } | undefined {
  for (const row of candidates) {
    if (unitsMatch(row.unit, incomingUnit)) {
      const mergedQuantity =
        incomingQuantity != null && row.quantity != null
          ? row.quantity + incomingQuantity
          : (row.quantity ?? incomingQuantity ?? null);
      return { row, mergedQuantity };
    }
  }

  if (incomingQuantity != null && incomingUnit != null) {
    for (const row of candidates) {
      if (row.unit == null || row.quantity == null) continue;
      const converted = convertForMerge(incomingQuantity, incomingUnit, row.unit);
      if (converted !== undefined) {
        return { row, mergedQuantity: Math.round((row.quantity + converted) * 100) / 100 };
      }
    }
  }

  return undefined;
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
