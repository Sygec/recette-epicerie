// Reads a cookbook's printed table of contents into a list of recipes.
//
// This is the free half of the importer. A printed TOC already contains
// exactly what the index needs — every recipe, its title, and the page it
// starts on — so a book that has one costs nothing to index. Only a book
// without a usable TOC needs the LLM.
//
// Deliberately pure, like recipeText.ts: pages of text in, entries out, no
// bindings and no I/O. The browser reads the PDF (frontend/src/lib/
// pdfPages.ts) and posts the text.
//
// Written against a real cookbook rather than an imagined one, which changed
// the design twice. There are no dot leaders — entries are "Title 147", and a
// trailing number is the only reliable signal. And the TOC is two columns,
// which the extractor has to separate before any of this runs; without that
// the lines arrive interleaved and sometimes merged ("MIGHTY MEATY 71
// Sizzling Beef Bowl 133"), which no parser recovers from.

export interface TocPage {
  page: number;
  lines: string[];
}

export interface ParsedTocEntry {
  title: string;
  /** The page as printed in the book, not the PDF's page index. */
  page_number: number;
  chapter?: string;
}

export interface ParsedToc {
  entries: ParsedTocEntry[];
  /** Which PDF pages the entries were read from, for the UI to explain itself. */
  toc_pages: number[];
  warning?: string;
}

// Sections that carry a page number in the contents but aren't recipes.
// Matched against the folded title, so case and accents don't matter.
const NOT_A_RECIPE = [
  "introduction",
  "index",
  "acknowledgments",
  "acknowledgements",
  "remerciements",
  "contents",
  "table des matieres",
  "sommaire",
  "about the author",
  "a propos de l auteur",
  "resources",
  "ressources",
  "glossary",
  "glossaire",
  "bibliography",
  "bibliographie",
  "conversions",
  "conversion charts",
  "equivalences",
  "dedication",
  "copyright",
  "preface",
  "foreword",
  "avant propos",
  "notes",
  "credits",
  "photo credits",
];

/** Accent- and case-folded, punctuation flattened to spaces. */
export function foldTitle(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Splits "Kalefornia Bowl 112" into its title and page.
 *
 * Dot or space leaders are stripped when present, but not required — the book
 * this was written against uses neither. The number has to be separated from
 * the title, so "Recipe for 4" keeps its 4 and "Bowl 112" does not.
 */
export function splitTitleAndPage(
  line: string
): { title: string; page: number } | null {
  const match = line.match(/^(.*?)[\s.·…_-]+(\d{1,4})$/);
  if (!match) return null;
  const title = match[1].replace(/[\s.·…_-]+$/, "").trim();
  const page = Number(match[2]);
  if (!title || !Number.isFinite(page) || page < 1) return null;
  // A title that is only digits is a stray folio, not an entry.
  if (!/[a-zA-ZÀ-ɏ]/.test(title)) return null;
  return { title, page };
}

/**
 * True for a section heading rather than a recipe.
 *
 * Cookbooks set these in capitals ("HIPPIE GOODNESS", "GRAINS & THE LIKE") or
 * number them ("PART 3: Full Bowls"). Judged on the ratio of capitals among
 * the letters, so "IT'S BREAKFAST TIME" counts despite its apostrophe.
 */
export function isChapterHeading(title: string): boolean {
  if (/^part\s+\w+/i.test(title) || /^chapitre\s+\w+/i.test(title)) return true;
  const letters = title.replace(/[^a-zA-ZÀ-ɏ]/g, "");
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, "").length;
  return upper / letters.length >= 0.8;
}

function isNotARecipe(title: string): boolean {
  const folded = foldTitle(title);
  return NOT_A_RECIPE.some(
    (term) => folded === term || folded.startsWith(term + " ")
  );
}

/**
 * Scores how much a page looks like a table of contents: the share of its
 * lines that end in a page number.
 *
 * The index at the back of a book also has lines full of numbers, but they
 * carry several each ("Kale, 45, 67, 89") and score lower, and the caller
 * only looks near the front anyway.
 */
export function tocScore(lines: string[]): number {
  const usable = lines.filter((line) => line.trim().length > 1);
  if (usable.length < 5) return 0;
  const withPage = usable.filter((line) => splitTitleAndPage(line) !== null);
  return withPage.length / usable.length;
}

/**
 * Reads the contents out of the front of a book.
 *
 * Only the first fifth is considered: a cookbook prints its contents at the
 * front, and the alphabetical index at the back is a different thing that
 * would otherwise be read as several hundred one-page recipes.
 */
export function parseTableOfContents(pages: TocPage[]): ParsedToc {
  if (!pages.length) {
    return { entries: [], toc_pages: [], warning: "Aucune page à analyser" };
  }

  const searchLimit = Math.max(1, Math.ceil(pages.length * 0.2));
  const candidates = pages
    .slice(0, searchLimit)
    .map((page) => ({ page, score: tocScore(page.lines) }))
    .filter(({ score }) => score >= 0.6);

  if (!candidates.length) {
    return {
      entries: [],
      toc_pages: [],
      warning:
        "Aucune table des matières exploitable n'a été trouvée dans ce livre.",
    };
  }

  const entries: ParsedTocEntry[] = [];
  const tocPages: number[] = [];
  let chapter: string | undefined;

  for (const { page } of candidates) {
    tocPages.push(page.page);
    // A title too long for its column wraps, and the page number sits on the
    // second line ("Twisted Lowcountry Breakfast" / "(Lunch or Dinner) 71").
    // Hold a numberless line and try it as a prefix for the next one.
    let pending: string | null = null;

    for (const raw of page.lines) {
      const line = raw.trim();
      if (!line) continue;

      const split = splitTitleAndPage(line);
      if (!split) {
        // Numberless: either a heading, or the first half of a wrapped title.
        pending = isChapterHeading(line) ? ((chapter = line), null) : line;
        continue;
      }

      let { title } = split;
      if (pending) {
        title = `${pending} ${title}`.replace(/\s+/g, " ").trim();
        pending = null;
      }

      if (isChapterHeading(title)) {
        // Headings carry a page number too; they mark a section rather than
        // being something you can cook.
        chapter = title;
        continue;
      }
      if (isNotARecipe(title)) continue;

      entries.push({
        title,
        page_number: split.page,
        ...(chapter && !isNotARecipe(chapter) ? { chapter } : {}),
      });
    }
  }

  // A cookbook's contents open with front matter — "Why low/no sugar?", "How
  // to stock your kitchen", "Tips" — which carry page numbers and look exactly
  // like recipes. They sit above the first chapter heading, and the recipes do
  // not. So when a book has chapters at all, anything listed before the first
  // one is introduction rather than something to cook.
  //
  // Guarded on the book having chapters: with none, this signal says nothing
  // and dropping the lot would empty the index.
  const firstWithChapter = entries.findIndex((entry) => entry.chapter);
  const recipes =
    firstWithChapter > 0 ? entries.slice(firstWithChapter) : entries;

  return {
    entries: recipes,
    toc_pages: tocPages,
    ...(recipes.length ? {} : {
      warning:
        "La table des matières a été trouvée mais aucune recette n'a pu en être tirée.",
    }),
  };
}

/**
 * Works out how far the printed page numbers are from the PDF's own.
 *
 * A book's page 1 is never the PDF's page 1 — cover, title and copyright come
 * first — so an entry that says page 112 is somewhere else in the file. Rather
 * than guess a fixed offset, this looks for each title as a heading in the
 * body and takes the most common difference, which survives the odd recipe
 * whose title also appears in an ingredient list or a cross-reference.
 *
 * Returns null when too few titles could be located to be confident.
 */
export function estimatePageOffset(
  pages: TocPage[],
  entries: ParsedTocEntry[],
  tocPages: number[] = []
): number | null {
  const body = pages.filter((page) => !tocPages.includes(page.page));
  const votes = new Map<number, number>();
  let located = 0;

  // A sample is enough, and keeps this linear-ish on a big book.
  for (const entry of entries.slice(0, 40)) {
    const wanted = foldTitle(entry.title);
    if (wanted.length < 6) continue;

    const hit = body.find((page) =>
      page.lines.some((line) => foldTitle(line) === wanted)
    );
    if (!hit) continue;

    located++;
    const offset = hit.page - entry.page_number;
    votes.set(offset, (votes.get(offset) ?? 0) + 1);
  }

  if (located < 3) return null;
  const [best, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  // A scatter of one-off differences isn't an offset.
  return count >= 3 && count / located >= 0.5 ? best : null;
}
