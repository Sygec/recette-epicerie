// Turns the flat text of a recipe document into the same preview shape a URL
// import produces.
//
// URL import works because recipe sites publish schema.org JSON-LD — it reads
// structured data rather than interpreting a page. A PDF has none of that, so
// everything here is heuristic: find the section headings, then classify lines
// by shape. recipeImport.ts already says there is "no generically reliable way
// to find 'the' ingredient list in arbitrary unstructured HTML"; flat text
// poses the same problem, and the honest response is to guess visibly and let
// the user correct it before saving, which the import flow already requires.
//
// Deliberately pure: text in, preview out, no bindings and no I/O. Extraction
// is somebody else's job — the browser reads the PDF (frontend/src/lib/
// pdfText.ts) and posts the text — which keeps all of this unit-testable and
// means the source of the text could change without touching any of it.

import {
  ImportedIngredient,
  ImportedRecipe,
  splitIngredientLine,
} from "./recipeImport";
import { normalizeFoodIdentity } from "./foodDictionary";

// Matched against accent- and case-folded lines, so "Ingrédients",
// "INGREDIENTS" and "ingredients" are one thing.
const INGREDIENT_HEADINGS = [
  "ingredients",
  "ingredient",
  "vous aurez besoin de",
  "you will need",
];

const STEP_HEADINGS = [
  "preparation",
  "preparations",
  "etapes",
  "instructions",
  "instruction",
  "methode",
  "method",
  "directions",
  "direction",
  "steps",
  "step",
  "montage",
  "assembly",
];

// Headings that end the part of the document worth reading. Notes and
// nutrition tables trail most printed recipes and would otherwise be swept up
// as steps.
const TRAILING_HEADINGS = [
  "notes",
  "note",
  "valeurs nutritives",
  "nutrition",
  "nutrition facts",
  "informations nutritionnelles",
];

/** Strips Markdown decoration without touching the words. */
function stripMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/(^|\s)[*_](\S)/g, "$1$2")
    .replace(/(\S)[*_](\s|$)/g, "$1$2")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .trim();
}

/** True for a line that is only page furniture — a bare number, a rule. */
function isNoise(line: string): boolean {
  if (!line) return true;
  if (/^\d{1,3}$/.test(line)) return true; // page number
  if (/^[-—_=|\s]+$/.test(line)) return true; // horizontal rule / empty table row
  if (/^page\s+\d+/i.test(line)) return true;
  return false;
}

/**
 * Which section a line opens, if any. A heading is short and matches one of
 * the known words — "Ingrédients", "Ingrédients :", "## Ingredients" — but a
 * step that happens to say "instructions" mid-sentence is not a heading.
 */
function headingKind(line: string): "ingredients" | "steps" | "trailing" | null {
  const folded = normalizeFoodIdentity(line.replace(/[:：.]+\s*$/, ""));
  if (!folded || folded.length > 40) return null;
  if (INGREDIENT_HEADINGS.includes(folded)) return "ingredients";
  if (STEP_HEADINGS.includes(folded)) return "steps";
  if (TRAILING_HEADINGS.includes(folded)) return "trailing";
  // "Préparation : 20 minutes" is metadata, not the steps heading — the
  // metadata scan below picks it up and it must not open a section here.
  return null;
}

/** Lines that repeat on most pages are a running header or footer. */
function dropRepeatedLines(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.length < 4) continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return lines.filter((line) => (counts.get(line) ?? 0) < 3);
}

const MINUTES_PER_UNIT: Record<string, number> = {
  h: 60,
  hr: 60,
  hrs: 60,
  heure: 60,
  heures: 60,
  hour: 60,
  hours: 60,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
};

/** "1 h 15", "20 minutes", "1 hour 30 mins" -> minutes. */
function parseDuration(text: string): number | undefined {
  // "1 h 30" leaves the minutes bare, so the general number+unit scan below
  // would read only the hour.
  const hoursThenBare = text.match(/(\d+)\s*(?:h|hrs?|heures?|hours?)\s*(\d{1,2})(?!\s*\p{L})/u);
  if (hoursThenBare) {
    return Number(hoursThenBare[1]) * 60 + Number(hoursThenBare[2]);
  }

  let total = 0;
  let found = false;
  const pattern = /(\d+(?:[.,]\d+)?)\s*([a-zà-ÿ]+)/gi;
  for (const m of text.matchAll(pattern)) {
    const factor = MINUTES_PER_UNIT[m[2].toLowerCase()];
    if (factor === undefined) continue;
    total += parseFloat(m[1].replace(",", ".")) * factor;
    found = true;
  }
  return found ? Math.round(total) : undefined;
}

interface Metadata {
  servings?: number;
  prep_time?: number;
  cook_time?: number;
}

// Printed recipes put servings and times in a header band with no section
// heading of its own — sometimes one per line, but often all on a single line
// ("Portions : 6  Préparation : 20 minutes  Cuisson : 25 minutes"). So each
// label claims only the text up to the next label, rather than the rest of the
// line: summing every duration on the line gave prep and cook the same wrong
// total.
const METADATA_LABELS: { key: keyof Metadata; pattern: RegExp }[] = [
  { key: "servings", pattern: /portions?|servings?|rendement|donne|yield|serves/giu },
  { key: "prep_time", pattern: /pr[ée]paration|prep(?:\s+time)?/giu },
  { key: "cook_time", pattern: /cuisson|cook(?:ing)?(?:\s+time)?|bake\s+time/giu },
];

interface LabelHit {
  key: keyof Metadata;
  start: number;
  end: number;
}

/** Where each metadata label sits on a line, in reading order. */
function findLabels(line: string): LabelHit[] {
  const hits: LabelHit[] = [];
  for (const { key, pattern } of METADATA_LABELS) {
    pattern.lastIndex = 0;
    for (const m of line.matchAll(pattern)) {
      hits.push({ key, start: m.index!, end: m.index! + m[0].length });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

function extractMetadata(lines: string[]): Metadata {
  const meta: Metadata = {};
  for (const line of lines) {
    const labels = findLabels(line);
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (meta[label.key] !== undefined) continue;
      // Only as far as the next label, so one label can't swallow another's
      // value.
      const segment = line.slice(label.end, labels[i + 1]?.start ?? line.length);
      if (label.key === "servings") {
        const m = segment.match(/\d+/);
        if (m) meta.servings = Number(m[0]);
      } else {
        const minutes = parseDuration(segment);
        if (minutes !== undefined) meta[label.key] = minutes;
      }
    }
  }
  return meta;
}

/** An ingredient-looking line: short, and led by a quantity or a bullet. */
function looksLikeIngredient(raw: string, stripped: string): boolean {
  if (stripped.length > 90) return false;
  if (/^\s*[-*+•]\s+/.test(raw)) return true;
  return /^\d|^[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/.test(stripped);
}

/**
 * Rejoins lines the document wrapped mid-sentence. A step continues onto the
 * next line when it doesn't end in terminal punctuation and the next line
 * doesn't start a new numbered step.
 */
function joinWrappedSteps(lines: string[]): string[] {
  const steps: string[] = [];
  for (const line of lines) {
    const startsNew = /^\s*(?:\d+[.)]|étape\s+\d+|step\s+\d+)/i.test(line);
    const previous = steps[steps.length - 1];
    if (!startsNew && previous && !/[.!?:]$/.test(previous)) {
      steps[steps.length - 1] = `${previous} ${stripMarkdown(line)}`.trim();
      continue;
    }
    const text = stripMarkdown(line);
    if (text) steps.push(text);
  }
  return steps;
}

export interface ParsedRecipeText extends ImportedRecipe {
  source: "pdf";
}

/**
 * Best-effort recipe from flat document text.
 *
 * Sets `warning` whenever the result is thin enough that the user should not
 * trust it at a glance — no ingredients, no steps, or no headings to go on.
 * Guessing quietly would be worse than guessing out loud.
 */
export function parseRecipeText(text: string): ParsedRecipeText {
  const rawLines = dropRepeatedLines(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => !isNoise(stripMarkdown(line)))
  );

  const meta = extractMetadata(rawLines);

  // Partition on the section headings.
  let ingredientStart = -1;
  let stepStart = -1;
  let endOfBody = rawLines.length;
  for (let i = 0; i < rawLines.length; i++) {
    const kind = headingKind(stripMarkdown(rawLines[i]));
    if (kind === "ingredients" && ingredientStart === -1) ingredientStart = i;
    else if (kind === "steps" && stepStart === -1 && i > ingredientStart) stepStart = i;
    else if (kind === "trailing" && stepStart !== -1 && endOfBody === rawLines.length) {
      endOfBody = i;
    }
  }

  const hasHeadings = ingredientStart !== -1 || stepStart !== -1;
  let ingredientLines: string[];
  let stepLines: string[];

  if (hasHeadings) {
    const ingredientEnd = stepStart !== -1 ? stepStart : endOfBody;
    ingredientLines =
      ingredientStart === -1 ? [] : rawLines.slice(ingredientStart + 1, ingredientEnd);
    stepLines = stepStart === -1 ? [] : rawLines.slice(stepStart + 1, endOfBody);
  } else {
    // No headings to go on: sort by line shape instead. Short lines led by a
    // quantity are ingredients, everything else of substance is a step.
    ingredientLines = [];
    stepLines = [];
    for (const line of rawLines.slice(1)) {
      const stripped = stripMarkdown(line);
      if (!stripped) continue;
      if (looksLikeIngredient(line, stripped)) ingredientLines.push(line);
      else if (stripped.length > 30) stepLines.push(line);
    }
  }

  const ingredients: ImportedIngredient[] = ingredientLines
    .map((line) => stripMarkdown(line))
    .filter((line) => line && !isNoise(line) && headingKind(line) === null)
    .map((line) => splitIngredientLine(line));

  const steps = joinWrappedSteps(stepLines).filter((step) => step.length > 2);

  // The title is the first substantial line above the ingredients — usually a
  // Markdown H1, otherwise just the first thing on the page.
  const titleCandidates = rawLines.slice(
    0,
    ingredientStart === -1 ? Math.min(rawLines.length, 5) : ingredientStart
  );
  const heading = titleCandidates.find((line) => /^#\s+\S/.test(line));
  const title =
    stripMarkdown(heading ?? "") ||
    titleCandidates.map(stripMarkdown).find((line) => line.length > 2 && !/[:：]$/.test(line)) ||
    "Recette importée";

  const warnings: string[] = [];
  if (!hasHeadings) {
    warnings.push(
      "Aucune section « Ingrédients » ou « Préparation » n'a été trouvée — le découpage est approximatif."
    );
  }
  if (!ingredients.length) warnings.push("Aucun ingrédient n'a pu être détecté.");
  if (!steps.length) warnings.push("Aucune étape n'a pu être détectée.");

  return {
    title,
    servings: meta.servings,
    prep_time: meta.prep_time,
    cook_time: meta.cook_time,
    ingredients,
    steps,
    tags: [],
    source: "pdf",
    ...(warnings.length
      ? { warning: `${warnings.join(" ")} Vérifiez et complétez avant d'enregistrer.` }
      : {}),
  };
}
