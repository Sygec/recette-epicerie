// Loads pdf.js, once, for whoever needs it.
//
// Extracted from pdfText.ts when the cookbook importer became a second
// reader. The two settings below are not incidental — each one is a bug that
// was found the hard way — so they belong in one place rather than copied.

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loading: Promise<Pdfjs> | null = null;

/**
 * Imports pdf.js on demand and points it at its worker.
 *
 * Dynamic, so pdf.js is fetched only when a PDF is actually read: it is the
 * heaviest dependency in the app and most visits never touch it. The promise
 * is cached, so reading a second document doesn't re-import it.
 */
export function loadPdfjs(): Promise<Pdfjs> {
  loading ??= (async () => {
    // The legacy build, not the default one. pdf.js's default build assumes a
    // browser new enough for Promise.withResolvers and the iterator helpers —
    // Safari only got those in 17.4 and 18.4 — and Vite transpiles syntax, not
    // runtime APIs, so on an older iPhone the import died with "undefined is
    // not a function" before reading a byte. The legacy build carries the
    // core-js polyfills for exactly these. It costs a few KB on a chunk that
    // already loads only when someone reads a PDF.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Vite resolves this to a bundled asset URL; without it pdf.js tries to
    // fetch a worker from a path that doesn't exist in the built app. It has
    // to be the legacy worker too — it parses the file in its own realm, with
    // its own need for the polyfills.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    return pdfjs;
  })();
  return loading;
}

/**
 * Rejects a file that isn't a PDF, by looking at it rather than trusting it.
 *
 * The declared type is whatever the OS guessed from the extension; the magic
 * bytes are what pdf.js will actually try to parse.
 */
export function assertPdfBytes(buffer: ArrayBuffer) {
  const magic = new TextDecoder().decode(buffer.slice(0, 5));
  if (magic === "%PDF-") return;

  // EPUB and every other ebook format built on zip start with "PK". Worth
  // naming, because "not a PDF" is unhelpful when the file is a book and the
  // real answer is that this format isn't supported yet.
  if (magic.startsWith("PK")) {
    throw new Error(
      "Ce fichier est un EPUB (ou une archive). Seuls les PDF sont pris en charge pour le moment."
    );
  }
  throw new Error("Ce fichier ne semble pas être un PDF");
}
