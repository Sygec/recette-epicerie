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
}

export function buildOpenLibraryUrl(query: string, isbn?: string): string {
  if (isbn) {
    const clean = normalizeIsbn(isbn);
    if (clean) return `https://openlibrary.org/search.json?isbn=${clean}&limit=5`;
  }
  return `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`;
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
