// Extracts recipe data from a fetched web page.
//
// Primary path: schema.org Recipe JSON-LD. Recipe sites publish this for
// Google's rich-snippet eligibility, so it's present in the raw
// server-rendered HTML even on JS-heavy sites — Google requires it to appear
// without executing JS, which makes it far more reliable here than trying to
// scrape rendered DOM content generically.
//
// Fallback path: Open Graph meta tags (title/description/image), for pages
// that don't publish structured recipe data. This never yields ingredients
// or steps — there's no generically reliable way to find "the" ingredient
// list in arbitrary unstructured HTML — so the caller should tell the user
// those need to be entered by hand.

export interface ImportedIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface ImportedRecipe {
  title: string;
  description?: string;
  servings?: number;
  prep_time?: number;
  cook_time?: number;
  ingredients: ImportedIngredient[];
  steps: string[];
  tags: string[];
  image_url?: string;
  source: "json-ld" | "fallback";
}

// Only http(s) URLs should ever be handed to a server-side fetch() here —
// this endpoint takes user-supplied URLs and fetches them itself, so the
// scheme must be constrained regardless of what a client sends.
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// HTML extraction (HTMLRewriter — the Workers-native streaming HTML parser;
// no DOM/Node HTML library needed or available in this runtime)
// ---------------------------------------------------------------------------

export interface ExtractedHtml {
  jsonLdBlocks: string[];
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  pageTitle?: string;
}

export async function extractFromHtml(response: Response): Promise<ExtractedHtml> {
  const jsonLdBlocks: string[] = [];
  const result: ExtractedHtml = { jsonLdBlocks };

  let currentBlock = "";
  let inJsonLd = false;
  let titleBuf = "";

  const rewriter = new HTMLRewriter()
    .on('script[type="application/ld+json"]', {
      element() {
        inJsonLd = true;
        currentBlock = "";
      },
      text(chunk) {
        if (!inJsonLd) return;
        currentBlock += chunk.text;
        if (chunk.lastInTextNode) {
          jsonLdBlocks.push(currentBlock);
          currentBlock = "";
          inJsonLd = false;
        }
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        result.ogTitle = el.getAttribute("content") ?? result.ogTitle;
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        result.ogDescription = el.getAttribute("content") ?? result.ogDescription;
      },
    })
    .on('meta[property="og:image"]', {
      element(el) {
        result.ogImage = el.getAttribute("content") ?? result.ogImage;
      },
    })
    .on("title", {
      text(chunk) {
        titleBuf += chunk.text;
        if (chunk.lastInTextNode) result.pageTitle = titleBuf.trim();
      },
    });

  const transformed = rewriter.transform(response);
  await transformed.text(); // drain the stream to actually run the handlers above
  return result;
}

// ---------------------------------------------------------------------------
// JSON-LD: locate the Recipe node, wherever it's nested
// ---------------------------------------------------------------------------

type JsonLdNode = Record<string, unknown>;

function typeIncludes(node: JsonLdNode, typeName: string): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t === typeName;
  if (Array.isArray(t)) return t.includes(typeName);
  return false;
}

// A page can have multiple <script type="application/ld+json"> blocks
// (Organization, BreadcrumbList, WebSite...), and the Recipe node itself may
// be a bare top-level object, one entry in a top-level array, or nested
// inside an @graph array (common with WordPress SEO plugins).
function findRecipeNode(data: unknown): JsonLdNode | undefined {
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return undefined;
  }
  if (data && typeof data === "object") {
    const node = data as JsonLdNode;
    if (typeIncludes(node, "Recipe")) return node;
    if (Array.isArray(node["@graph"])) return findRecipeNode(node["@graph"]);
  }
  return undefined;
}

export function findRecipeInJsonLd(blocks: string[]): JsonLdNode | undefined {
  for (const block of blocks) {
    try {
      const found = findRecipeNode(JSON.parse(block));
      if (found) return found;
    } catch {
      // Not valid JSON, or not shaped like we expect — skip this block.
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Field mapping helpers
// ---------------------------------------------------------------------------

function parseIsoDurationToMinutes(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(
    /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/
  );
  if (!match) return undefined;
  const hours = match[1] ? parseFloat(match[1]) : 0;
  const minutes = match[2] ? parseFloat(match[2]) : 0;
  const seconds = match[3] ? parseFloat(match[3]) : 0;
  const total = Math.round(hours * 60 + minutes + seconds / 60);
  return total > 0 ? total : undefined;
}

function parseServings(value: unknown): number | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text === "number") return Math.round(text);
  if (typeof text !== "string") return undefined;
  const match = text.match(/\d+/);
  return match ? parseInt(match[0], 10) : undefined;
}

function extractImageUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractImageUrl(item);
      if (url) return url;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const obj = value as JsonLdNode;
    if (typeof obj.url === "string") return obj.url;
  }
  return undefined;
}

// recipeInstructions varies wildly across sites: a plain string, an array of
// strings, an array of HowToStep objects, or HowToSection objects nesting
// their own itemListElement array of steps. Flatten all of these into an
// ordered list of step text.
function flattenInstructions(value: unknown): string[] {
  const steps: string[] = [];

  function visit(node: unknown) {
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (!trimmed) return;
      // Some sites put every step in one blob string; newlines are the only
      // signal we have to split it back into individual steps.
      if (trimmed.includes("\n")) {
        trimmed
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((s) => steps.push(s));
      } else {
        steps.push(trimmed);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as JsonLdNode;
      if (Array.isArray(obj.itemListElement)) {
        visit(obj.itemListElement); // HowToSection
        return;
      }
      if (typeof obj.text === "string") {
        visit(obj.text); // HowToStep
        return;
      }
      if (typeof obj.name === "string") visit(obj.name);
    }
  }

  visit(value);
  return steps;
}

// WordPress recipe plugins (Tasty Recipes among them) sometimes emit
// HTML-entity-encoded text inside JSON-LD string values, even though
// schema.org expects plain text there — e.g. a literal "&amp;" or "&#8217;"
// showing up in an ingredient line instead of "&" or an apostrophe. Decode
// the common named entities plus any numeric entity generically.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (full, name) => NAMED_ENTITIES[name.toLowerCase()] ?? full);
}

function extractTags(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").slice(0, 8);
  }
  return [];
}

// Best-effort split of a free-text ingredient line ("2 cups flour", "500 g de
// farine") into quantity/unit/name. Deliberately conservative: if the
// pattern doesn't clearly match, the whole line is kept as the name rather
// than guessing wrong — this is a convenience for the review step in the
// form, not a guarantee, and the user can always fix it there before saving.
const KNOWN_UNITS = new Set([
  "g", "kg", "ml", "l", "cl",
  "cs", "cc", "tasse", "tasses", "cuillère", "cuillères",
  "pincée", "gousse", "gousses", "tranche", "tranches",
  "sachet", "sachets", "boîte", "boîtes", "botte", "bottes",
  "cup", "cups", "tbsp", "tsp", "oz", "lb", "lbs",
  "teaspoon", "teaspoons", "tablespoon", "tablespoons",
  "pound", "pounds", "ounce", "ounces", "quart", "quarts",
  "pint", "pints", "gram", "grams", "kilogram", "kilograms",
  "stick", "sticks",
  "clove", "cloves", "pinch", "slice", "slices", "can", "cans",
  "package", "packages",
]);

// French/English units are often multi-word ("c. à soupe", "cuillère à
// café") — check these as whole phrases before falling back to the
// single-token check below, longest first so "cuillères à soupe" doesn't
// get cut short.
const MULTI_WORD_UNITS = [
  "cuillères à soupe", "cuillères à café", "cuillères à thé",
  "cuillère à soupe", "cuillère à café", "cuillère à thé",
  "c. à soupe", "c. à café", "c. à thé",
];

// "<qty> <unit> de/d' <name>" (French) or "<qty> <unit> of <name>" (English)
// is extremely common; strip the connector so the extracted name is just
// "farine" / "flour", not "de farine" / "of flour".
function stripLeadingConnector(text: string): string {
  return text
    .trim()
    .replace(/^(de\s+|d['’]\s*|of\s+)/i, "")
    .trim();
}

// Everything between the primary unit and the real ingredient name is
// measurement info to preserve, not discard — but it can take more than one
// shape, and shapes can chain: a leading parenthetical ("2 cups (250g)
// flour"), a second bare "<number> <unit>" descriptor before its own
// parenthetical ("1 can 796 ml (28 oz) crushed tomatoes"), or — in French —
// both stacked behind two separate "de" connectors ("1 boîte de 796 ml
// (28 oz) de tomates broyées": "a can OF 796ml (28oz) OF crushed tomatoes").
// Real ingredient names never start with a digit or an open paren, so
// anything matching those shapes at this position is measurement info;
// loop until neither shape (nor a connector introducing one) matches
// anymore, collecting each piece to append at the end instead of losing it.
function extractName(text: string): string {
  let working = text.trim();
  const extras: string[] = [];

  for (let i = 0; i < 3; i++) {
    working = stripLeadingConnector(working);

    const sizeMatch = working.match(
      /^(\d+(?:[.,]\d+)?\s*\p{L}+\.?)(?:\s*\(([^)]*)\))?\s*(.*)$/u
    );
    if (sizeMatch) {
      extras.push(sizeMatch[1]);
      if (sizeMatch[2]) extras.push(sizeMatch[2]);
      working = sizeMatch[3];
      continue;
    }

    const parenMatch = working.match(/^\(([^)]*)\)\s*(.*)$/);
    if (parenMatch) {
      extras.push(parenMatch[1]);
      working = parenMatch[2];
      continue;
    }

    break;
  }

  const name = working.trim();
  return extras.length ? `${name || working} (${extras.join("; ")})` : name;
}

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅓": 1 / 3, "⅔": 2 / 3,
  "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
  "⅙": 1 / 6, "⅚": 5 / 6,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};
const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join("");

// Tries the most specific quantity shapes first (mixed numbers, fractions)
// before falling back to a plain decimal/range — each attempt is a whole,
// anchored regex rather than one big alternation, so a partial match on a
// simpler shape (e.g. the "3" in "3/4") never wins over the shape that
// actually describes the whole quantity. Returns the parsed value and
// however much of the leading text it consumed.
function parseLeadingQuantity(
  text: string
): { value: number; consumed: number } | undefined {
  // "1 and 3/4" — a mixed number spelled out with "and", common in US baking
  // blogs.
  let m = text.match(/^(\d+)\s+and\s+(\d+)\/(\d+)/i);
  if (m) {
    const [whole, num, den] = [m[1], m[2], m[3]].map(Number);
    return { value: whole + num / den, consumed: m[0].length };
  }

  // "1 1/2" — a mixed number written with a space.
  m = text.match(/^(\d+)\s+(\d+)\/(\d+)(?=\s|$)/);
  if (m) {
    const [whole, num, den] = [m[1], m[2], m[3]].map(Number);
    return { value: whole + num / den, consumed: m[0].length };
  }

  // "1½" or "1 ½" — a whole number followed directly by a unicode fraction.
  m = text.match(new RegExp(`^(\\d+)\\s*([${UNICODE_FRACTION_CHARS}])`));
  if (m) {
    return {
      value: Number(m[1]) + UNICODE_FRACTIONS[m[2]],
      consumed: m[0].length,
    };
  }

  // "½" alone.
  m = text.match(new RegExp(`^([${UNICODE_FRACTION_CHARS}])`));
  if (m) return { value: UNICODE_FRACTIONS[m[1]], consumed: m[0].length };

  // "3/4" — a bare fraction.
  m = text.match(/^(\d+)\/(\d+)/);
  if (m) return { value: Number(m[1]) / Number(m[2]), consumed: m[0].length };

  // "2", "2.5", "2-3" (a range keeps only its first number).
  m = text.match(/^(\d+(?:[.,]\d+)?)(?:\s*[-–à]\s*\d+(?:[.,]\d+)?)?/);
  if (m) return { value: parseFloat(m[1].replace(",", ".")), consumed: m[0].length };

  return undefined;
}

export function splitIngredientLine(line: string): ImportedIngredient {
  const trimmed = line.trim().replace(/\s+/g, " ");
  const parsed = parseLeadingQuantity(trimmed);
  if (!parsed) return { name: trimmed };

  // Fraction-derived quantities (1/3 -> 0.3333...) round to 2 decimals for a
  // presentable form value; real-world quantities never need more precision.
  const quantity = Math.round(parsed.value * 100) / 100;
  const rest = trimmed.slice(parsed.consumed).trim();
  if (!rest) return { name: trimmed };

  const lowerRest = rest.toLowerCase();
  for (const phrase of MULTI_WORD_UNITS) {
    if (lowerRest.startsWith(phrase)) {
      const name = extractName(rest.slice(phrase.length));
      return { name: name || rest, quantity, unit: rest.slice(0, phrase.length) };
    }
  }

  const restMatch = rest.match(/^(\S+)\s+(.*)$/);
  if (restMatch && KNOWN_UNITS.has(restMatch[1].toLowerCase().replace(/\.$/, ""))) {
    const name = extractName(restMatch[2]);
    return { name: name || restMatch[2], quantity, unit: restMatch[1] };
  }
  return { name: extractName(rest) || rest, quantity };
}

// ---------------------------------------------------------------------------
// Top-level mapping
// ---------------------------------------------------------------------------

export function mapJsonLdToRecipe(node: JsonLdNode): ImportedRecipe {
  const rawIngredients = Array.isArray(node.recipeIngredient)
    ? node.recipeIngredient
    : Array.isArray(node.ingredients)
      ? node.ingredients
      : [];

  return {
    title:
      typeof node.name === "string"
        ? decodeHtmlEntities(node.name)
        : "Recette importée",
    description:
      typeof node.description === "string"
        ? decodeHtmlEntities(node.description)
        : undefined,
    servings: parseServings(node.recipeYield),
    prep_time: parseIsoDurationToMinutes(node.prepTime),
    cook_time: parseIsoDurationToMinutes(node.cookTime),
    ingredients: (rawIngredients as unknown[])
      .filter((i): i is string => typeof i === "string")
      .map((i) => splitIngredientLine(decodeHtmlEntities(i))),
    steps: flattenInstructions(node.recipeInstructions).map(decodeHtmlEntities),
    tags: extractTags(node.keywords ?? node.recipeCategory).map(decodeHtmlEntities),
    image_url: extractImageUrl(node.image),
    source: "json-ld",
  };
}

export function mapFallbackToRecipe(extracted: ExtractedHtml): ImportedRecipe | undefined {
  const title = extracted.ogTitle ?? extracted.pageTitle;
  if (!title) return undefined;
  return {
    title: decodeHtmlEntities(title),
    description: extracted.ogDescription
      ? decodeHtmlEntities(extracted.ogDescription)
      : undefined,
    ingredients: [],
    steps: [],
    tags: [],
    image_url: extracted.ogImage,
    source: "fallback",
  };
}
