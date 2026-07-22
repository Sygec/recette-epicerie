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
  "clove", "cloves", "pinch", "slice", "slices", "can", "cans",
  "package", "packages",
]);

// French units are often multi-word ("c. à soupe", "cuillère à café") — check
// these as whole phrases before falling back to the single-token check below,
// longest first so "cuillères à soupe" doesn't get cut short.
const MULTI_WORD_UNITS = [
  "cuillères à soupe", "cuillères à café", "cuillères à thé",
  "cuillère à soupe", "cuillère à café", "cuillère à thé",
  "c. à soupe", "c. à café", "c. à thé",
];

// French ingredient lines routinely read "<qty> <unit> de <name>" ("250 g de
// farine"); strip that connector so the extracted name is just "farine".
function stripLeadingConnector(text: string): string {
  return text.trim().replace(/^(de\s+|d['’]\s*)/i, "").trim();
}

function parseLeadingQuantity(text: string): number | undefined {
  if (text.includes("/")) {
    const [num, den] = text.split("/").map(Number);
    return den ? num / den : undefined;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : undefined;
}

export function splitIngredientLine(line: string): ImportedIngredient {
  const trimmed = line.trim().replace(/\s+/g, " ");
  const match = trimmed.match(
    /^(\d+(?:[.,]\d+)?(?:\s*[-–à]\s*\d+(?:[.,]\d+)?)?|\d+\/\d+)\s*(.*)$/
  );
  if (!match) return { name: trimmed };

  const quantity = parseLeadingQuantity(match[1].replace(",", "."));
  const rest = match[2];
  if (quantity === undefined || !rest) return { name: trimmed };

  const lowerRest = rest.toLowerCase();
  for (const phrase of MULTI_WORD_UNITS) {
    if (lowerRest.startsWith(phrase)) {
      const name = stripLeadingConnector(rest.slice(phrase.length));
      return { name: name || rest, quantity, unit: rest.slice(0, phrase.length) };
    }
  }

  const restMatch = rest.match(/^(\S+)\s+(.*)$/);
  if (restMatch && KNOWN_UNITS.has(restMatch[1].toLowerCase().replace(/\.$/, ""))) {
    const name = stripLeadingConnector(restMatch[2]);
    return { name: name || restMatch[2], quantity, unit: restMatch[1] };
  }
  return { name: rest, quantity };
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
    title: typeof node.name === "string" ? node.name : "Recette importée",
    description: typeof node.description === "string" ? node.description : undefined,
    servings: parseServings(node.recipeYield),
    prep_time: parseIsoDurationToMinutes(node.prepTime),
    cook_time: parseIsoDurationToMinutes(node.cookTime),
    ingredients: (rawIngredients as unknown[])
      .filter((i): i is string => typeof i === "string")
      .map(splitIngredientLine),
    steps: flattenInstructions(node.recipeInstructions),
    tags: extractTags(node.keywords ?? node.recipeCategory),
    image_url: extractImageUrl(node.image),
    source: "json-ld",
  };
}

export function mapFallbackToRecipe(extracted: ExtractedHtml): ImportedRecipe | undefined {
  const title = extracted.ogTitle ?? extracted.pageTitle;
  if (!title) return undefined;
  return {
    title,
    description: extracted.ogDescription,
    ingredients: [],
    steps: [],
    tags: [],
    image_url: extracted.ogImage,
    source: "fallback",
  };
}
