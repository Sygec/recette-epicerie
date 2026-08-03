// Reads the text out of a PDF in the browser, so the Worker never has to.
//
// Keeping extraction here means no PDF library in the Worker bundle (capped at
// 3 MB gzipped), no Cloudflare AI binding, and local development stays fully
// offline. The server only receives text and interprets it — see
// worker/src/recipeText.ts — so it doesn't care that a browser produced it.
//
// pdf.js is loaded on demand: it's the heaviest dependency in the app and
// nobody who isn't importing a PDF should pay for it.

// A positioned run of text as pdf.js reports it. Only the fields used here are
// declared, so this doesn't depend on pdf.js's own types being importable.
export interface TextItemLike {
  str: string;
  /** [a, b, c, d, x, y] — the last two are the position on the page. */
  transform: number[];
  /** Advance width of the run, used to tell a word break from a column gap. */
  width?: number;
  hasEOL?: boolean;
}

/**
 * Rebuilds lines from positioned text runs.
 *
 * A PDF has no notion of a line: it has glyphs at coordinates. Runs that share
 * a baseline belong to the same line and have to be stitched back together in
 * left-to-right order, or an ingredient list arrives as one long smear.
 *
 * Exported for its own sake — this is the fiddly part, and it's pure.
 */
export function linesFromTextItems(items: TextItemLike[], tolerance = 2): string[] {
  const rows: { y: number; parts: { x: number; width: number; str: string }[] }[] = [];

  for (const item of items) {
    if (!item.str) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width ?? 0;
    // Baselines wobble by a fraction of a point within a line, so match on a
    // tolerance rather than equality.
    const row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (row) row.parts.push({ x, width, str: item.str });
    else rows.push({ y, parts: [{ x, width, str: item.str }] });
  }

  // Top of the page downwards: PDF y grows upwards, so this sorts descending.
  rows.sort((a, b) => b.y - a.y);

  return rows
    .map((row) => {
      const parts = row.parts.sort((a, b) => a.x - b.x);
      // Runs are glyph runs, not words: "Ingré" and "dients" are adjacent and
      // must not gain a space, while two columns on the same baseline must.
      // The horizontal gap tells them apart.
      return parts
        .map((part, i) => {
          if (i === 0) return part.str;
          const previous = parts[i - 1];
          const gap = part.x - (previous.x + previous.width);
          return gap > 1 ? ` ${part.str}` : part.str;
        })
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    })
    .filter(Boolean);
}

/**
 * Extracts the text of a PDF file, one line per line, pages separated by a
 * blank line. Throws with a French message the form can show directly.
 */
export async function extractPdfText(file: File): Promise<string> {
  // Dynamic import so pdf.js is fetched only when a PDF is actually imported.
  const pdfjs = await import("pdfjs-dist");
  // Vite resolves this to a bundled asset URL; without it pdf.js tries to
  // fetch a worker from a path that doesn't exist in the built app.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const buffer = await file.arrayBuffer();

  // Check the magic bytes rather than the file's declared type, which is
  // whatever the OS guessed from the extension.
  if (new TextDecoder().decode(buffer.slice(0, 5)) !== "%PDF-") {
    throw new Error("Ce fichier ne semble pas être un PDF");
  }

  // Keep the loading task: it owns the worker, and destroying it is what
  // actually releases both it and the parsed document.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      // content.items mixes positioned text runs with marked-content markers;
      // keep the runs and narrow them to the few fields this needs.
      const items: TextItemLike[] = content.items
        .filter((entry): entry is Extract<typeof entry, { str: string }> => "str" in entry)
        .map((entry) => ({
          str: entry.str,
          transform: entry.transform,
          width: entry.width,
        }));
      const lines = linesFromTextItems(items);
      if (lines.length) pages.push(lines.join("\n"));
      page.cleanup();
    }
    return pages.join("\n\n");
  } finally {
    // Release the worker and the parsed document; without this every import
    // leaks one until the tab is closed.
    await loadingTask.destroy();
  }
}
