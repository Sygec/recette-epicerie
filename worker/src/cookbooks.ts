// The cookbook catalogue: the books the user owns, and their metadata.
//
// A sub-router rather than more routes in index.ts, which is already past
// 1600 lines. Mounted at /api/cookbooks, so it sits under the requireAuth
// middleware index.ts installs on /api/* — there is no auth handling here.
//
// Two things live here. The catalogue itself — a cookbook with no file at
// all, a paper book on a shelf, is a first-class entry — and the index of
// recipes inside the books that do have a file. Actually importing a recipe
// out of those pages is the next piece and is not here yet.

import { Hono } from "hono";
import type { Env } from "./types";
import { isHttpUrl } from "./recipeImport";
import {
  ALLOWED_PHOTO_TYPES,
  deleteStaleObjects,
  isUploadedFile,
  PHOTO_TYPE_ERROR,
} from "./photos";
import {
  estimatePageOffset,
  parseTableOfContents,
  type TocPage,
} from "./cookbookToc";
import {
  estimateCost,
  extractRecipesFromPage,
  toImportedRecipe,
} from "./cookbookAi";
import { titleKey as foldForMatch } from "./cookbookIndex";
import {
  findCrossBookDuplicates,
  mergeEntries,
  titleKey,
  withEndPages,
  type IncomingEntry,
  type StoredEntry,
} from "./cookbookIndex";
import {
  buildGoogleBooksUrl,
  buildOpenLibraryUrl,
  mapGoogleBooks,
  mapOpenLibrary,
  type CookbookLookupResult,
} from "./cookbookLookup";

const cookbooks = new Hono<{ Bindings: Env }>();

interface CookbookPayload {
  title?: string;
  author?: string | null;
  publisher?: string | null;
  year?: number | null;
  isbn?: string | null;
  page_count?: number | null;
  description?: string | null;
  cover_url?: string | null;
  notes?: string | null;
  source_file_name?: string | null;
  source_file_size?: number | null;
  show_in_recipe_list?: boolean;
}

function coverPrefix(id: string) {
  return `cookbooks/${id}/`;
}

// ---------------------------------------------------------------------------
// List & read
// ---------------------------------------------------------------------------

// Ordering is left to the client (see frontend/src/lib/cookbookSort.ts) for
// the same reason the recipe list does it there: SQLite's only
// case-insensitive collation is ASCII-only and files "Élégance" after
// "Zucchini", while Intl.Collator knows French.
cookbooks.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cb.*,
       (SELECT COUNT(*) FROM cookbook_entries e
         WHERE e.cookbook_id = cb.id) AS entry_count,
       (SELECT COUNT(*) FROM cookbook_entries e
         WHERE e.cookbook_id = cb.id AND e.recipe_id IS NOT NULL) AS imported_count,
       (SELECT COUNT(*) FROM recipes r
         WHERE r.cookbook_id = cb.id) AS recipe_count
     FROM cookbooks cb
     ORDER BY cb.created_at DESC`
  ).all();
  return c.json(results);
});

// ---------------------------------------------------------------------------
// Metadata lookup
//
// Registered before /:id — Hono matches in registration order, so a later
// literal path would be swallowed by the parameter route.
// ---------------------------------------------------------------------------

// Writes nothing. Like the recipe URL import, this returns a preview the form
// loads, so the user can correct it before anything is saved.
cookbooks.post("/lookup", async (c) => {
  const body = await c.req.json<{ title?: string; author?: string; isbn?: string }>();
  const title = body.title?.trim() ?? "";
  const isbn = body.isbn?.trim() || undefined;

  if (!title && !isbn) {
    return c.json({ error: "Un titre ou un ISBN est requis" }, 400);
  }

  // Author narrows a generic title ("Desserts") usefully, and both providers
  // treat the query as free text, so appending it costs nothing.
  const query = [title, body.author?.trim()].filter(Boolean).join(" ");

  const attempts: { url: string; map: (payload: unknown) => CookbookLookupResult | null }[] = [
    { url: buildOpenLibraryUrl(query, isbn), map: mapOpenLibrary },
    { url: buildGoogleBooksUrl(query, isbn), map: mapGoogleBooks },
  ];

  for (const { url, map } of attempts) {
    try {
      const response = await fetch(url, {
        headers: {
          // Open Library asks that automated clients identify themselves.
          "User-Agent":
            "Mozilla/5.0 (compatible; RecettesEtCoursesBot/1.0; +recette-epicerie)",
          Accept: "application/json",
        },
      });
      if (!response.ok) continue;
      const mapped = map(await response.json());
      if (mapped) return c.json(mapped);
    } catch {
      // Provider unreachable or returned junk — try the next one.
    }
  }

  return c.json(
    {
      error:
        "Aucun livre trouvé pour ce titre. Saisissez les informations manuellement — vous pourrez toujours ajouter une couverture ensuite.",
    },
    404
  );
});

cookbooks.get("/:id", async (c) => {
  const id = c.req.param("id");

  const cookbook = await c.env.DB.prepare("SELECT * FROM cookbooks WHERE id = ?")
    .bind(id)
    .first();
  if (!cookbook) return c.json({ error: "Livre introuvable" }, 404);

  // Only the columns the book's recipe list renders. SELECT * would drag the
  // whole recipe across for a card that shows a title and a page number.
  const recipes = await c.env.DB.prepare(
    `SELECT id, title, photo_url, prep_time, cook_time, difficulty, cookbook_page, created_at
     FROM recipes WHERE cookbook_id = ?`
  )
    .bind(id)
    .all();

  return c.json({ ...cookbook, recipes: recipes.results });
});

// ---------------------------------------------------------------------------
// Create, update, delete
// ---------------------------------------------------------------------------

cookbooks.post("/", async (c) => {
  const body = await c.req.json<CookbookPayload>();

  if (!body.title || !body.title.trim()) {
    return c.json({ error: "Le titre est obligatoire" }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO cookbooks
      (title, author, publisher, year, isbn, page_count, description, cover_url,
       notes, source_file_name, source_file_size, show_in_recipe_list)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.title.trim(),
      body.author ?? null,
      body.publisher ?? null,
      body.year ?? null,
      body.isbn ?? null,
      body.page_count ?? null,
      body.description ?? null,
      body.cover_url ?? null,
      body.notes ?? null,
      body.source_file_name ?? null,
      body.source_file_size ?? null,
      body.show_in_recipe_list ? 1 : 0
    )
    .run();

  return c.json({ id: result.meta.last_row_id }, 201);
});

cookbooks.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<CookbookPayload>();

  if (!body.title || !body.title.trim()) {
    return c.json({ error: "Le titre est obligatoire" }, 400);
  }

  // The cover isn't part of the edit form — it has its own upload endpoints —
  // so an absent cover_url has to mean "leave it alone". This is the same
  // trap that wiped every recipe photo on save (see PUT /api/recipes/:id); an
  // explicit null still clears it, for a caller that means to.
  const existing = await c.env.DB.prepare(
    "SELECT cover_url FROM cookbooks WHERE id = ?"
  )
    .bind(id)
    .first<{ cover_url: string | null }>();
  if (!existing) return c.json({ error: "Livre introuvable" }, 404);
  const coverUrl = body.cover_url !== undefined ? body.cover_url : existing.cover_url;

  await c.env.DB.prepare(
    `UPDATE cookbooks SET
       title = ?, author = ?, publisher = ?, year = ?, isbn = ?, page_count = ?,
       description = ?, cover_url = ?, notes = ?, source_file_name = ?,
       source_file_size = ?, show_in_recipe_list = ?
     WHERE id = ?`
  )
    .bind(
      body.title.trim(),
      body.author ?? null,
      body.publisher ?? null,
      body.year ?? null,
      body.isbn ?? null,
      body.page_count ?? null,
      body.description ?? null,
      coverUrl,
      body.notes ?? null,
      body.source_file_name ?? null,
      body.source_file_size ?? null,
      body.show_in_recipe_list ? 1 : 0,
      id
    )
    .run();

  return c.json({ ok: true });
});

// Just the visibility switch, so toggling it from the book's page doesn't have
// to round-trip every other field and risk clobbering a concurrent edit.
cookbooks.put("/:id/visibility", async (c) => {
  const id = c.req.param("id");
  const { show_in_recipe_list } = await c.req.json<{ show_in_recipe_list?: boolean }>();

  const result = await c.env.DB.prepare(
    "UPDATE cookbooks SET show_in_recipe_list = ? WHERE id = ?"
  )
    .bind(show_in_recipe_list ? 1 : 0, id)
    .run();

  if (!result.meta.changes) return c.json({ error: "Livre introuvable" }, 404);
  return c.json({ ok: true });
});

/**
 * Deleting a book is not the same question as deleting the recipes taken from
 * it, so the caller has to say which it means: `?recipes=keep` (the default)
 * leaves them as ordinary recipes, `?recipes=delete` removes them too.
 *
 * Keep is the default because it's the recoverable choice — an imported recipe
 * you've since edited, planned a meal around, or added to a list shouldn't
 * vanish because you tidied the shelf.
 */
cookbooks.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const alsoDeleteRecipes = c.req.query("recipes") === "delete";

  const exists = await c.env.DB.prepare("SELECT id FROM cookbooks WHERE id = ?")
    .bind(id)
    .first();
  if (!exists) return c.json({ error: "Livre introuvable" }, 404);

  let deletedRecipes = 0;

  if (alsoDeleteRecipes) {
    const { results } = await c.env.DB.prepare(
      "SELECT id FROM recipes WHERE cookbook_id = ?"
    )
      .bind(id)
      .all<{ id: number }>();
    const recipeIds = results.map((r) => r.id);

    if (recipeIds.length) {
      const placeholders = recipeIds.map(() => "?").join(", ");
      // grocery_items.recipe_id is the one foreign key to recipes without an
      // ON DELETE clause, so the delete below fails the constraint unless the
      // link is dropped first — same fixup as DELETE /api/recipes/:id. The
      // item stays on the list: you still need to buy it.
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE grocery_items SET recipe_id = NULL WHERE recipe_id IN (${placeholders})`
        ).bind(...recipeIds),
        c.env.DB.prepare(`DELETE FROM recipes WHERE id IN (${placeholders})`).bind(
          ...recipeIds
        ),
      ]);
      // Their rows are gone, so nothing can reference these any more.
      await Promise.all(
        recipeIds.map((recipeId) => deleteStaleObjects(c.env, `recipes/${recipeId}/`))
      );
      deletedRecipes = recipeIds.length;
    }
  }

  // cookbook_entries cascade; any surviving recipe's cookbook_id is set to
  // NULL by its own foreign key.
  await c.env.DB.prepare("DELETE FROM cookbooks WHERE id = ?").bind(id).run();
  await deleteStaleObjects(c.env, coverPrefix(id));

  return c.json({ ok: true, deleted_recipes: deletedRecipes });
});

// ---------------------------------------------------------------------------
// Cover art
//
// Stored in the same R2 bucket as recipe photos, under cookbooks/<id>/, and
// served by the existing GET /photos/* route in index.ts.
// ---------------------------------------------------------------------------

cookbooks.post("/:id/cover", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData();
  const file = form.get("cover");

  if (!isUploadedFile(file)) {
    return c.json({ error: "Aucune image fournie" }, 400);
  }
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    return c.json({ error: PHOTO_TYPE_ERROR }, 400);
  }

  const key = `${coverPrefix(id)}${Date.now()}-${file.name}`;
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  const coverUrl = `/photos/${key}`;
  await c.env.DB.prepare("UPDATE cookbooks SET cover_url = ? WHERE id = ?")
    .bind(coverUrl, id)
    .run();
  await deleteStaleObjects(c.env, coverPrefix(id), key);

  return c.json({ cover_url: coverUrl });
});

// Used right after a lookup: the cover it found is a URL on
// covers.openlibrary.org or books.google.com, and copying it into R2 means the
// catalogue doesn't break when someone else's CDN changes its mind.
cookbooks.post("/:id/cover-from-url", async (c) => {
  const id = c.req.param("id");
  const { url } = await c.req.json<{ url?: string }>();

  if (!url || !isHttpUrl(url)) {
    return c.json({ error: "URL invalide (http ou https requis)" }, 400);
  }

  let imgResponse: Response;
  try {
    imgResponse = await fetch(url);
  } catch {
    return c.json({ error: "Impossible de télécharger cette image" }, 400);
  }
  if (!imgResponse.ok) {
    return c.json({ error: "Impossible de télécharger cette image" }, 400);
  }

  const contentType = imgResponse.headers.get("content-type") ?? "";
  if (!ALLOWED_PHOTO_TYPES.has(contentType)) {
    return c.json({ error: PHOTO_TYPE_ERROR }, 400);
  }

  const key = `${coverPrefix(id)}${Date.now()}-cover`;
  await c.env.PHOTOS.put(key, await imgResponse.arrayBuffer(), {
    httpMetadata: { contentType },
  });

  const coverUrl = `/photos/${key}`;
  await c.env.DB.prepare("UPDATE cookbooks SET cover_url = ? WHERE id = ?")
    .bind(coverUrl, id)
    .run();
  await deleteStaleObjects(c.env, coverPrefix(id), key);

  return c.json({ cover_url: coverUrl });
});

// ---------------------------------------------------------------------------
// The recipe index inside a book
//
// The browser reads the PDF and posts text — the file itself never leaves the
// machine, exactly as the single-recipe PDF import already works. See
// frontend/src/lib/pdfPages.ts.
// ---------------------------------------------------------------------------

// A whole cookbook is megabytes of text, so these take slices rather than the
// book: the front matter to find the contents in, and one or two lines per
// page to locate where the printed numbering starts. Generous enough for a
// large book's front matter, small enough that a mistake is a 413 rather than
// a stalled request.
const MAX_TOC_PAGES = 120;
const MAX_HEADING_PAGES = 2000;
const MAX_ENTRIES = 3000;
// One page of a cookbook. Far below the recipe import's 200k cap because this
// is a single page, and a much larger payload means something went wrong.
const MAX_PAGE_TEXT_LENGTH = 20_000;

interface TocRequest {
  /** Front-of-book pages, full text, for finding and reading the contents. */
  pages?: TocPage[];
  /** Every page's first few lines, for working out the page-number offset. */
  headings?: TocPage[];
}

/**
 * Reads a book's printed contents. Writes nothing — like the recipe URL
 * import, it returns a proposal the user confirms before anything is stored.
 */
cookbooks.post("/:id/toc", async (c) => {
  const body = await c.req.json<TocRequest>();
  const pages = Array.isArray(body.pages) ? body.pages : [];
  const headings = Array.isArray(body.headings) ? body.headings : [];

  if (!pages.length) {
    return c.json({ error: "Aucune page n'a été transmise" }, 400);
  }
  if (pages.length > MAX_TOC_PAGES || headings.length > MAX_HEADING_PAGES) {
    return c.json({ error: "Ce document est trop volumineux" }, 413);
  }

  const parsed = parseTableOfContents(pages);
  // The offset needs the body of the book, which is what `headings` carries;
  // fall back to the front pages alone rather than refusing to answer.
  const offset = parsed.entries.length
    ? estimatePageOffset(headings.length ? headings : pages, parsed.entries, parsed.toc_pages)
    : null;

  return c.json({ ...parsed, page_offset: offset });
});

/**
 * Stores what the contents produced, merging into whatever is already there.
 *
 * Additive: see cookbookIndex.ts. Re-scanning a book is always safe, and an
 * entry already linked to a recipe is never touched.
 */
cookbooks.post("/:id/index", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ entries?: IncomingEntry[] }>();
  const entries = Array.isArray(body.entries) ? body.entries : [];

  const exists = await c.env.DB.prepare("SELECT id FROM cookbooks WHERE id = ?")
    .bind(id)
    .first();
  if (!exists) return c.json({ error: "Livre introuvable" }, 404);

  if (!entries.length) return c.json({ error: "Aucune recette à enregistrer" }, 400);
  if (entries.length > MAX_ENTRIES) {
    return c.json({ error: "Trop de recettes dans cette table des matières" }, 413);
  }

  const stored = await c.env.DB.prepare(
    `SELECT id, title, title_key, page_number, end_page, chapter, recipe_id
     FROM cookbook_entries WHERE cookbook_id = ?`
  )
    .bind(id)
    .all<StoredEntry>();

  const plan = mergeEntries(stored.results, withEndPages(entries));

  const statements = [
    ...plan.insert.map((entry) =>
      c.env.DB.prepare(
        `INSERT INTO cookbook_entries
           (cookbook_id, title, title_key, page_number, end_page, chapter)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cookbook_id, page_number, title_key) DO NOTHING`
      ).bind(
        id,
        entry.title,
        entry.title_key,
        entry.page_number ?? null,
        entry.end_page ?? null,
        entry.chapter ?? null
      )
    ),
    ...plan.update.map((entry) =>
      c.env.DB.prepare(
        "UPDATE cookbook_entries SET end_page = ?, chapter = ? WHERE id = ?"
      ).bind(entry.end_page, entry.chapter, entry.id)
    ),
  ];

  if (statements.length) await c.env.DB.batch(statements);

  return c.json({
    added: plan.insert.length,
    updated: plan.update.length,
    unchanged: plan.unchanged,
  });
});

/** The stored index, with what has been imported and what looks familiar. */
cookbooks.get("/:id/entries", async (c) => {
  const id = c.req.param("id");

  const exists = await c.env.DB.prepare("SELECT id FROM cookbooks WHERE id = ?")
    .bind(id)
    .first();
  if (!exists) return c.json({ error: "Livre introuvable" }, 404);

  const entries = await c.env.DB.prepare(
    `SELECT id, title, title_key, page_number, end_page, chapter, recipe_id, imported_at
     FROM cookbook_entries WHERE cookbook_id = ?`
  )
    .bind(id)
    .all<StoredEntry & { imported_at: string | null }>();

  // Everything you already have that did NOT come from this book, so a
  // bundle that ships the same title twice can be spotted before importing.
  const elsewhere = await c.env.DB.prepare(
    `SELECT r.title, cb.title AS cookbook_title
     FROM recipes r
     LEFT JOIN cookbooks cb ON cb.id = r.cookbook_id
     WHERE r.cookbook_id IS NULL OR r.cookbook_id != ?`
  )
    .bind(id)
    .all<{ title: string; cookbook_title: string | null }>();

  const duplicates = findCrossBookDuplicates(
    entries.results.map((e) => ({ title: e.title, page_number: e.page_number })),
    elsewhere.results
  );
  const byKey = new Map(duplicates.map((d) => [titleKey(d.title), d]));

  return c.json({
    entries: entries.results.map((entry) => ({
      ...entry,
      duplicate_of: byKey.get(entry.title_key) ?? null,
    })),
    imported: entries.results.filter((e) => e.recipe_id !== null).length,
  });
});

/**
 * Extracts every recipe on one page and files them under this book.
 *
 * A page at a time, not a recipe at a time. In a real cookbook 77% of recipes
 * shared a page with another and one page held eight, so per-recipe calls
 * would be both eight times the cost and worse: the model needs to see the
 * whole page to attribute ingredients to the right recipe.
 *
 * The caller sends the page's text, which it read locally. The entries to
 * match against come from this book's stored index.
 */
cookbooks.post("/:id/pages/:page/import", async (c) => {
  const id = c.req.param("id");
  const pageNumber = Number(c.req.param("page"));
  const { text } = await c.req.json<{ text?: string }>();

  if (!Number.isFinite(pageNumber)) {
    return c.json({ error: "Numéro de page invalide" }, 400);
  }
  if (!text || !text.trim()) {
    return c.json({ error: "Aucun texte n'a été transmis pour cette page" }, 400);
  }
  if (text.length > MAX_PAGE_TEXT_LENGTH) {
    return c.json({ error: "Cette page est trop volumineuse" }, 413);
  }

  const book = await c.env.DB.prepare("SELECT id FROM cookbooks WHERE id = ?")
    .bind(id)
    .first();
  if (!book) return c.json({ error: "Livre introuvable" }, 404);

  // Only entries not already imported. Re-checked here rather than trusted
  // from the client: this is what stops a recipe being imported twice, so the
  // server has to be the one enforcing it.
  const pending = await c.env.DB.prepare(
    `SELECT id, title, title_key, chapter FROM cookbook_entries
     WHERE cookbook_id = ? AND page_number = ? AND recipe_id IS NULL`
  )
    .bind(id, pageNumber)
    .all<{ id: number; title: string; title_key: string; chapter: string | null }>();

  if (!pending.results.length) {
    return c.json({ imported: [], skipped: "already", cost_usd: 0 });
  }

  const extraction = await extractRecipesFromPage(
    c.env.ANTHROPIC_API_KEY,
    text,
    pending.results.map((e) => e.title)
  );

  const unclaimed = [...pending.results];
  const imported: { entry_id: number; recipe_id: number; title: string }[] = [];

  for (const extracted of extraction.recipes) {
    const recipe = toImportedRecipe(extracted);
    if (!recipe.title.trim() || !recipe.ingredients.length) continue;

    // Match back to the entry the contents promised, so the recipe lands under
    // the right title and that entry stops being offered. An extra recipe the
    // contents didn't list is skipped rather than filed under a wrong entry.
    const key = foldForMatch(recipe.title);
    let index = unclaimed.findIndex((e) => e.title_key === key);
    if (index === -1) {
      index = unclaimed.findIndex(
        (e) => e.title_key.includes(key) || key.includes(e.title_key)
      );
    }
    if (index === -1) continue;
    const [entry] = unclaimed.splice(index, 1);

    const result = await c.env.DB.prepare(
      `INSERT INTO recipes
        (title, description, servings, prep_time, cook_time, notes, cookbook_id, cookbook_page)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        entry.title,
        recipe.description ?? null,
        recipe.servings ?? null,
        recipe.prep_time ?? null,
        recipe.cook_time ?? null,
        null,
        id,
        pageNumber
      )
      .run();
    const recipeId = result.meta.last_row_id;

    const statements = [
      ...recipe.ingredients.map((ing, idx) =>
        c.env.DB.prepare(
          `INSERT INTO ingredients (recipe_id, name, quantity, unit, aisle_category, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          recipeId,
          ing.name,
          ing.quantity ?? null,
          ing.unit ?? null,
          ing.aisle_category ?? null,
          idx
        )
      ),
      ...recipe.steps.map((step, idx) =>
        c.env.DB.prepare(
          "INSERT INTO steps (recipe_id, step_number, text) VALUES (?, ?, ?)"
        ).bind(recipeId, idx + 1, step)
      ),
      // Claiming the entry belongs in the same batch as the rows it describes.
      c.env.DB.prepare(
        `UPDATE cookbook_entries
         SET recipe_id = ?, imported_at = datetime('now')
         WHERE id = ? AND recipe_id IS NULL`
      ).bind(recipeId, entry.id),
    ];
    await c.env.DB.batch(statements);

    // The book's chapter is a useful tag; the model's own tags are noisier, so
    // the chapter wins and the rest follow it.
    for (const tag of [entry.chapter, ...recipe.tags].filter(Boolean).slice(0, 4)) {
      await c.env.DB.prepare(
        "INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING"
      )
        .bind(tag)
        .run();
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) SELECT ?, id FROM tags WHERE name = ?"
      )
        .bind(recipeId, tag)
        .run();
    }

    imported.push({ entry_id: entry.id, recipe_id: recipeId, title: entry.title });
  }

  return c.json({
    imported,
    not_found: unclaimed.map((e) => e.title),
    cost_usd: estimateCost(extraction.usage),
    usage: extraction.usage,
  });
});

export default cookbooks;
