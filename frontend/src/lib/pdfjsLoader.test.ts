// assertPdfBytes is what actually decides whether a file is usable. The file
// picker's accept filter was removed because it greyed out phone-downloaded
// PDFs that report application/octet-stream, which made them impossible to
// choose at all. That leaves this as the only gate, so it is worth testing.

import { describe, expect, it } from "vitest";
import { assertPdfBytes } from "./pdfjsLoader";

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer;

describe("assertPdfBytes", () => {
  it("accepts a real PDF whatever the OS called it", () => {
    expect(() => assertPdfBytes(bytesOf("%PDF-1.7"))).not.toThrow();
  });

  it("names EPUB rather than only saying it is not a PDF", () => {
    // EPUB, like every zip-based ebook format, starts with "PK". The vaguer
    // message sent people looking for a corrupt file rather than an
    // unsupported format.
    expect(() => assertPdfBytes(bytesOf("PKabc"))).toThrow(/EPUB/);
  });

  it("rejects anything else plainly", () => {
    expect(() => assertPdfBytes(bytesOf("<html><body>"))).toThrow(
      /ne semble pas etre un PDF|ne semble pas être un PDF/
    );
  });

  it("rejects an empty file instead of reading past the end", () => {
    expect(() => assertPdfBytes(bytesOf(""))).toThrow();
  });
});
