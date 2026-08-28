// Reads a whole book, page by page, for the cookbook importer.
//
// pdfText.ts reads one recipe and returns one string. That shape is wrong for
// a cookbook: a 400-page book is megabytes of text, the importer needs to know
// which page each line came from, and holding it all before doing anything
// means a long silence with no progress to show. So this hands back one page
// at a time and keeps nothing.
//
// It also splits columns, which pdfText.ts does not — see splitColumns below
// for why a table of contents is unreadable without it.

import { assertPdfBytes, loadPdfjs } from "./pdfjsLoader";
import { linesFromTextItems, type TextItemLike } from "./pdfText";

export interface PdfPage {
  /** 1-based, as the PDF numbers it — not the page number printed on it. */
  page: number;
  lines: string[];
}

/**
 * Finds the gutter between two columns of text, or null for a single column.
 *
 * Judged by what crosses a candidate line rather than by finding an entirely
 * empty band. The empty-band version worked until a book whose left column
 * held longer entries — "What's behind the science of sweets? 17" — whose text
 * reached far enough right to fill the gutter. A handful of long lines should
 * not veto a column break that fifty short ones agree on.
 *
 * Two refinements matter, and both come from real pages:
 *
 * The widest quiet band wins, not the quietest single position. The gap
 * between an entry's title and its page number is equally uncrossed, and
 * choosing it splits a column down its own middle.
 *
 * Both sides must carry real content. Otherwise the quietest line on a page of
 * ordinary prose is its right margin, and every page looks like two columns.
 *
 * Exported for its own sake: it's the fiddly part, and it's pure.
 */
export function findGutter(
  items: TextItemLike[],
  pageWidth: number,
  step = 5
): number | null {
  const real = items.filter((item) => item.str.trim());
  if (real.length < 8 || pageWidth <= 0) return null;

  // A couple of stragglers crossing is normal; a column boundary is not
  // required to be pristine.
  const tolerance = Math.max(1, Math.floor(real.length * 0.02));
  const spans = real.map((item) => {
    const from = item.transform[4];
    return [from, from + (item.width ?? 0)] as const;
  });

  const probes: { x: number; quiet: boolean; left: number; right: number }[] = [];
  for (let x = pageWidth * 0.3; x <= pageWidth * 0.7; x += step) {
    let crossing = 0;
    let left = 0;
    let right = 0;
    for (const [from, to] of spans) {
      if (from < x && to > x) crossing++;
      else if (to <= x) left++;
      else right++;
    }
    probes.push({ x, quiet: crossing <= tolerance, left, right });
  }

  const bands: { from: number; to: number }[] = [];
  let runStart: number | null = null;
  probes.forEach((probe, index) => {
    if (probe.quiet) runStart ??= index;
    else if (runStart !== null) {
      bands.push({ from: runStart, to: index - 1 });
      runStart = null;
    }
  });
  if (runStart !== null) bands.push({ from: runStart, to: probes.length - 1 });

  const candidates = bands
    // Narrow quiet patches are word spacing, not a gutter.
    .filter((band) => (band.to - band.from + 1) * step >= 15)
    // The split goes at the band's RIGHT edge, not its middle. The quiet
    // region stretches from where the left column's text stops to where the
    // right column starts, and that is wide — on one page it ran from x=200
    // to x=270. Splitting down its middle put the left column's own page
    // numbers, which start at x=240, into the right column, fusing two entries
    // into "71 Tea Salad-Style Bowl (with Chicken!)". Everything to the left of
    // where the next column begins belongs to the left one.
    .map((band) => probes[band.to])
    .filter(
      (probe) =>
        probe.left >= real.length * 0.2 && probe.right >= real.length * 0.2
    );
  if (!candidates.length) return null;

  // Columns straddle the page centre. A qualifying quiet band far from it is
  // usually the gap between an entry's title and its page number.
  const centre = pageWidth / 2;
  candidates.sort(
    (a, b) => Math.abs(a.x - centre) - Math.abs(b.x - centre)
  );
  return candidates[0].x;
}

/**
 * Splits positioned text into columns, left to right.
 *
 * linesFromTextItems rebuilds lines by baseline, which is right for a
 * single column and destructive for two: entries from the left and right
 * columns interleave as the baselines descend, and where a baseline is shared
 * they merge into one line carrying two page numbers. A real table of
 * contents came out as "MIGHTY MEATY 71 Sizzling Beef Bowl 133", which no
 * amount of parsing recovers.
 */
export function splitColumns(
  items: TextItemLike[],
  pageWidth: number
): TextItemLike[][] {
  const gutter = findGutter(items, pageWidth);
  if (gutter === null) return [items];
  return [
    items.filter((item) => item.transform[4] < gutter),
    items.filter((item) => item.transform[4] >= gutter),
  ];
}

/**
 * Runs one stage of reading a PDF, labelling anything it throws.
 *
 * A failure here reaches the user as a single line — on a phone there is no
 * console and the stack is minified to nothing useful — so the message has to
 * carry the one fact that makes it diagnosable: which stage broke. Reading a
 * book has several, and they fail for quite different reasons.
 */
async function stage<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new Error(`[${label}] ${detail}`);
  }
}

/**
 * Reads every page of a PDF, handing each to `onPage` as it is parsed.
 *
 * Streaming rather than returning everything: the caller can show progress
 * over a long book, and can keep only the pages it wants.
 */
export async function extractPdfPages(
  file: File,
  onPage: (page: PdfPage, total: number) => void,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  const pdfjs = await stage("chargement de pdf.js", () => loadPdfjs());
  let buffer: ArrayBuffer | null = await stage("lecture du fichier", () =>
    file.arrayBuffer()
  );
  assertPdfBytes(buffer);

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  // The Uint8Array is a view over the same bytes, not a second copy, but the
  // ArrayBuffer itself stays alive as long as anything references it — and
  // pdf.js has its own copy in the worker by now.
  buffer = null;

  const doc = await stage("ouverture du document", () => loadingTask.promise);
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      // Checked per page rather than per book: cancelling should stop within
      // milliseconds, not after another 300 pages.
      if (options.signal?.aborted) return;

      const page = await stage(`page ${pageNumber}`, () => doc.getPage(pageNumber));
      const content = await stage(`texte de la page ${pageNumber}`, () =>
        page.getTextContent()
      );
      // content.items mixes positioned text runs with marked-content markers;
      // keep the runs and narrow them to the few fields this needs.
      const items: TextItemLike[] = content.items
        .filter((entry): entry is Extract<typeof entry, { str: string }> => "str" in entry)
        .map((entry) => ({
          str: entry.str,
          transform: entry.transform,
          width: entry.width,
        }));

      const width = page.getViewport({ scale: 1 }).width;
      const lines = splitColumns(items, width).flatMap((column) =>
        linesFromTextItems(column)
      );

      onPage({ page: pageNumber, lines }, doc.numPages);
      page.cleanup();
    }
  } finally {
    // Release the worker and the parsed document; without this every read
    // leaks one until the tab is closed.
    await loadingTask.destroy();
  }
}

/**
 * True when a document has essentially no text layer.
 *
 * Scanned cookbooks are page images: pdf.js returns nothing for them and no
 * amount of parsing helps. Worth saying so plainly rather than reporting that
 * a book contains no recipes.
 */
export function looksScanned(pages: PdfPage[]): boolean {
  if (!pages.length) return true;
  const withText = pages.filter(
    (page) => page.lines.join("").trim().length >= 20
  ).length;
  return withText / pages.length < 0.1;
}
