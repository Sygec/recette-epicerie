// The cookbook catalogue: the books the user owns, and their metadata.
//
// A sub-router rather than more routes in index.ts, which is already past
// 1600 lines. Mounted at /api/cookbooks, so it sits under the requireAuth
// middleware index.ts installs on /api/* — there is no auth handling here.
//
// The recipe *index* inside a book (cookbook_entries) is deliberately not
// here yet: this file is the catalogue, and a cookbook with no file at all —
// a paper book on a shelf — is a first-class entry.

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

export default cookbooks;
