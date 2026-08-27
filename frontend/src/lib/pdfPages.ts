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
 * A gutter is an empty *vertical band*, not a gap between two adjacent text
 * positions: both columns have text at many x positions, so consecutive
 * starts are never far apart. This buckets the horizontal span every item
 * covers and looks for a run of buckets nothing touches.
 *
 * Only bands in the middle of the page count. The widest empty band on any
 * page is the left margin, so taking the widest overall and then checking
 * whether it looks central finds the margin every time and gives up — which
 * is exactly the bug this had first time round.
 *
 * Exported for its own sake: it's the fiddly part, and it's pure.
 */
export function findGutter(
  items: TextItemLike[],
  pageWidth: number,
  bucketSize = 10
): number | null {
  if (items.length < 8 || pageWidth <= 0) return null;

  const buckets = new Array(Math.max(1, Math.ceil(pageWidth / bucketSize))).fill(0);
  for (const item of items) {
    if (!item.str.trim()) continue;
    const from = Math.max(0, Math.floor(item.transform[4] / bucketSize));
    const to = Math.min(
      buckets.length - 1,
      Math.floor((item.transform[4] + (item.width ?? 0)) / bucketSize)
    );
    for (let b = from; b <= to; b++) buckets[b]++;
  }

  const runs: { from: number; to: number }[] = [];
  let start: number | null = null;
  buckets.forEach((count, index) => {
    if (count === 0) start ??= index;
    else if (start !== null) {
      runs.push({ from: start, to: index });
      start = null;
    }
  });

  const candidates = runs
    .map((run) => ({
      centre: ((run.from + run.to) / 2) * bucketSize,
      width: (run.to - run.from) * bucketSize,
    }))
    // Central enough to be a gutter rather than a margin, and wide enough to
    // be deliberate rather than the space between two words.
    .filter(
      (run) =>
        run.centre > pageWidth * 0.3 &&
        run.centre < pageWidth * 0.7 &&
        run.width >= pageWidth * 0.03
    );

  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.width - a.width)[0].centre;
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
