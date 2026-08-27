// assertPdfBytes is what actually decides whether a file is usable. The file
// picker's accept filter was removed because it greyed out phone-downloaded
// PDFs that report application/octet-stream, which made them impossible to
// choose at all. That leaves this as the only gate, so it is worth testing.

import { afterEach, describe, expect, it } from "vitest";
import { assertPdfBytes, polyfillStreamAsyncIterator } from "./pdfjsLoader";

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

describe("polyfillStreamAsyncIterator", () => {
  const proto = ReadableStream.prototype as ReadableStream & {
    [Symbol.asyncIterator]?: unknown;
  };
  const native = proto[Symbol.asyncIterator];

  afterEach(() => {
    if (native) {
      Object.defineProperty(proto, Symbol.asyncIterator, {
        configurable: true,
        writable: true,
        value: native,
      });
    }
  });

  // TypeScript's DOM lib doesn't declare Symbol.asyncIterator on
  // ReadableStream either — which is the same gap, in the type system. The
  // cast is what lets the test iterate the way pdf.js does.
  const streamOf = (...values: number[]) =>
    new ReadableStream<number>({
      start(controller) {
        for (const v of values) controller.enqueue(v);
        controller.close();
      },
    }) as ReadableStream<number> & AsyncIterable<number>;

  it("makes for-await work where the browser has no async iterator", async () => {
    // WebKit's state: pdf.js reads page text with `for await (const value of
    // readableStream)`, which died here with "undefined is not a function".
    delete proto[Symbol.asyncIterator];
    polyfillStreamAsyncIterator();

    const seen: number[] = [];
    for await (const value of streamOf(1, 2, 3)) seen.push(value);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("releases the reader when the loop exits early", async () => {
    delete proto[Symbol.asyncIterator];
    polyfillStreamAsyncIterator();

    const stream = streamOf(1, 2, 3);
    for await (const value of stream) {
      if (value === 2) break;
    }
    // If the lock were still held this would throw.
    expect(() => stream.getReader()).not.toThrow();
  });

  it("leaves a browser that already has one alone", () => {
    if (!native) return;
    polyfillStreamAsyncIterator();
    expect(proto[Symbol.asyncIterator]).toBe(native);
  });
});
