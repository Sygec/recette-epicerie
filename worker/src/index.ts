import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { generateToken, requireAuth } from "./auth";
import {
  extractFromHtml,
  findRecipeInJsonLd,
  isHttpUrl,
  mapFallbackToRecipe,
  mapJsonLdToRecipe,
} from "./recipeImport";
import {
  findMergeTarget,
  loadAliasRows,
  matchFood,
  normalizeFoodText,
  updateNameConversionNote,
} from "./foodDictionary";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// Recipe photos are stored in R2 and later re-served with this same
// Content-Type, on the same origin as the app (see the ASSETS catch-all
// below). Without an allowlist, an uploaded file claiming to be text/html or
// image/svg+xml could execute as a same-origin page when its /photos/* URL
// is opened directly — a stored-XSS path to the session token in
// localStorage. Only accept real raster image types.
const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// ---------------------------------------------------------------------------
// Auth — shared login (one account, session token)
// ---------------------------------------------------------------------------

app.post("/api/auth/login", async (c) => {
  const { password } = await c.req.json<{ password: string }>();

  if (password !== c.env.APP_PASSWORD) {
    return c.json({ error: "Mot de passe incorrect" }, 401);
  }

  const token = generateToken();
  await c.env.DB.prepare("INSERT INTO sessions (token) VALUES (?)")
    .bind(token)
    .run();

  return c.json({ token });
});

app.post("/api/auth/logout", requireAuth, async (c) => {
  const token = c.req.header("Authorization")!.slice(7);
  await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?")
    .bind(token)
    .run();
  return c.json({ ok: true });
});

// Everything below requires a valid session.
app.use("/api/*", requireAuth);

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

app.get("/api/recipes", async (c) => {
  const search = c.req.query("q");
  const tag = c.req.query("tag");
  const favoritesOnly = c.req.query("favorites") === "1";

  let sql = `
    SELECT DISTINCT r.*
    FROM recipes r
    LEFT JOIN ingredients i ON i.recipe_id = r.id
    LEFT JOIN recipe_tags rt ON rt.recipe_id = r.id
    LEFT JOIN tags t ON t.id = rt.tag_id
    LEFT JOIN favorites f ON f.recipe_id = r.id
    WHERE 1=1
  `;
  const params: string[] = [];

  if (search) {
    sql += " AND (r.title LIKE ? OR i.name LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tag) {
    sql += " AND t.name = ?";
    params.push(tag);
  }
  if (favoritesOnly) {
    sql += " AND f.recipe_id IS NOT NULL";
  }
  sql += " ORDER BY r.created_at DESC";

  const { results } = await c.env.DB.prepare(sql)
    .bind(...params)
    .all();
  return c.json(results);
});

app.get("/api/recipes/:id", async (c) => {
  const id = c.req.param("id");

  const recipe = await c.env.DB.prepare("SELECT * FROM recipes WHERE id = ?")
    .bind(id)
    .first();
  if (!recipe) return c.json({ error: "Recette introuvable" }, 404);

  const ingredients = await c.env.DB.prepare(
    "SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY sort_order"
  )
    .bind(id)
    .all();
  const steps = await c.env.DB.prepare(
    "SELECT * FROM steps WHERE recipe_id = ? ORDER BY step_number"
  )
    .bind(id)
    .all();
  const tags = await c.env.DB.prepare(
    `SELECT t.* FROM tags t
     JOIN recipe_tags rt ON rt.tag_id = t.id
     WHERE rt.recipe_id = ?`
  )
    .bind(id)
    .all();
  const favorite = await c.env.DB.prepare(
    "SELECT recipe_id FROM favorites WHERE recipe_id = ?"
  )
    .bind(id)
    .first();

  return c.json({
    ...recipe,
    ingredients: ingredients.results,
    steps: steps.results,
    tags: tags.results,
    is_favorite: !!favorite,
  });
});

interface RecipePayload {
  title: string;
  description?: string;
  photo_url?: string;
  servings?: number;
  prep_time?: number;
  cook_time?: number;
  difficulty?: string;
  source_url?: string;
  notes?: string;
  ingredients?: { name: string; quantity?: number; unit?: string }[];
  steps?: { text: string }[];
  tags?: string[];
}

app.post("/api/recipes", async (c) => {
  const body = await c.req.json<RecipePayload>();

  if (!body.title || !body.title.trim()) {
    return c.json({ error: "Le titre est obligatoire" }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO recipes
      (title, description, photo_url, servings, prep_time, cook_time, difficulty, source_url, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.title,
      body.description ?? null,
      body.photo_url ?? null,
      body.servings ?? null,
      body.prep_time ?? null,
      body.cook_time ?? null,
      body.difficulty ?? null,
      body.source_url ?? null,
      body.notes ?? null
    )
    .run();

  const recipeId = result.meta.last_row_id;

  if (body.ingredients?.length) {
    const stmts = body.ingredients.map((ing, idx) =>
      c.env.DB.prepare(
        `INSERT INTO ingredients (recipe_id, name, quantity, unit, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(recipeId, ing.name, ing.quantity ?? null, ing.unit ?? null, idx)
    );
    await c.env.DB.batch(stmts);
  }

  if (body.steps?.length) {
    const stmts = body.steps.map((step, idx) =>
      c.env.DB.prepare(
        `INSERT INTO steps (recipe_id, step_number, text) VALUES (?, ?, ?)`
      ).bind(recipeId, idx + 1, step.text)
    );
    await c.env.DB.batch(stmts);
  }

  if (body.tags?.length) {
    for (const tagName of body.tags) {
      await c.env.DB.prepare(
        `INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING`
      )
        .bind(tagName)
        .run();
      await c.env.DB.prepare(
        `INSERT INTO recipe_tags (recipe_id, tag_id)
         SELECT ?, id FROM tags WHERE name = ?`
      )
        .bind(recipeId, tagName)
        .run();
    }
  }

  return c.json({ id: recipeId }, 201);
});

// Fetches a page server-side and extracts recipe fields from its schema.org
// Recipe JSON-LD (what recipe sites publish for Google's rich-snippet
// eligibility, so it's reliable even on JS-heavy sites), falling back to
// Open Graph tags (title/description/image only) when no structured recipe
// data is found. Returns a preview for the client to review/edit — nothing
// is saved here, including the image (still an external URL at this point;
// see /api/recipes/:id/photo-from-url for the actual download-to-R2 step,
// which only happens once the recipe is actually saved).
app.post("/api/recipes/import", async (c) => {
  const { url } = await c.req.json<{ url?: string }>();

  if (!url || !isHttpUrl(url)) {
    return c.json({ error: "URL invalide (http ou https requis)" }, 400);
  }

  let pageResponse: Response;
  try {
    pageResponse = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RecettesEtCoursesBot/1.0; +recette-epicerie)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
  } catch {
    return c.json({ error: "Impossible de joindre cette page" }, 400);
  }

  if (!pageResponse.ok) {
    return c.json(
      { error: `La page a répondu avec une erreur (${pageResponse.status})` },
      400
    );
  }
  const contentType = pageResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return c.json({ error: "Cette URL ne semble pas être une page web" }, 400);
  }

  const extracted = await extractFromHtml(pageResponse);
  const recipeNode = findRecipeInJsonLd(extracted.jsonLdBlocks);

  if (recipeNode) {
    return c.json(mapJsonLdToRecipe(recipeNode));
  }

  const fallback = mapFallbackToRecipe(extracted);
  if (fallback) {
    return c.json({
      ...fallback,
      warning:
        "Aucune donnée de recette structurée trouvée sur cette page — seuls le titre, la description et la photo ont pu être importés. Ajoutez les ingrédients et les étapes manuellement.",
    });
  }

  return c.json(
    { error: "Impossible d'extraire une recette de cette page. Essayez la saisie manuelle." },
    422
  );
});

app.put("/api/recipes/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<RecipePayload>();

  await c.env.DB.prepare(
    `UPDATE recipes SET
      title = ?, description = ?, photo_url = ?, servings = ?,
      prep_time = ?, cook_time = ?, difficulty = ?, source_url = ?, notes = ?
     WHERE id = ?`
  )
    .bind(
      body.title,
      body.description ?? null,
      body.photo_url ?? null,
      body.servings ?? null,
      body.prep_time ?? null,
      body.cook_time ?? null,
      body.difficulty ?? null,
      body.source_url ?? null,
      body.notes ?? null,
      id
    )
    .run();

  if (body.ingredients) {
    await c.env.DB.prepare("DELETE FROM ingredients WHERE recipe_id = ?")
      .bind(id)
      .run();
    const stmts = body.ingredients.map((ing, idx) =>
      c.env.DB.prepare(
        `INSERT INTO ingredients (recipe_id, name, quantity, unit, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(id, ing.name, ing.quantity ?? null, ing.unit ?? null, idx)
    );
    if (stmts.length) await c.env.DB.batch(stmts);
  }

  if (body.steps) {
    await c.env.DB.prepare("DELETE FROM steps WHERE recipe_id = ?")
      .bind(id)
      .run();
    const stmts = body.steps.map((step, idx) =>
      c.env.DB.prepare(
        `INSERT INTO steps (recipe_id, step_number, text) VALUES (?, ?, ?)`
      ).bind(id, idx + 1, step.text)
    );
    if (stmts.length) await c.env.DB.batch(stmts);
  }

  return c.json({ ok: true });
});

app.delete("/api/recipes/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM recipes WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// Photo upload — stores the file in R2 and returns its public path,
// which the client then saves onto the recipe's photo_url field.
app.post("/api/recipes/:id/photo", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData();
  const file = form.get("photo");

  const isFile = (v: unknown): v is File =>
    typeof v === "object" && v !== null && "arrayBuffer" in v && "name" in v;

  if (!isFile(file)) {
    return c.json({ error: "Aucune photo fournie" }, 400);
  }

  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    return c.json(
      { error: "Format de fichier non pris en charge (JPEG, PNG, WEBP ou GIF requis)" },
      400
    );
  }

  const key = `recipes/${id}/${Date.now()}-${file.name}`;
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  const photoUrl = `/photos/${key}`;
  await c.env.DB.prepare("UPDATE recipes SET photo_url = ? WHERE id = ?")
    .bind(photoUrl, id)
    .run();

  return c.json({ photo_url: photoUrl });
});

// Downloads an image from a URL server-side and stores it in R2, for the
// "photo imported from a recipe URL" flow — the client never handles the
// image bytes directly, and the same content-type allowlist used for direct
// uploads applies here too (the source page's claimed content-type can't be
// trusted any more than a client upload's can).
app.post("/api/recipes/:id/photo-from-url", async (c) => {
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
    return c.json(
      { error: "Format d'image non pris en charge (JPEG, PNG, WEBP ou GIF requis)" },
      400
    );
  }

  const key = `recipes/${id}/${Date.now()}-imported`;
  await c.env.PHOTOS.put(key, await imgResponse.arrayBuffer(), {
    httpMetadata: { contentType },
  });

  const photoUrl = `/photos/${key}`;
  await c.env.DB.prepare("UPDATE recipes SET photo_url = ? WHERE id = ?")
    .bind(photoUrl, id)
    .run();

  return c.json({ photo_url: photoUrl });
});

// Serves photos out of R2 (bound as PHOTOS) under /photos/*.
app.get("/photos/*", async (c) => {
  const key = c.req.path.replace(/^\/photos\//, "");
  const object = await c.env.PHOTOS.get(key);
  if (!object) return c.notFound();

  return new Response(object.body, {
    headers: {
      "Content-Type":
        object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000",
    },
  });
});

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

app.post("/api/recipes/:id/favorite", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(
    "INSERT INTO favorites (recipe_id) VALUES (?) ON CONFLICT(recipe_id) DO NOTHING"
  )
    .bind(id)
    .run();
  return c.json({ ok: true });
});

app.delete("/api/recipes/:id/favorite", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM favorites WHERE recipe_id = ?")
    .bind(id)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

app.get("/api/tags", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM tags ORDER BY name"
  ).all();
  return c.json(results);
});

// ---------------------------------------------------------------------------
// Categories (seeded aisle list)
// ---------------------------------------------------------------------------

app.get("/api/categories", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM categories ORDER BY default_sort_order"
  ).all();
  return c.json(results);
});

interface CategoryPayload {
  name: string;
}

app.post("/api/categories", async (c) => {
  const body = await c.req.json<CategoryPayload>();
  if (!body.name || !body.name.trim()) {
    return c.json({ error: "Le nom de la catégorie est obligatoire" }, 400);
  }

  const maxOrder = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(default_sort_order), 0) AS max FROM categories"
  ).first<{ max: number }>();

  const result = await c.env.DB.prepare(
    "INSERT INTO categories (name, is_custom, default_sort_order) VALUES (?, 1, ?)"
  )
    .bind(body.name.trim(), (maxOrder?.max ?? 0) + 1)
    .run();

  return c.json({ id: result.meta.last_row_id }, 201);
});

// Any category can be renamed, seeded or custom — "is_custom" only tracks
// where a category came from, not whether it's editable.
app.put("/api/categories/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<CategoryPayload>();
  if (!body.name || !body.name.trim()) {
    return c.json({ error: "Le nom de la catégorie est obligatoire" }, 400);
  }

  await c.env.DB.prepare("UPDATE categories SET name = ? WHERE id = ?")
    .bind(body.name.trim(), id)
    .run();

  return c.json({ ok: true });
});

// Only custom categories can be deleted — the seeded aisle list is the
// backbone the rest of the app assumes exists. Anything filed under a
// deleted category (grocery items, dictionary entries) is reassigned to
// "Autres / Non classé" rather than left pointing at nothing.
app.delete("/api/categories/:id", async (c) => {
  const id = c.req.param("id");

  const category = await c.env.DB.prepare(
    "SELECT is_custom FROM categories WHERE id = ?"
  )
    .bind(id)
    .first<{ is_custom: number }>();
  if (!category) return c.json({ error: "Catégorie introuvable" }, 404);
  if (!category.is_custom) {
    return c.json({ error: "Impossible de supprimer une catégorie par défaut" }, 400);
  }

  // Reassign to NULL, not to the "Autres / Non classé" row's id — items with
  // no category already display under that same fallback bucket (see
  // GroceryList's grouping), and using NULL keeps that a single bucket
  // instead of splitting it into two depending on how an item got there.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE grocery_items SET category_id = NULL WHERE category_id = ?"
    ).bind(id),
    c.env.DB.prepare(
      "UPDATE food_dictionary SET category_id = NULL WHERE category_id = ?"
    ).bind(id),
    c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id),
  ]);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Grocery list — Phase 1 keeps this to a single running list.
// ---------------------------------------------------------------------------

async function getOrCreateDefaultList(env: Env): Promise<number> {
  const existing = await env.DB.prepare(
    "SELECT id FROM grocery_lists ORDER BY created_at ASC LIMIT 1"
  ).first<{ id: number }>();
  if (existing) return existing.id;

  const result = await env.DB.prepare(
    "INSERT INTO grocery_lists (name) VALUES ('Liste de courses')"
  ).run();
  return result.meta.last_row_id as number;
}

app.get("/api/grocery-items", async (c) => {
  const listId = await getOrCreateDefaultList(c.env);
  const { results } = await c.env.DB.prepare(
    `SELECT gi.*, c.name AS category_name, c.default_sort_order, c.is_custom AS category_is_custom
     FROM grocery_items gi
     LEFT JOIN categories c ON c.id = gi.category_id
     WHERE gi.list_id = ?
     ORDER BY c.default_sort_order ASC, gi.id ASC`
  )
    .bind(listId)
    .all();
  return c.json(results);
});

interface GroceryItemPayload {
  name: string;
  quantity?: number;
  unit?: string;
  category_id?: number;
  recipe_id?: number;
}

// Cross-language recognition + merge (Phase 2): the item's free-text name is
// matched against the food dictionary to find its aisle category (unless one
// was already given explicitly) and its canonical food identity. If an
// unchecked line for the same food (or, lacking a dictionary match, the
// exact same name) already exists in the same unit, the quantities are
// summed into that line instead of creating a duplicate — matching units
// merge, mismatched units are listed separately. The item's displayed name
// is never rewritten by this; the dictionary only drives categorization and
// merge-matching.
app.post("/api/grocery-items", async (c) => {
  const listId = await getOrCreateDefaultList(c.env);
  const body = await c.req.json<GroceryItemPayload>();

  if (!body.name || !body.name.trim()) {
    return c.json({ error: "Le nom de l'article est obligatoire" }, 400);
  }

  const unit = body.unit ?? null;
  const aliasRows = await loadAliasRows(c.env.DB);
  const match = matchFood(body.name, aliasRows);
  const foodId = match?.food_id ?? null;
  const categoryId = body.category_id ?? match?.category_id ?? null;

  // Unit reconciliation happens in code, not SQL: an exact/synonym match is
  // tried first, then real conversion (volume<->volume or weight<->weight
  // only) — see findMergeTarget().
  const candidates = foodId
    ? await c.env.DB.prepare(
        `SELECT id, name, quantity, unit FROM grocery_items
         WHERE list_id = ? AND food_id = ? AND is_checked = 0`
      )
        .bind(listId, foodId)
        .all<{ id: number; name: string; quantity: number | null; unit: string | null }>()
    : await c.env.DB.prepare(
        `SELECT id, name, quantity, unit FROM grocery_items
         WHERE list_id = ? AND food_id IS NULL AND is_checked = 0
           AND lower(trim(name)) = ?`
      )
        .bind(listId, normalizeFoodText(body.name))
        .all<{ id: number; name: string; quantity: number | null; unit: string | null }>();

  const target = findMergeTarget(candidates.results, body.quantity ?? null, unit);

  if (target) {
    // The target's own unit doesn't change on a merge (only the quantity
    // does), but a trailing size-conversion note baked into its name at
    // import time — e.g. "poudre de chili (1/4 tasse)" — described the
    // pre-merge quantity and needs recomputing so it doesn't go stale.
    const updatedName = updateNameConversionNote(
      target.row.name,
      target.row.unit,
      target.mergedQuantity
    );
    await c.env.DB.prepare("UPDATE grocery_items SET quantity = ?, name = ? WHERE id = ?")
      .bind(target.mergedQuantity, updatedName, target.row.id)
      .run();
    return c.json({ id: target.row.id }, 200);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO grocery_items (list_id, name, quantity, unit, category_id, recipe_id, food_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      listId,
      body.name,
      body.quantity ?? null,
      unit,
      categoryId,
      body.recipe_id ?? null,
      foodId
    )
    .run();

  return c.json({ id: result.meta.last_row_id }, 201);
});

app.patch("/api/grocery-items/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    is_checked?: boolean;
    quantity?: number | null;
    unit?: string | null;
  }>();

  if (body.is_checked !== undefined) {
    await c.env.DB.prepare("UPDATE grocery_items SET is_checked = ? WHERE id = ?")
      .bind(body.is_checked ? 1 : 0, id)
      .run();
  }

  // Manual quantity/unit corrections (e.g. filling in a blank line created
  // by a quick-add that had no quantity to merge against). A trailing
  // size-conversion note baked into the name — see updateNameConversionNote
  // — is recomputed against the edited quantity/unit so it doesn't go
  // stale, same as after an automatic merge.
  if (body.quantity !== undefined || body.unit !== undefined) {
    const row = await c.env.DB.prepare(
      "SELECT name, quantity, unit FROM grocery_items WHERE id = ?"
    )
      .bind(id)
      .first<{ name: string; quantity: number | null; unit: string | null }>();
    if (!row) return c.json({ error: "Article introuvable" }, 404);

    const newQuantity = body.quantity !== undefined ? body.quantity : row.quantity;
    const newUnit = body.unit !== undefined ? body.unit : row.unit;
    const updatedName = updateNameConversionNote(row.name, newUnit, newQuantity);

    await c.env.DB.prepare(
      "UPDATE grocery_items SET quantity = ?, unit = ?, name = ? WHERE id = ?"
    )
      .bind(newQuantity, newUnit, updatedName, id)
      .run();
  }

  return c.json({ ok: true });
});

app.delete("/api/grocery-items/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM grocery_items WHERE id = ?")
    .bind(id)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Static frontend (single origin)
// ---------------------------------------------------------------------------
// The built SPA is served from the same Worker via the ASSETS binding. Static
// files (JS/CSS/manifest) are served by the platform before this Worker even
// runs; requests that don't match a file fall through to here. For client-side
// routes (e.g. /courses, /recettes/1) the ASSETS binding returns index.html,
// because [assets] not_found_handling is set to "single-page-application".
app.get("*", (c) => {
  const path = new URL(c.req.url).pathname;
  // Unknown API/photo paths should 404 as JSON, not fall back to the SPA shell.
  if (path.startsWith("/api/") || path.startsWith("/photos/")) {
    return c.notFound();
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
