// Finds where a recipe's ingredients are mentioned in its step text, so the
// steps can highlight them and show the quantity on tap.
//
// Steps rarely repeat an ingredient's list entry verbatim. Real cases from
// the seeded recipes:
//
//   "Pecorino romano râpé"    -> step says "le pecorino"
//   "Guanciale (ou pancetta)" -> step says "le guanciale"
//   "Oignons"                 -> step says "l'oignon"
//   "Pommes de terre"         -> step says "les pommes de terre"
//
// So matching works on progressively shorter leading phrases of the name,
// with parentheticals and trailing qualifiers stripped, and singular/plural
// treated as the same word. The longest phrase that appears wins, which is
// what keeps "pommes de terre" from being labelled as "Pommes".
//
// It deliberately does NOT try to be clever about synonyms: a step that says
// "égoutter les pâtes" about spaghetti stays plain text. Guessing there would
// mean wrong labels, and a wrong quantity is worse than no quantity.

export interface MatchableIngredient {
  // string | number because meal-plan review rows carry composite ids.
  id: string | number;
  name: string;
}

export interface StepSegment {
  text: string;
  /** Set when this segment is a mention of the ingredient with this id. */
  ingredientId?: string | number;
}

// Words that can't end a meaningful phrase — "pommes de" is not a thing to
// match on, though "pommes" and "pommes de terre" both are.
const TRAILING_STOPWORDS = new Set([
  "de", "des", "du", "d", "a", "au", "aux", "en", "le", "la", "les", "l", "et", "ou",
]);

// Lowercase and strip accents WITHOUT changing the string's length, so that
// an index into the folded text still points at the same character in the
// original. The usual NFD-then-remove-marks trick expands "é" into two code
// points and shifts every index after it.
export function fold(text: string): string {
  return Array.from(text)
    .map((ch) => {
      const base = ch.normalize("NFD")[0];
      return base.toLowerCase();
    })
    .join("");
}

// Drops the parts of a list entry that a step won't repeat: a parenthetical
// alternative ("(ou pancetta)"), and anything after a comma, which is
// normally preparation notes ("râpé, à température ambiante").
function cleanName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .split(",")[0]
    .replace(/\s+/g, " ")
    .trim();
}

function singular(word: string): string {
  // Only fold a trailing "s" on words long enough that it's plausibly a
  // plural marker — this must not turn "jus" into "ju".
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

/**
 * The phrases worth looking for, longest first: every leading run of words
 * that doesn't end on a stopword.
 */
export function buildTerms(name: string): string[] {
  const words = fold(cleanName(name)).split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  for (let n = words.length; n >= 1; n--) {
    const slice = words.slice(0, n);
    const last = slice[slice.length - 1].replace(/['’]$/, "");
    if (TRAILING_STOPWORDS.has(last)) continue;
    // A one-word term has to carry some weight on its own; "ail" is fine,
    // but two-letter fragments would match half the page.
    if (n === 1 && slice[0].length < 3) continue;
    terms.push(slice.join(" "));
  }
  return terms;
}

function termToRegExp(term: string): RegExp {
  const pattern = term
    .split(" ")
    .map((word) => {
      const stem = singular(word)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/['’]/g, "['’]");
      // Allow the plural form of any word in the phrase.
      return `${stem}s?`;
    })
    .join("\\s+");
  // Word boundaries that understand apostrophes: "l'oignon" must match
  // "oignon", but "conseil" must not match "sel".
  return new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`, "g");
}

/**
 * Splits a step into plain and ingredient-mention segments, in order.
 * Concatenating every segment's text reproduces the original exactly.
 */
export function segmentStep(
  text: string,
  ingredients: MatchableIngredient[]
): StepSegment[] {
  const folded = fold(text);

  const hits: { start: number; end: number; ingredientId: string | number }[] = [];
  for (const ingredient of ingredients) {
    for (const term of buildTerms(ingredient.name)) {
      for (const m of folded.matchAll(termToRegExp(term))) {
        hits.push({
          start: m.index!,
          end: m.index! + m[0].length,
          ingredientId: ingredient.id,
        });
      }
    }
  }

  // Longest match wins at any given position, so the specific phrase beats
  // the generic one it contains. Ties go to whichever started earlier.
  hits.sort((a, b) => a.start - b.start || b.end - a.end);

  const chosen: typeof hits = [];
  let consumed = 0;
  for (const hit of hits) {
    if (hit.start < consumed) continue;
    chosen.push(hit);
    consumed = hit.end;
  }

  const segments: StepSegment[] = [];
  let cursor = 0;
  for (const hit of chosen) {
    if (hit.start > cursor) segments.push({ text: text.slice(cursor, hit.start) });
    segments.push({
      text: text.slice(hit.start, hit.end),
      ingredientId: hit.ingredientId,
    });
    cursor = hit.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
