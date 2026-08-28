// Pulling recipes out of a cookbook page with the Claude API.
//
// This exists because the deterministic path can't do it for real books.
// recipeText.ts works when a page holds one recipe in one column; measured
// against an actual cookbook, 77% of recipes shared a page with another — one
// page held eight — and nothing in flat text says which ingredient belongs to
// which recipe. Single-recipe pages fared no better: a two-column layout with
// no clear gutter merged method text into the ingredient list.
//
// So extraction is asked for a whole page at once, not a recipe at a time.
// That is both cheaper (one call for eight recipes instead of eight) and more
// accurate: the model sees the page as laid out and can attribute ingredients
// correctly, which is exactly the judgement the heuristics lack.
//
// The prompt building and response mapping are pure and exported separately
// from the call itself, so they can be tested without a network or a key.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ImportedRecipe } from "./recipeImport";

/** Extraction is where structure and judgement matter; the index pass is not. */
export const EXTRACTION_MODEL = "claude-sonnet-5";

/**
 * The 17 seeded aisles from schema.sql.
 *
 * Given to the model so it can categorize ingredients as it goes. The grocery
 * list can resolve an aisle itself via food_dictionary, but only for foods it
 * knows; a cookbook brings in plenty it doesn't, and a wrong-but-plausible
 * guess here is better than "Autres / Non classé" for all of them.
 */
export const AISLE_CATEGORIES = [
  "Fruits et légumes",
  "Viandes et poissons",
  "Charcuterie / Traiteur",
  "Produits laitiers et œufs",
  "Boulangerie et pain",
  "Surgelés",
  "Pâtes et sauces",
  "Conserves et soupes",
  "Pâtisserie et épices",
  "Condiments et vinaigrettes",
  "Collations",
  "Céréales et déjeuner",
  "Boissons",
  "Cuisine internationale",
  "Ménager et papier",
  "Santé et beauté",
  "Autres / Non classé",
] as const;

const IngredientSchema = z.object({
  name: z.string().describe("Ingredient name as printed, without the quantity"),
  quantity: z.number().nullable().describe("Numeric amount, or null if none given"),
  unit: z.string().nullable().describe("Unit as printed (g, ml, tasse, c. à soupe…)"),
  aisle_category: z
    .enum(AISLE_CATEGORIES)
    .nullable()
    .describe("Grocery aisle this ingredient belongs to"),
});

const ExtractedRecipeSchema = z.object({
  title: z.string().describe("The recipe title exactly as printed"),
  description: z.string().nullable(),
  servings: z.number().nullable(),
  prep_time: z.number().nullable().describe("Preparation time in minutes"),
  cook_time: z.number().nullable().describe("Cooking time in minutes"),
  ingredients: z.array(IngredientSchema),
  steps: z.array(z.string()).describe("Method steps, in order, one per step"),
  tags: z.array(z.string()),
});

const PageSchema = z.object({
  recipes: z.array(ExtractedRecipeSchema),
});

export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;

// Written in English on purpose. The first version was in French, and the
// model translated an English cookbook into French despite a rule telling it
// not to — a prompt written wholly in one language is itself an instruction to
// answer in that language, and it drowned out the bullet point. The rule is
// now first, stated twice, and no longer fighting the language it is written
// in. The user's decision was to keep a book's own words: English ingredient
// names already match food_dictionary's EN aliases, so translating them would
// break grocery categorisation as well as being unfaithful to the book.
const SYSTEM_PROMPT = `You extract recipes from the raw text of a cookbook page.

NEVER TRANSLATE. Reproduce titles, ingredients and steps in the language the
book is written in. If the page is in English, every string you return must be
in English. This overrides any impulse to answer in the language of these
instructions.

The text comes from a PDF: columns may be interleaved, words hyphenated across
line ends, and fragments of one column may appear inside another. Reconstruct
the meaning rather than copying the lines.

Rules:
- Keep the book's original language. Do not translate, localise, or convert
  units. "2 Tbsp soy sauce" stays "2 Tbsp soy sauce".
- A page may hold several recipes. Return them all, separately.
- Never invent an ingredient or a step that is not in the text.
- Attribute each ingredient to the right recipe. This matters most: do not mix
  the ingredients of two neighbouring recipes.
- Ignore page numbers, running section headers, photo captions, and
  introductory prose that belongs to no recipe.
- A line listing a dish's components ("rice + chicken + avocado") is a
  description, not a step.
- Some books print a summary of operations ("1. Cook the lamb, 2. Cook the
  eggplant…") before the detailed instructions, which are often grouped by
  component ("FOR THE LAMB: …"). The recipe's steps are the detailed
  instructions, not the summary: ignore the summary.
- Break the method into real steps — one action per step. Never return the
  whole method as a single block.
- The text may span several pages: a page can begin mid-sentence, or be a
  photograph with no text. Join it back together.
- If the page holds no complete recipe, return an empty list.

The aisle_category field is the one exception: it is a fixed French list and
must be chosen from it, whatever the book's language.`;

/**
 * Builds the request for one page.
 *
 * `expectedTitles` comes from the book's own table of contents, which already
 * says what should be on this page. Giving the model that list is what keeps a
 * page of eight recipes from coming back as three: it knows what to look for.
 */
export function buildExtractionPrompt(
  pageText: string,
  expectedTitles: string[]
): string {
  // English, like the system prompt. A French request wrapped around English
  // book text is the same nudge that made the model translate a whole book.
  const expected = expectedTitles.length
    ? `\n\nThe table of contents says this page should contain:\n${expectedTitles
        .map((t) => `- ${t}`)
        .join("\n")}\n\nReturn one entry per recipe actually present in the text.`
    : "";
  return `Here is the text of a page:\n\n---\n${pageText}\n---${expected}`;
}

/**
 * An imported recipe plus the aisle the model assigned to each ingredient.
 *
 * ImportedRecipe's own ingredients carry no aisle — the URL and PDF importers
 * have no way to know one — so this widens that field rather than intersecting
 * with it, which would silently keep the narrower type.
 */
export interface ExtractedImportedRecipe extends Omit<ImportedRecipe, "ingredients"> {
  ingredients: {
    name: string;
    quantity?: number;
    unit?: string;
    aisle_category?: string;
  }[];
}

/** Maps one extracted recipe onto the shape the rest of the app already uses. */
export function toImportedRecipe(recipe: ExtractedRecipe): ExtractedImportedRecipe {
  return {
    title: recipe.title,
    description: recipe.description ?? undefined,
    servings: recipe.servings ?? undefined,
    prep_time: recipe.prep_time ?? undefined,
    cook_time: recipe.cook_time ?? undefined,
    ingredients: recipe.ingredients
      .filter((i) => i.name.trim())
      .map((i) => ({
        name: i.name.trim(),
        quantity: i.quantity ?? undefined,
        unit: i.unit ?? undefined,
        aisle_category: i.aisle_category ?? undefined,
      })),
    steps: recipe.steps.filter((s) => s.trim()),
    tags: recipe.tags.filter((t) => t.trim()),
    source: "pdf",
  };
}

export interface ExtractionUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ExtractionResult {
  recipes: ExtractedRecipe[];
  usage: ExtractionUsage;
}

/**
 * Asks Claude for every recipe on one page.
 *
 * Throws with a French message the UI can show directly — including for a
 * missing key, since the free path has to keep working on an install that
 * never sets one.
 */
export async function extractRecipesFromPage(
  apiKey: string | undefined,
  pageText: string,
  expectedTitles: string[]
): Promise<ExtractionResult> {
  if (!apiKey) {
    throw new Error(
      "L'extraction par IA n'est pas configurée sur ce serveur (clé ANTHROPIC_API_KEY absente)."
    );
  }

  const client = new Anthropic({ apiKey });
  let response;
  try {
    response = await client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildExtractionPrompt(pageText, expectedTitles) },
      ],
      output_config: { format: zodOutputFormat(PageSchema) },
    });
  } catch (err) {
    throw new Error(describeApiError(err));
  }

  // parsed_output is null when the response didn't satisfy the schema.
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("La réponse de l'IA n'a pas pu être interprétée.");
  }

  return {
    recipes: parsed.recipes,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

/**
 * Turns an SDK error into a French sentence saying what to do about it.
 *
 * The raw errors are a JSON blob wrapped in a status code, which is no use to
 * someone halfway through importing a book. Billing and auth are the two that
 * actually happen, and both have a specific remedy worth naming.
 */
export function describeApiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (/credit balance is too low|insufficient.*credit/i.test(raw)) {
    return "Crédit Anthropic insuffisant. Ajoutez des crédits à votre compte API (console.anthropic.com, Plans & Billing) — un abonnement Claude Pro ou Max ne couvre pas l'API.";
  }
  if (/authentication_error|invalid x-api-key|401/i.test(raw)) {
    return "Clé API refusée. Vérifiez ANTHROPIC_API_KEY (console.anthropic.com, API keys).";
  }
  if (/content filtering policy|output blocked/i.test(raw)) {
    return "L'IA a refusé de répondre pour cette page (filtrage de contenu côté Anthropic). C'est propre à ce texte : les autres pages continueront de fonctionner, et cette recette peut être saisie à la main.";
  }
  if (/rate_limit|429/i.test(raw)) {
    return "Limite de débit atteinte chez Anthropic. Attendez quelques instants puis reprenez : les recettes déjà importées ne seront pas refacturées.";
  }
  if (/overloaded|529/i.test(raw)) {
    return "L'API Anthropic est surchargée. Réessayez dans un moment.";
  }
  // Anything else: keep the real message, which app.onError already surfaces.
  return `Échec de l'extraction : ${raw}`;
}

/**
 * What a page cost, in US dollars, at Claude Sonnet 5's published rates
 * ($2 per Mtok in, $10 per Mtok out).
 *
 * Shown so a book's import has a running total rather than an invoice later.
 */
export function estimateCost(usage: ExtractionUsage): number {
  return (usage.input_tokens / 1_000_000) * 2 + (usage.output_tokens / 1_000_000) * 10;
}
