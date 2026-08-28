// Everything under test here is pure; no network involved. The payloads are
// trimmed captures of real Open Library and Google Books responses — the
// optional-field sprawl is the point, so they keep the fields that are
// actually missing in practice rather than a tidy invented shape.

import { describe, expect, it } from "vitest";
import {
  buildGoogleBooksUrl,
  buildOpenLibraryUrl,
  buildOpenLibraryWorkUrl,
  isSynopsis,
  mapGoogleBooks,
  mapOpenLibraryWork,
  mapOpenLibrary,
  mergeLookups,
  normalizeIsbn,
} from "./cookbookLookup";

describe("normalizeIsbn", () => {
  it("strips the punctuation people paste", () => {
    expect(normalizeIsbn("978-2-08-138704-1")).toBe("9782081387041");
    expect(normalizeIsbn("0 7513 0356 8")).toBe("0751303568");
  });

  it("keeps a trailing X, which is a valid ISBN-10 check digit", () => {
    expect(normalizeIsbn("080442957X")).toBe("080442957X");
    expect(normalizeIsbn("080442957x")).toBe("080442957X");
  });

  it("rejects anything that isn't 10 or 13 digits", () => {
    expect(normalizeIsbn("12345")).toBeUndefined();
    expect(normalizeIsbn("")).toBeUndefined();
    expect(normalizeIsbn("97820813870411234")).toBeUndefined();
  });
});

describe("url builders", () => {
  it("searches by ISBN when there is one", () => {
    expect(buildOpenLibraryUrl("ignored", "978-2-08-138704-1")).toContain(
      "isbn=9782081387041"
    );
    expect(buildGoogleBooksUrl("ignored", "978-2-08-138704-1")).toContain(
      "isbn%3A9782081387041"
    );
  });

  it("falls back to the free-text query when the ISBN is unusable", () => {
    expect(buildOpenLibraryUrl("Le Larousse", "nope")).toContain("q=Le%20Larousse");
    expect(buildGoogleBooksUrl("Le Larousse", "nope")).toContain("q=Le%20Larousse");
  });

  it("escapes accents and spaces in a title", () => {
    expect(buildOpenLibraryUrl("Pâtisserie française")).toContain(
      "q=P%C3%A2tisserie%20fran%C3%A7aise"
    );
  });
});

describe("mapOpenLibrary", () => {
  it("flattens a search hit", () => {
    const result = mapOpenLibrary({
      docs: [
        {
          title: "Le Larousse de la cuisine",
          author_name: ["Collectif", "Pierre Dupont"],
          publisher: ["Larousse", "Hachette"],
          first_publish_year: 2011,
          isbn: ["2035868696", "978-2-03-586869-1"],
          number_of_pages_median: 800,
          cover_i: 12345,
        },
      ],
    });

    expect(result).toEqual({
      title: "Le Larousse de la cuisine",
      author: "Collectif, Pierre Dupont",
      publisher: "Larousse",
      year: 2011,
      isbn: "2035868696",
      page_count: 800,
      cover_url: "https://covers.openlibrary.org/b/id/12345-L.jpg",
      source: "openlibrary",
    });
  });

  it("prefers a hit that has a cover over an earlier one that doesn't", () => {
    const result = mapOpenLibrary({
      docs: [{ title: "Sans couverture" }, { title: "Avec couverture", cover_i: 99 }],
    });
    expect(result?.title).toBe("Avec couverture");
  });

  it("still returns a coverless hit rather than nothing", () => {
    const result = mapOpenLibrary({ docs: [{ title: "Sans couverture" }] });
    expect(result?.title).toBe("Sans couverture");
    expect(result?.cover_url).toBeUndefined();
  });

  it("omits absent fields instead of returning nulls", () => {
    const result = mapOpenLibrary({ docs: [{ title: "Minimal" }] });
    expect(Object.keys(result!).sort()).toEqual(["source", "title"]);
  });

  it("returns null for an empty or malformed payload", () => {
    expect(mapOpenLibrary({ docs: [] })).toBeNull();
    expect(mapOpenLibrary({ docs: [{ author_name: ["No title"] }] })).toBeNull();
    expect(mapOpenLibrary({})).toBeNull();
    expect(mapOpenLibrary(null)).toBeNull();
  });
});

describe("mapGoogleBooks", () => {
  it("flattens a volume", () => {
    const result = mapGoogleBooks({
      items: [
        {
          volumeInfo: {
            title: "The Flavor Bible",
            authors: ["Karen Page", "Andrew Dornenburg"],
            publisher: "Little, Brown",
            publishedDate: "2008-09-16",
            description: "A guide to flavour pairing.",
            pageCount: 392,
            industryIdentifiers: [
              { type: "ISBN_10", identifier: "0316118400" },
              { type: "ISBN_13", identifier: "9780316118408" },
            ],
            imageLinks: {
              thumbnail: "http://books.google.com/books/content?id=x&zoom=1&edge=curl",
            },
          },
        },
      ],
    });

    expect(result).toMatchObject({
      title: "The Flavor Bible",
      author: "Karen Page, Andrew Dornenburg",
      year: 2008,
      page_count: 392,
      source: "googlebooks",
    });
    // ISBN-13 wins when a volume lists both.
    expect(result?.isbn).toBe("9780316118408");
  });

  it("forces https and a larger rendering on the cover", () => {
    const result = mapGoogleBooks({
      items: [
        {
          volumeInfo: {
            title: "X",
            imageLinks: { thumbnail: "http://books.google.com/c?id=x&zoom=1&edge=curl" },
          },
        },
      ],
    });
    expect(result?.cover_url).toBe("https://books.google.com/c?id=x&zoom=2&edge=curl");
  });

  it("joins a subtitle onto the title", () => {
    const result = mapGoogleBooks({
      items: [{ volumeInfo: { title: "Salt Fat Acid Heat", subtitle: "Mastering Cooking" } }],
    });
    expect(result?.title).toBe("Salt Fat Acid Heat : Mastering Cooking");
  });

  it("reads the year from a partial publishedDate", () => {
    const year = (published?: string) =>
      mapGoogleBooks({ items: [{ volumeInfo: { title: "X", publishedDate: published } }] })?.year;
    expect(year("2011")).toBe(2011);
    expect(year("2011-03")).toBe(2011);
    expect(year("2011-03-24")).toBe(2011);
    expect(year("s.d.")).toBeUndefined();
    expect(year(undefined)).toBeUndefined();
  });

  it("returns null for an empty or malformed payload", () => {
    expect(mapGoogleBooks({ items: [] })).toBeNull();
    expect(mapGoogleBooks({ totalItems: 0 })).toBeNull();
    expect(mapGoogleBooks(null)).toBeNull();
  });
});

describe("buildOpenLibraryUrl fields", () => {
  it("asks for the fields Open Library withholds by default", () => {
    // Its search endpoint returns ten fields unless told otherwise, with no
    // publisher, ISBN, page count or cover — which is why a lookup used to
    // come back with little more than a year.
    const url = buildOpenLibraryUrl("Bowls");
    for (const field of ["publisher", "isbn", "number_of_pages_median", "cover_i"]) {
      expect(url).toContain(field);
    }
  });

  it("asks for them on the ISBN route too", () => {
    expect(buildOpenLibraryUrl("x", "9781452156279")).toContain("publisher");
  });
});

describe("mergeLookups", () => {
  const openLibrary = {
    title: "Bowls!",
    author: "Molly Watson",
    publisher: "Chronicle Books LLC",
    isbn: "9781452156279",
    cover_url: "https://covers.openlibrary.org/b/id/1-L.jpg",
    source: "openlibrary" as const,
  };
  const google = {
    title: "Bowls! Recipes",
    author: "Molly Watson, Nicole Franzen",
    description: "A book about bowls.",
    page_count: 176,
    year: 2017,
    source: "googlebooks" as const,
  };

  it("fills the gaps in the first answer from the second", () => {
    const merged = mergeLookups(openLibrary, google)!;
    // Open Library had no description, page count or year; Google Books did.
    expect(merged.description).toBe("A book about bowls.");
    expect(merged.page_count).toBe(176);
    expect(merged.year).toBe(2017);
  });

  it("never lets the second answer overwrite the first", () => {
    const merged = mergeLookups(openLibrary, google)!;
    expect(merged.title).toBe("Bowls!");
    expect(merged.author).toBe("Molly Watson");
    expect(merged.publisher).toBe("Chronicle Books LLC");
    expect(merged.source).toBe("openlibrary");
  });

  it("returns whichever one answered when only one did", () => {
    expect(mergeLookups(null, google)).toEqual(google);
    expect(mergeLookups(openLibrary, null)).toEqual(openLibrary);
    expect(mergeLookups(null, null)).toBeNull();
  });

  it("treats an empty string as a gap worth filling", () => {
    const merged = mergeLookups({ ...openLibrary, author: "" }, google)!;
    expect(merged.author).toBe("Molly Watson, Nicole Franzen");
  });
});

describe("mapOpenLibraryWork", () => {
  // Long enough to read as a real blurb: isSynopsis rejects short fragments,
  // because a "description" that short is usually catalogue data.
  const BLURB =
    "A hundred recipes for building a meal in a single bowl, from grains and beans to sauces.";

  it("reads a description given as a plain string, and trims it", () => {
    expect(mapOpenLibraryWork({ description: `  ${BLURB}  ` })).toEqual({
      description: BLURB,
    });
  });

  it("reads the older {type, value} shape too", () => {
    // Open Library returns whichever the record happens to use.
    expect(
      mapOpenLibraryWork({ description: { type: "/type/text", value: BLURB } })
    ).toEqual({ description: BLURB });
  });

  it("drops a catalogue description rather than offering it as a blurb", () => {
    expect(mapOpenLibraryWork({ description: "160 pages : 24 cm" })).toEqual({});
  });

  it("keeps plain subjects and drops cataloguing noise", () => {
    const result = mapOpenLibraryWork({
      description: BLURB,
      subjects: [
        "Cooking",
        "regional & ethnic cooking",
        "nyt:advice-how-to-and-miscellaneous=2017-05-14",
        "A subject far too long to be a useful tag on a recipe card",
      ],
    });
    expect(result.tags).toEqual(["Cooking", "regional & ethnic cooking"]);
  });

  it("returns nothing rather than empty strings when the work is bare", () => {
    expect(mapOpenLibraryWork({})).toEqual({});
    expect(mapOpenLibraryWork(null)).toEqual({});
    expect(mapOpenLibraryWork({ description: "   " })).toEqual({});
  });
});

describe("buildOpenLibraryWorkUrl", () => {
  it("builds the work-record URL from a search hit's key", () => {
    expect(buildOpenLibraryWorkUrl("/works/OL18147901W")).toBe(
      "https://openlibrary.org/works/OL18147901W.json"
    );
  });
});

describe("isSynopsis", () => {
  it("rejects the physical description some records carry", () => {
    // Real values seen from Open Library, offered as a cookbook's blurb.
    expect(isSynopsis("160 pages : 24 cm")).toBe(false);
    expect(isSynopsis("957 pages : 28 cm")).toBe(false);
    expect(isSynopsis("xii, 320 p. ; 26 cm")).toBe(false);
    expect(isSynopsis("240 unnumbered pages")).toBe(false);
  });

  it("accepts an actual blurb", () => {
    expect(
      isSynopsis(
        "A visionary new master class in cooking that distills decades of professional experience into just four simple elements."
      )
    ).toBe(true);
  });

  it("rejects a fragment too short to be a blurb", () => {
    expect(isSynopsis("Cookbook.")).toBe(false);
    expect(isSynopsis("")).toBe(false);
  });
});
