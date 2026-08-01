// Finds where a recipe's ingredients are mentioned in its step text, so the
// steps can highlight them and show the quantity on tap.
//
// Steps rarely repeat an ingredient's list entry verbatim, so matching works
// on sub-phrases of the name rather than the whole thing:
//
//   "Pecorino romano râpé"    -> step says "le pecorino"
//   "Guanciale (ou pancetta)" -> step says "le guanciale"
//   "heavy cream"             -> step says "the cream"
//   "large eggs"              -> step says "the eggs"
//
// Every contiguous run of words counts, not just leading ones. French puts
// the head noun first ("crème sure", "pommes de terre") but English puts it
// last ("heavy cream", "light corn syrup"), so a leading-words-only rule
// highlights the adjective and misses the ingredient on every English recipe.
//
// A single-word phrase is only allowed if it could plausibly name a food, so
// "heavy", "large" and "baking" never match on their own.
//
// A phrase can belong to more than one ingredient — a sectioned recipe lists
// "sugar" under both the cake and the whipped cream, and "cream" fits both
// "heavy cream" and "sour cream". Those carry every candidate rather than
// picking one, so the tooltip can show each amount and let the reader choose.
// Dropping them instead, as this once did, meant a step naming three
// ingredients could highlight none of them.
//
// It still doesn't do synonyms: "égoutter les pâtes" stays plain text in a
// recipe whose ingredient is Spaghetti.

export interface MatchableIngredient {
  // string | number because meal-plan review rows carry composite ids.
  id: string | number;
  name: string;
}

export interface StepSegment {
  text: string;
  /**
   * Set when this segment mentions an ingredient. More than one id means the
   * wording fits several entries — two sections listing the same thing, or
   * two foods sharing a word — and the caller should offer all of them.
   */
  ingredientIds?: (string | number)[];
}

// Words that can't begin or end a meaningful phrase — "pommes de" and
// "hot water or" are not things to match on.
const EDGE_STOPWORDS = new Set([
  // French
  "de", "des", "du", "d", "a", "au", "aux", "en", "le", "la", "les", "l", "et", "ou",
  // English
  "or", "and", "of", "the", "an", "to", "with", "for", "in", "into", "at", "on",
]);

// Words that describe an ingredient without naming one. They can appear
// inside a phrase ("heavy cream") but never stand alone as a match, which is
// what stopped "large", "hot", "heavy" and "baking" from being highlighted
// as though they were ingredients.
const QUALIFIERS = new Set([
  // English — size, state, preparation
  "large", "small", "medium", "extra", "hot", "cold", "warm", "room",
  "temperature", "fresh", "freshly", "dried", "chopped", "minced", "ground",
  "grated", "shredded", "sliced", "diced", "melted", "softened", "packed",
  "sifted", "whole", "heavy", "light", "unsalted", "salted", "plain", "pure",
  "granulated", "powdered", "confectioners", "all", "purpose", "semisweet",
  "bittersweet", "unsweetened", "sweetened", "boiling", "lukewarm", "cooked",
  "raw", "ripe", "baking", "optional", "divided", "beaten", "toasted",
  "sour", "inch", "size", "sized", "natural", "full", "fat", "semi", "sweet",
  "dark", "whipping", "finely", "coarsely", "spooned", "leveled", "level",
  "chilled", "thawed", "drained", "rinsed", "peeled", "seeded", "strong",
  // French
  "gros", "grosse", "grand", "grande", "petit", "petite", "chaud", "chaude",
  "froid", "froide", "frais", "fraiche", "hache", "hachee", "moulu", "moulue",
  "rape", "rapee", "fondu", "fondue", "tiede", "entier", "entiere", "sale",
  "salee", "doux", "douce", "sure", "tempere", "ambiante", "cuit", "cuite",
  "cru", "crue", "mur", "mure", "facultatif", "coupe", "coupee",
  // Counting words, which show up in imported names like "two 9-inch pans"
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "un", "une", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  // Measurements, which survive into a name whenever the importer can't
  // split them off ("optional: 1 Tablespoon light corn syrup"). A step
  // saying "add 2 tablespoons" is talking about an amount, not an
  // ingredient.
  "teaspoon", "teaspoons", "tsp", "tablespoon", "tablespoons", "tbsp",
  "cup", "cups", "ounce", "ounces", "pound", "pounds", "gram", "grams",
  "quart", "pint", "gallon", "pinch", "dash", "can", "cans", "jar", "jars",
  "package", "packages", "box", "bag", "stick", "sticks",
  "cuillere", "cuilleres", "tasse", "tasses", "gramme", "grammes", "litre",
  "pincee", "boite", "boites", "sachet", "tranche", "tranches",
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
//
// "or"/"ou" separates genuine alternatives ("hot water or coffee"), so each
// side becomes its own phrase source — a step is free to mention either.
function nameVariants(name: string): string[] {
  const base = name
    .replace(/\([^)]*\)/g, " ")
    .split(",")[0]
    .replace(/[-–—/]/g, " ");
  return base
    .split(/\s(?:or|ou)\s/i)
    // "d'œufs" is an article glued to a noun; split it so the noun is a
    // phrase in its own right and a step saying "les œufs" still matches.
    .map((part) => part.replace(/\b([dlnscjt]|qu)['’]/gi, "$1' "))
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Matches a word in either number: "cream(s)", "cherry/cherries". Guarded by
// length so short words aren't mangled — this must not turn "jus" into "ju".
function numberAgnostic(escaped: string): string {
  if (escaped.length > 4 && escaped.endsWith("ies")) {
    return `${escaped.slice(0, -3)}(?:y|ies)`;
  }
  const stem = escaped.length > 3 && escaped.endsWith("s") ? escaped.slice(0, -1) : escaped;
  return `${stem}s?`;
}

/**
 * Every contiguous run of words in the name that could stand for the
 * ingredient, longest first. Covers head-first names ("crème sure" -> crème)
 * and head-last ones ("heavy cream" -> cream) without knowing the language.
 */
export function buildTerms(name: string): string[] {
  const terms = new Set<string>();
  for (const variant of nameVariants(name)) {
    // Reference marks and list punctuation ride along on words — "coffee*",
    // "powder*", "optional:" — and would otherwise be matched literally, so a
    // step saying plain "coffee" would find nothing. Trim anything that isn't
    // a letter, digit or apostrophe from each end.
    const words = fold(variant)
      .split(/\s+/)
      .map((word) => word.replace(/^[^\p{L}\p{N}]+/gu, "").replace(/[^\p{L}\p{N}'’]+$/gu, ""))
      .filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      for (let j = words.length; j > i; j--) {
        const slice = words.slice(i, j);
        const first = slice[0].replace(/['’]$/, "");
        const last = slice[slice.length - 1].replace(/['’]$/, "");
        if (EDGE_STOPWORDS.has(first) || EDGE_STOPWORDS.has(last)) continue;
        // Measurements that leaked into a name ("two 9-inch cake pans") are
        // not something a step refers to by number.
        if (slice.some((word) => /\d/.test(word))) continue;
        if (slice.length === 1) {
          const word = slice[0];
          // A lone word must plausibly name a food: long enough to be
          // distinctive, and not a pure descriptor.
          if (word.length < 3 || QUALIFIERS.has(word)) continue;
        }
        terms.add(slice.join(" "));
      }
    }
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

function termToRegExp(term: string): RegExp {
  const words = term.split(" ");
  const pattern = words
    .map((word, i) => {
      const escaped = word
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/['’]/g, "['’]");
      // An elided article runs straight into the next word ("d'œufs"), so
      // whitespace after it is optional; everywhere else it's required.
      const separator = i === 0 ? "" : words[i - 1].endsWith("'") ? "\\s*" : "\\s+";
      return separator + numberAgnostic(escaped);
    })
    .join("");
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

  // Which ingredients answer to each phrase. Built once for the whole list so
  // a phrase several of them share is matched a single time, carrying all of
  // them, rather than once per owner.
  const owners = new Map<string, (string | number)[]>();
  for (const ingredient of ingredients) {
    for (const term of buildTerms(ingredient.name)) {
      const ids = owners.get(term) ?? [];
      if (!ids.includes(ingredient.id)) ids.push(ingredient.id);
      owners.set(term, ids);
    }
  }

  const hits: { start: number; end: number; ingredientIds: (string | number)[] }[] = [];
  for (const [term, ids] of owners) {
    for (const m of folded.matchAll(termToRegExp(term))) {
      hits.push({ start: m.index!, end: m.index! + m[0].length, ingredientIds: ids });
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
      ingredientIds: hit.ingredientIds,
    });
    cursor = hit.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
