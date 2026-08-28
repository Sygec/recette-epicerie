// Looks up a cookbook's details from the open book databases.
//
// Same shape as recipeImport.ts: this file is pure — query strings in,
// mapped results out — and the fetching lives in the route. That keeps the
// awkward part (two providers with quite different JSON, both full of
// optional fields) unit-testable without a network.
//
// Open Library is tried first: no API key, no quota, and its cover images are
// served at a predictable URL. Google Books is the fallback because it knows
// about a lot of the smaller/self-published titles that turn up in bundles,
// and it carries a description where Open Library usually doesn't.

/** What both providers are flattened into, and what the form loads. */
export interface CookbookLookupResult {
  title: string;
  author?: string;
  publisher?: string;
  year?: number;
  isbn?: string;
  page_count?: number;
  description?: string;
  cover_url?: string;
  /** Which provider answered, so the UI can say where the data came from. */
  source: "openlibrary" | "googlebooks";
  /**
   * Open Library's work id, when it answered. Search results never carry a
   * description — it lives on the work record — so this is what makes a
   * second, cheap request for one possible.
   */
  work_key?: string;
}

/** The work-record URL behind a search hit, for the description search omits. */
export function buildOpenLibraryWorkUrl(workKey: string): string {
  return `https://openlibrary.org${workKey}.json`;
}

/**
 * Reads the description (and a subject or two) off an Open Library work.
 *
 * Descriptions arrive either as a plain string or as `{type, value}` depending
 * on the record's age, which is the only reason this needs a mapper at all.
 */
export function mapOpenLibraryWork(payload: unknown): {
  description?: string;
  tags?: string[];
} {
  const work = payload as
    | { description?: string | { value?: string }; subjects?: string[] }
    | null;
  if (!work) return {};

  const raw = typeof work.description === "string"
    ? work.description
    : work.description?.value;
  const description = raw?.trim();

  return stripUndefinedFrom({
    description: description && isSynopsis(description) ? description : undefined,
    // Open Library's subject list trails off into cataloguing noise
    // ("nyt:advice-how-to-and-miscellaneous=2017-05-14"), so keep the first
    // few plain ones.
    tags: work.subjects
      ?.filter((s) => typeof s === "string" && !s.includes(":") && s.length < 30)
      .slice(0, 4),
  });
}

/**
 * Rejects a "description" that is really a catalogue entry.
 *
 * Plenty of Open Library records put the physical description in that field,
 * so a lookup offers "160 pages : 24 cm" as the blurb for a cookbook. That is
 * worse than an empty box: it looks like data and has to be deleted by hand.
 */
export function isSynopsis(text: string): boolean {
  const trimmed = text.trim();
  // "160 pages : 24 cm", "xii, 320 p. ; 26 cm", "957 pages : illustrations"
  if (/^[\dxivl,\s]*\d+\s*(unnumbered\s+)?(pages?|p\.)/i.test(trimmed)) return false;
  if (/\d+\s*cm/i.test(trimmed) && trimmed.length < 120) return false;
  // A real blurb is a sentence, not a fragment.
  return trimmed.length >= 40;
}

function stripUndefinedFrom<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;
}

/**
 * The fields Open Library has to be asked for.
 *
 * Its search endpoint returns a trimmed record by default — ten fields, with
 * no publisher, ISBN, page count or cover among them — so a lookup came back
 * with little more than a year. Naming them explicitly is the difference
 * between "Bowls!, 2017" and a filled-in form.
 */
const OPEN_LIBRARY_FIELDS = [
  "key",
  "title",
  "subtitle",
  "author_name",
  "publisher",
  "first_publish_year",
  "isbn",
  "number_of_pages_median",
  "cover_i",
].join(",");

export function buildOpenLibraryUrl(query: string, isbn?: string): string {
  const fields = `&fields=${OPEN_LIBRARY_FIELDS}&limit=5`;
  if (isbn) {
    const clean = normalizeIsbn(isbn);
    if (clean) return `https://openlibrary.org/search.json?isbn=${clean}${fields}`;
  }
  return `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}${fields}`;
}

/**
 * Combines what two providers know about the same book.
 *
 * Neither has everything: Open Library is reliable for publisher and ISBN and
 * serves covers at a predictable URL, while Google Books is where the
 * description and the page count usually are. Asking both and taking whichever
 * answered first — which is what this did — threw away half the answer.
 *
 * The first argument wins any field they disagree on; the second only fills
 * gaps.
 */
export function mergeLookups(
  primary: CookbookLookupResult | null,
  secondary: CookbookLookupResult | null
): CookbookLookupResult | null {
  if (!primary) return secondary;
  if (!secondary) return primary;

  const merged: Record<string, unknown> = { ...primary };
  for (const [key, value] of Object.entries(secondary)) {
    // `source` names who answered first, so it is never overwritten.
    if (key === "source") continue;
    if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
      merged[key] = value;
    }
  }
  return merged as unknown as CookbookLookupResult;
}

export function buildGoogleBooksUrl(query: string, isbn?: string): string {
  const clean = isbn ? normalizeIsbn(isbn) : undefined;
  const q = clean ? `isbn:${clean}` : query;
  return `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5`;
}

/** Digits (and a trailing X) only — users paste ISBNs with spaces and dashes. */
export function normalizeIsbn(raw: string): string | undefined {
  const clean = raw.replace(/[^0-9Xx]/g, "").toUpperCase();
  return clean.length === 10 || clean.length === 13 ? clean : undefined;
}

// --- Open Library -----------------------------------------------------------

interface OpenLibraryDoc {
  /** The work this edition belongs to, e.g. "/works/OL18147901W". */
  key?: string;
  title?: string;
  author_name?: string[];
  publisher?: string[];
  first_publish_year?: number;
  isbn?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
}

export function mapOpenLibrary(payload: unknown): CookbookLookupResult | null {
  const docs = (payload as { docs?: OpenLibraryDoc[] } | null)?.docs;
  if (!Array.isArray(docs)) return null;

  // Prefer a result that actually has a cover: a catalogue of books with no
  // spines is a worse catalogue, and a coverless near-match is rarely the
  // edition the user is holding anyway.
  const doc = docs.find((d) => d.title && d.cover_i) ?? docs.find((d) => d.title);
  if (!doc?.title) return null;

  const isbn = doc.isbn?.find((value) => normalizeIsbn(value));

  return stripUndefined({
    work_key: doc.key,
    title: doc.title,
    author: doc.author_name?.join(", "),
    publisher: doc.publisher?.[0],
    year: doc.first_publish_year,
    isbn: isbn ? normalizeIsbn(isbn) : undefined,
    page_count: doc.number_of_pages_median,
    cover_url: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : undefined,
    source: "openlibrary",
  });
}

// --- Google Books -----------------------------------------------------------

interface GoogleVolume {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

export function mapGoogleBooks(payload: unknown): CookbookLookupResult | null {
  const items = (payload as { items?: GoogleVolume[] } | null)?.items;
  if (!Array.isArray(items)) return null;

  const info = (items.find((i) => i.volumeInfo?.title && i.volumeInfo?.imageLinks) ??
    items.find((i) => i.volumeInfo?.title))?.volumeInfo;
  if (!info?.title) return null;

  // ISBN-13 is the one worth keeping when a volume lists both.
  const ids = info.industryIdentifiers ?? [];
  const isbn =
    ids.find((i) => i.type === "ISBN_13")?.identifier ??
    ids.find((i) => i.type === "ISBN_10")?.identifier;

  return stripUndefined({
    title: info.subtitle ? `${info.title} : ${info.subtitle}` : info.title,
    author: info.authors?.join(", "),
    publisher: info.publisher,
    // publishedDate is "2011", "2011-03" or "2011-03-24" depending on the
    // volume, so take the year off the front rather than parsing a date.
    year: parseYear(info.publishedDate),
    isbn: isbn ? normalizeIsbn(isbn) : undefined,
    page_count: info.pageCount,
    description: info.description,
    cover_url: upgradeGoogleCover(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
    source: "googlebooks",
  });
}

function parseYear(published?: string): number | undefined {
  const match = published?.match(/^(\d{4})/);
  const year = match ? Number(match[1]) : NaN;
  return Number.isFinite(year) ? year : undefined;
}

/**
 * Google's thumbnails come back over http and at zoom=1 (~128px), which looks
 * poor on a cover grid. Force https — the page is https and the browser would
 * block it otherwise — and ask for the larger rendering.
 */
function upgradeGoogleCover(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/^http:/, "https:").replace(/([?&])zoom=\d+/, "$1zoom=2");
}

/** Drops absent fields so they don't serialize as explicit nulls into the form. */
function stripUndefined(result: CookbookLookupResult): CookbookLookupResult {
  return Object.fromEntries(
    Object.entries(result).filter(([, v]) => v !== undefined && v !== "")
  ) as unknown as CookbookLookupResult;
}
