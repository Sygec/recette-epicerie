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
  normalizeFoodIdentity,
  normalizeFoodText,
  updateNameConversionNote,
} from "./foodDictionary";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// Hono's default for an uncaught throw is a plain-text "Internal Server
// Error". The client parses errors as JSON and falls back to a generic
// "Une erreur est survenue" when that fails, so the real cause — a missing
// column, a constraint violation — never reaches the person who could act on
// it. Return the message as JSON and log it for `wrangler tail`. The app sits
// behind a single shared password, so there's no wider audience to leak
// internals to, and a schema error that says what it is beats a mystery.
app.onError((err, c) => {
  console.error("Unhandled error:", err instanceof Error ? (err.stack ?? err.message) : err);
  return c.json(
    { error: err instanceof Error ? err.message : "Une erreur est survenue" },
    500
  );
});

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

  const fetchHeaders = {
    "User-Agent":
      "Mozilla/5.0 (compatible; RecettesEtCoursesBot/1.0; +recette-epicerie)",
    Accept: "text/html",
  };

  let pageResponse: Response;
  try {
    pageResponse = await fetch(url, { headers: fetchHeaders, redirect: "follow" });
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

  let extracted = await extractFromHtml(pageResponse);
  let recipeNode = findRecipeInJsonLd(extracted.jsonLdBlocks);

  // Some pages (e.g. a site's video-recipe teaser) don't carry Recipe JSON-LD
  // themselves but link to the real recipe page ("full recipe" / "recette
  // complète"). Follow that link once, same-origin only, and retry there.
  if (!recipeNode && extracted.fullRecipeLink) {
    try {
      const linkedUrl = new URL(extracted.fullRecipeLink, url);
      if (linkedUrl.host === new URL(url).host && linkedUrl.href !== url) {
        const linkedResponse = await fetch(linkedUrl.href, {
          headers: fetchHeaders,
          redirect: "follow",
        });
        const linkedContentType = linkedResponse.headers.get("content-type") ?? "";
        if (linkedResponse.ok && linkedContentType.includes("text/html")) {
          const linkedExtracted = await extractFromHtml(linkedResponse);
          const linkedRecipeNode = findRecipeInJsonLd(linkedExtracted.jsonLdBlocks);
          if (linkedRecipeNode) {
            extracted = linkedExtracted;
            recipeNode = linkedRecipeNode;
          }
        }
      }
    } catch {
      // Malformed link or unreachable — fall through to the fallback below.
    }
  }

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

  // The photo isn't part of the edit form — it's set by its own upload
  // endpoints — so the form doesn't round-trip photo_url and an absent key
  // has to mean "leave it alone". Treating absent as null wiped the photo of
  // every recipe on every save, and orphaned the R2 object behind it. An
  // explicit null still clears it, for a caller that actually means to.
  const existing = await c.env.DB.prepare("SELECT photo_url FROM recipes WHERE id = ?")
    .bind(id)
    .first<{ photo_url: string | null }>();
  if (!existing) return c.json({ error: "Recette introuvable" }, 404);
  const photoUrl = body.photo_url !== undefined ? body.photo_url : existing.photo_url;

  await c.env.DB.prepare(
    `UPDATE recipes SET
      title = ?, description = ?, photo_url = ?, servings = ?,
      prep_time = ?, cook_time = ?, difficulty = ?, source_url = ?, notes = ?
     WHERE id = ?`
  )
    .bind(
      body.title,
      body.description ?? null,
      photoUrl,
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

  // grocery_items.recipe_id is the one foreign key to recipes without an
  // ON DELETE clause (ingredients, steps, tags and meal-plan entries all
  // cascade), so deleting a recipe that had been added to a list failed the
  // constraint and the whole delete threw. Drop the link but keep the item:
  // it's still on the list because you still need to buy it, whatever became
  // of the recipe it came from.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE grocery_items SET recipe_id = NULL WHERE recipe_id = ?").bind(
      id
    ),
    c.env.DB.prepare("DELETE FROM recipes WHERE id = ?").bind(id),
  ]);

  // The row is gone, so nothing can reference these any more.
  await deleteStalePhotos(c.env, id);
  return c.json({ ok: true });
});

// Photos live in R2 under a "recipes/<id>/" prefix, but only the key named by
// recipes.photo_url is ever served. Anything else under that prefix is a
// previous photo nothing points at any more, so replacing a photo has to
// clean up after itself or every re-upload leaves a permanent orphan.
// Deletion is best-effort: losing the DB row's new photo because a stale
// object couldn't be removed would be a worse trade.
async function deleteStalePhotos(env: Env, recipeId: string, keepKey?: string) {
  try {
    const listed = await env.PHOTOS.list({ prefix: `recipes/${recipeId}/` });
    const stale = listed.objects.map((o) => o.key).filter((k) => k !== keepKey);
    if (stale.length) await env.PHOTOS.delete(stale);
  } catch (err) {
    console.error("Could not clean up photos for recipe", recipeId, err);
  }
}

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
  await deleteStalePhotos(c.env, id, key);

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
  await deleteStalePhotos(c.env, id, key);

  return c.json({ photo_url: photoUrl });
});

// ---------------------------------------------------------------------------
// Photo maintenance
//
// Nothing deleted from R2 until recently, so the bucket accumulated objects
// nothing points at: photos replaced by a re-upload, photos of deleted
// recipes, and photos of recipes whose photo_url was wiped by a save (see
// PUT /api/recipes/:id). This audits the bucket against the database and
// proposes what to do; it never acts on its own.
//
// Keys are "recipes/<recipeId>/<millis>-<name>", which is what makes an
// object attributable to a recipe even after its photo_url is gone — and so
// what makes recovering a wiped photo possible rather than guesswork.
// ---------------------------------------------------------------------------

type PhotoVerdict =
  | "in_use" // the recipe's current photo — never touched
  | "restorable" // recipe exists with no photo; best candidate to put back
  | "superseded" // recipe has a different current photo, or a better candidate
  | "dangling" // the recipe itself is gone
  | "unattributable"; // key doesn't follow the recipes/<id>/ layout

interface PhotoAuditEntry {
  key: string;
  size: number;
  uploaded: string;
  recipe_id: number | null;
  recipe_title: string | null;
  verdict: PhotoVerdict;
}

async function listAllPhotos(env: Env) {
  const all: { key: string; size: number; uploaded: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PHOTOS.list({ prefix: "recipes/", cursor });
    all.push(...page.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return all;
}

async function auditPhotos(env: Env) {
  const objects = await listAllPhotos(env);
  const { results: recipes } = await env.DB.prepare(
    "SELECT id, title, photo_url FROM recipes"
  ).all<{ id: number; title: string; photo_url: string | null }>();
  const byId = new Map(recipes.map((r) => [r.id, r]));

  const entries: PhotoAuditEntry[] = objects.map((o) => {
    const match = o.key.match(/^recipes\/(\d+)\//);
    if (!match) {
      return {
        key: o.key,
        size: o.size,
        uploaded: o.uploaded.toISOString(),
        recipe_id: null,
        recipe_title: null,
        verdict: "unattributable" as PhotoVerdict,
      };
    }
    const recipeId = Number(match[1]);
    const recipe = byId.get(recipeId);
    let verdict: PhotoVerdict;
    if (!recipe) verdict = "dangling";
    else if (recipe.photo_url === `/photos/${o.key}`) verdict = "in_use";
    else if (recipe.photo_url == null) verdict = "restorable";
    else verdict = "superseded";
    return {
      key: o.key,
      size: o.size,
      uploaded: o.uploaded.toISOString(),
      recipe_id: recipeId,
      recipe_title: recipe?.title ?? null,
      verdict,
    };
  });

  // A recipe with no photo may have several leftover objects. Only the most
  // recent is worth putting back; the rest were already superseded before the
  // photo_url was lost, so they'd have been deleted anyway.
  const restorable = new Map<number, PhotoAuditEntry>();
  for (const e of entries) {
    if (e.verdict !== "restorable" || e.recipe_id == null) continue;
    const best = restorable.get(e.recipe_id);
    if (!best || e.uploaded > best.uploaded) restorable.set(e.recipe_id, e);
  }
  for (const e of entries) {
    if (e.verdict === "restorable" && restorable.get(e.recipe_id!)?.key !== e.key) {
      e.verdict = "superseded";
    }
  }

  const remap = Array.from(restorable.values()).map((e) => ({
    recipe_id: e.recipe_id!,
    recipe_title: e.recipe_title,
    photo_url: `/photos/${e.key}`,
    uploaded: e.uploaded,
  }));
  const deletable = entries.filter(
    (e) => e.verdict === "superseded" || e.verdict === "dangling"
  );

  return {
    entries,
    remap,
    delete_keys: deletable.map((e) => e.key),
    summary: {
      total: entries.length,
      in_use: entries.filter((e) => e.verdict === "in_use").length,
      restorable: remap.length,
      superseded: entries.filter((e) => e.verdict === "superseded").length,
      dangling: entries.filter((e) => e.verdict === "dangling").length,
      unattributable: entries.filter((e) => e.verdict === "unattributable").length,
      reclaimed_bytes: deletable.reduce((n, e) => n + e.size, 0),
    },
  };
}

app.get("/api/maintenance/photo-audit", async (c) => c.json(await auditPhotos(c.env)));

// Applies exactly what it is given — the keys and remappings the caller has
// already seen — rather than recomputing a plan that might have drifted since.
// Each deletion is re-checked against the live photo_url set first, so a key
// that became someone's current photo between audit and apply survives
// regardless of what the caller asked for.
app.post("/api/maintenance/photo-cleanup", async (c) => {
  const body = await c.req.json<{
    delete_keys?: string[];
    remap?: { recipe_id: number; photo_url: string }[];
  }>();

  const remapped: { recipe_id: number; photo_url: string }[] = [];
  for (const entry of body.remap ?? []) {
    if (!entry.photo_url?.startsWith("/photos/recipes/")) continue;
    // Only fills a gap; never overwrites a photo the recipe already has.
    const res = await c.env.DB.prepare(
      "UPDATE recipes SET photo_url = ? WHERE id = ? AND photo_url IS NULL"
    )
      .bind(entry.photo_url, entry.recipe_id)
      .run();
    if (res.meta.changes) remapped.push(entry);
  }

  const { results: live } = await c.env.DB.prepare(
    "SELECT photo_url FROM recipes WHERE photo_url IS NOT NULL"
  ).all<{ photo_url: string }>();
  const inUse = new Set(live.map((r) => r.photo_url));

  const requested = (body.delete_keys ?? []).filter((k) => k.startsWith("recipes/"));
  const deleted = requested.filter((k) => !inUse.has(`/photos/${k}`));
  const skipped = requested.filter((k) => inUse.has(`/photos/${k}`));

  // R2 caps a bulk delete at 1000 keys.
  for (let i = 0; i < deleted.length; i += 1000) {
    await c.env.PHOTOS.delete(deleted.slice(i, i + 1000));
  }

  return c.json({ remapped, deleted, skipped });
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
// Meal planning (Phase 3) — one planned souper (dinner) per day, keyed by
// date rather than a separate week/month entity (see meal_plan_entries'
// UNIQUE(date)). Assigning a new recipe to an already-planned day replaces
// it via the same POST, which is also how a day's servings get edited
// (re-POST the same recipe_id with a new servings value).
// ---------------------------------------------------------------------------

interface MealPlanEntryRow {
  id: number;
  date: string;
  recipe_id: number;
  servings: number | null;
  notes: string | null;
  recipe_title: string;
  recipe_photo_url: string | null;
  recipe_servings: number | null;
}

app.get("/api/meal-plan", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  if (!start || !end) {
    return c.json({ error: "start et end sont requis" }, 400);
  }

  const { results: entries } = await c.env.DB.prepare(
    `SELECT mpe.id, mpe.date, mpe.recipe_id, mpe.servings, mpe.notes,
            r.title AS recipe_title, r.photo_url AS recipe_photo_url, r.servings AS recipe_servings
     FROM meal_plan_entries mpe
     JOIN recipes r ON r.id = mpe.recipe_id
     WHERE mpe.date >= ? AND mpe.date <= ?
     ORDER BY mpe.date ASC`
  )
    .bind(start, end)
    .all<MealPlanEntryRow>();

  if (entries.length === 0) return c.json([]);

  // A second query for ingredients (not a join) — a join would multiply
  // each entry row by its ingredient count, and every entry needs its full
  // ingredient list anyway for the "add the week to the grocery list" flow.
  const recipeIds = [...new Set(entries.map((e) => e.recipe_id))];
  const placeholders = recipeIds.map(() => "?").join(",");
  const { results: ingredients } = await c.env.DB.prepare(
    `SELECT * FROM ingredients WHERE recipe_id IN (${placeholders}) ORDER BY sort_order`
  )
    .bind(...recipeIds)
    .all<{ id: number; recipe_id: number; name: string; quantity: number | null; unit: string | null }>();

  const byRecipe = new Map<number, typeof ingredients>();
  for (const ing of ingredients) {
    if (!byRecipe.has(ing.recipe_id)) byRecipe.set(ing.recipe_id, []);
    byRecipe.get(ing.recipe_id)!.push(ing);
  }

  return c.json(
    entries.map((e) => ({ ...e, ingredients: byRecipe.get(e.recipe_id) ?? [] }))
  );
});

interface MealPlanPayload {
  date: string;
  recipe_id: number;
  servings?: number;
  notes?: string;
}

app.post("/api/meal-plan", async (c) => {
  const body = await c.req.json<MealPlanPayload>();
  if (!body.date || !body.recipe_id) {
    return c.json({ error: "date et recipe_id sont requis" }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO meal_plan_entries (date, recipe_id, servings, notes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       recipe_id = excluded.recipe_id,
       servings = excluded.servings,
       notes = excluded.notes`
  )
    .bind(body.date, body.recipe_id, body.servings ?? null, body.notes ?? null)
    .run();

  return c.json({ ok: true });
});

app.delete("/api/meal-plan/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM meal_plan_entries WHERE id = ?")
    .bind(id)
    .run();
  return c.json({ ok: true });
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
// Stores — each grocery list is optionally tied to one, both to label the
// list ("IGA", "Costco") and to drive its aisle ordering below.
// ---------------------------------------------------------------------------

app.get("/api/stores", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM stores ORDER BY name"
  ).all();
  return c.json(results);
});

interface StorePayload {
  name: string;
}

app.post("/api/stores", async (c) => {
  const body = await c.req.json<StorePayload>();
  if (!body.name || !body.name.trim()) {
    return c.json({ error: "Le nom du magasin est obligatoire" }, 400);
  }
  const result = await c.env.DB.prepare("INSERT INTO stores (name) VALUES (?)")
    .bind(body.name.trim())
    .run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.put("/api/stores/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<StorePayload>();
  if (!body.name || !body.name.trim()) {
    return c.json({ error: "Le nom du magasin est obligatoire" }, 400);
  }
  await c.env.DB.prepare("UPDATE stores SET name = ? WHERE id = ?")
    .bind(body.name.trim(), id)
    .run();
  return c.json({ ok: true });
});

// A list whose store gets deleted keeps working — it just falls back to
// default category ordering (see GET /api/grocery-items) — same pattern as
// deleting a custom category reassigning affected items rather than leaving
// a dangling reference.
app.delete("/api/stores/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE grocery_lists SET store_id = NULL WHERE store_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM stores WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

// A store only needs rows here for categories the user actually dragged
// into a custom position — one not listed simply falls back to that
// category's default_sort_order (resolved client-side, alongside the
// existing /api/categories fetch).
app.get("/api/stores/:id/category-order", async (c) => {
  const id = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    "SELECT category_id, sort_order FROM store_category_order WHERE store_id = ? ORDER BY sort_order ASC"
  )
    .bind(id)
    .all();
  return c.json(results);
});

// Replace-all: the client sends the full ordered list of category ids for
// this store, and the server assigns 0..n-1 — simplest contract for a
// reorder UI, no partial-update bookkeeping.
app.put("/api/stores/:id/category-order", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ category_ids?: number[] }>();
  if (!Array.isArray(body.category_ids)) {
    return c.json({ error: "category_ids doit être une liste" }, 400);
  }

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM store_category_order WHERE store_id = ?").bind(id),
    ...body.category_ids.map((categoryId, idx) =>
      c.env.DB.prepare(
        "INSERT INTO store_category_order (store_id, category_id, sort_order) VALUES (?, ?, ?)"
      ).bind(id, categoryId, idx)
    ),
  ]);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Food dictionary — user-editable
//
// The dictionary decides two things: which aisle an item lands in, and which
// items merge into one line. Both used to be fixed at seed time, so a wrong
// or missing entry could only be corrected by editing schema.sql and running
// wrangler d1 execute. These routes make it editable from the app.
//
// The matching rule itself (see matchFood) is deliberately unchanged: it is
// word-bounded containment with longest-alias-wins, which is what lets a
// recipe line like "1 tasse de crème sure, à température ambiante" resolve
// to "crème sure". The consequence is that an unqualified alias swallows its
// own compounds — "sucre en poudre" matches the alias "sucre" — and the fix
// for that is to give the compound its own entry here, at which point the
// longer alias wins. That is the main thing these routes exist for.
// ---------------------------------------------------------------------------

interface AliasConflict {
  alias: string;
  canonical_name: string;
}

// food_aliases.alias is UNIQUE across the whole table, so a clash is always
// with some other food's alias. Look up which one, so the error can name it
// instead of surfacing a bare constraint failure.
async function findAliasConflict(
  db: D1Database,
  alias: string,
  ignoreFoodId?: number
): Promise<AliasConflict | null> {
  const row = await db
    .prepare(
      `SELECT fa.alias AS alias, fa.food_id AS food_id, fd.canonical_name AS canonical_name
       FROM food_aliases fa
       JOIN food_dictionary fd ON fd.id = fa.food_id
       WHERE fa.alias = ?`
    )
    .bind(alias)
    .first<{ alias: string; food_id: number; canonical_name: string }>();
  if (!row) return null;
  if (ignoreFoodId != null && row.food_id === ignoreFoodId) return null;
  return { alias: row.alias, canonical_name: row.canonical_name };
}

function aliasConflictMessage(conflict: AliasConflict): string {
  return `« ${conflict.alias} » est déjà un synonyme de « ${conflict.canonical_name} »`;
}

app.get("/api/foods", async (c) => {
  // Two queries stitched together in JS rather than one grouped query:
  // SQLite has no json_agg, and GROUP_CONCAT would need escaping to survive
  // an alias containing the separator. The whole dictionary is small enough
  // to send in one response.
  const [foods, aliases] = await Promise.all([
    c.env.DB.prepare(
      `SELECT fd.id, fd.canonical_name, fd.category_id, c.name AS category_name
       FROM food_dictionary fd
       LEFT JOIN categories c ON c.id = fd.category_id
       ORDER BY fd.canonical_name COLLATE NOCASE`
    ).all<{
      id: number;
      canonical_name: string;
      category_id: number | null;
      category_name: string | null;
    }>(),
    c.env.DB.prepare(
      "SELECT id, food_id, alias, lang FROM food_aliases ORDER BY alias COLLATE NOCASE"
    ).all<{ id: number; food_id: number; alias: string; lang: string }>(),
  ]);

  const byFood = new Map<number, { id: number; alias: string; lang: string }[]>();
  for (const row of aliases.results) {
    const list = byFood.get(row.food_id) ?? [];
    list.push({ id: row.id, alias: row.alias, lang: row.lang });
    byFood.set(row.food_id, list);
  }

  return c.json(
    foods.results.map((food) => ({ ...food, aliases: byFood.get(food.id) ?? [] }))
  );
});

interface FoodPayload {
  canonical_name: string;
  category_id?: number | null;
  lang?: string;
}

app.post("/api/foods", async (c) => {
  const body = await c.req.json<FoodPayload>();
  // Aliases are stored lowercased and whitespace-collapsed (matching the
  // seed), so the UNIQUE constraint catches "Sucre" vs "sucre" — which
  // matchFood would treat as the same word anyway.
  const name = normalizeFoodText(body.canonical_name ?? "");
  if (!name) return c.json({ error: "Le nom de l'aliment est obligatoire" }, 400);

  // matchFood only ever scans food_aliases, so a food with no alias can
  // never match anything the user types. The canonical name is inserted as
  // its first alias or the new entry would be inert.
  const conflict = await findAliasConflict(c.env.DB, name);
  if (conflict) return c.json({ error: aliasConflictMessage(conflict) }, 409);

  const result = await c.env.DB.prepare(
    "INSERT INTO food_dictionary (canonical_name, category_id) VALUES (?, ?)"
  )
    .bind(name, body.category_id ?? null)
    .run();
  const foodId = result.meta.last_row_id as number;

  await c.env.DB.prepare("INSERT INTO food_aliases (food_id, alias, lang) VALUES (?, ?, ?)")
    .bind(foodId, name, body.lang ?? "fr")
    .run();

  return c.json({ id: foodId }, 201);
});

// Renaming a food deliberately leaves its aliases alone — they are what the
// matcher actually reads, and the old name usually still needs to match.
app.patch("/api/foods/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<FoodPayload>>();

  if (body.canonical_name !== undefined) {
    const name = normalizeFoodText(body.canonical_name);
    if (!name) return c.json({ error: "Le nom de l'aliment est obligatoire" }, 400);
    await c.env.DB.prepare("UPDATE food_dictionary SET canonical_name = ? WHERE id = ?")
      .bind(name, id)
      .run();
  }

  if (body.category_id !== undefined) {
    if (body.category_id !== null) {
      const category = await c.env.DB.prepare("SELECT id FROM categories WHERE id = ?")
        .bind(body.category_id)
        .first<{ id: number }>();
      if (!category) return c.json({ error: "Catégorie introuvable" }, 400);
    }
    await c.env.DB.prepare("UPDATE food_dictionary SET category_id = ? WHERE id = ?")
      .bind(body.category_id, id)
      .run();
  }

  return c.json({ ok: true });
});

app.delete("/api/foods/:id", async (c) => {
  const id = c.req.param("id");

  // Grocery items point at the food; clear the reference rather than
  // orphaning it. Their name and category stay as they are — deleting a
  // dictionary entry shouldn't rewrite the list the user is shopping from.
  // Aliases are deleted explicitly rather than relying on ON DELETE CASCADE
  // firing.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE grocery_items SET food_id = NULL WHERE food_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM food_aliases WHERE food_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM food_dictionary WHERE id = ?").bind(id),
  ]);

  return c.json({ ok: true });
});

app.post("/api/foods/:id/aliases", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ alias: string; lang?: string }>();
  const alias = normalizeFoodText(body.alias ?? "");
  if (!alias) return c.json({ error: "Le synonyme est obligatoire" }, 400);

  const food = await c.env.DB.prepare("SELECT id FROM food_dictionary WHERE id = ?")
    .bind(id)
    .first<{ id: number }>();
  if (!food) return c.json({ error: "Aliment introuvable" }, 404);

  const conflict = await findAliasConflict(c.env.DB, alias, id);
  if (conflict) return c.json({ error: aliasConflictMessage(conflict) }, 409);

  // Already on this food — nothing to do, and re-inserting would trip the
  // UNIQUE constraint.
  const existing = await c.env.DB.prepare(
    "SELECT id FROM food_aliases WHERE alias = ? AND food_id = ?"
  )
    .bind(alias, id)
    .first<{ id: number }>();
  if (existing) return c.json({ id: existing.id }, 200);

  const result = await c.env.DB.prepare(
    "INSERT INTO food_aliases (food_id, alias, lang) VALUES (?, ?, ?)"
  )
    .bind(id, alias, body.lang ?? "fr")
    .run();

  return c.json({ id: result.meta.last_row_id }, 201);
});

app.delete("/api/aliases/:id", async (c) => {
  const id = c.req.param("id");

  const alias = await c.env.DB.prepare("SELECT food_id FROM food_aliases WHERE id = ?")
    .bind(id)
    .first<{ food_id: number }>();
  if (!alias) return c.json({ error: "Synonyme introuvable" }, 404);

  // A food with no aliases is invisible to matchFood — it would still occupy
  // a row but could never be matched again. Deleting the food is the way to
  // get rid of it, not stripping its last alias.
  const remaining = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM food_aliases WHERE food_id = ?"
  )
    .bind(alias.food_id)
    .first<{ count: number }>();
  if ((remaining?.count ?? 0) <= 1) {
    return c.json(
      { error: "Un aliment doit garder au moins un synonyme — supprimez l'aliment." },
      400
    );
  }

  await c.env.DB.prepare("DELETE FROM food_aliases WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Grocery lists — one per store (Phase 3), replacing the single implicit
// list Phase 1/2 assumed. Every grocery-item route below now takes an
// explicit list_id instead of resolving one automatically.
// ---------------------------------------------------------------------------

app.get("/api/grocery-lists", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT gl.*, s.name AS store_name
     FROM grocery_lists gl
     LEFT JOIN stores s ON s.id = gl.store_id
     ORDER BY gl.name COLLATE NOCASE ASC`
  ).all();
  return c.json(results);
});

interface GroceryListPayload {
  name: string;
  store_id?: number | null;
  // 'category' groups by aisle (using the store's order when it has one);
  // 'manual' is one flat list the user drags into shape. Per list, not
  // global — a Costco list can be manual while the IGA list stays by aisle.
  sort_mode?: SortMode;
}

const SORT_MODES = ["category", "manual"] as const;
type SortMode = (typeof SORT_MODES)[number];

app.post("/api/grocery-lists", async (c) => {
  const body = await c.req.json<GroceryListPayload>();
  if (!body.name || !body.name.trim()) {
    return c.json({ error: "Le nom de la liste est obligatoire" }, 400);
  }
  const result = await c.env.DB.prepare(
    "INSERT INTO grocery_lists (name, store_id) VALUES (?, ?)"
  )
    .bind(body.name.trim(), body.store_id ?? null)
    .run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.put("/api/grocery-lists/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<GroceryListPayload>>();

  const existing = await c.env.DB.prepare(
    "SELECT name, store_id, sort_mode FROM grocery_lists WHERE id = ?"
  )
    .bind(id)
    .first<{ name: string; store_id: number | null; sort_mode: SortMode }>();
  if (!existing) return c.json({ error: "Liste introuvable" }, 404);

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (!name) return c.json({ error: "Le nom de la liste est obligatoire" }, 400);
  const storeId = body.store_id !== undefined ? body.store_id : existing.store_id;

  if (body.sort_mode !== undefined && !SORT_MODES.includes(body.sort_mode)) {
    return c.json({ error: "Mode de tri inconnu" }, 400);
  }
  const sortMode = body.sort_mode !== undefined ? body.sort_mode : existing.sort_mode;

  await c.env.DB.prepare(
    "UPDATE grocery_lists SET name = ?, store_id = ?, sort_mode = ? WHERE id = ?"
  )
    .bind(name, storeId, sortMode, id)
    .run();
  return c.json({ ok: true });
});

// Cascades to the list's items via grocery_items.list_id's ON DELETE CASCADE.
app.delete("/api/grocery-lists/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM grocery_lists WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Grocery items
// ---------------------------------------------------------------------------

app.get("/api/grocery-items", async (c) => {
  const listId = c.req.query("list_id");
  if (!listId) return c.json({ error: "list_id est requis" }, 400);

  const list = await c.env.DB.prepare("SELECT sort_mode FROM grocery_lists WHERE id = ?")
    .bind(listId)
    .first<{ sort_mode: string }>();

  // In manual mode the user's own order is the only thing that matters, so
  // the aisle join is only for display. Items predating the position
  // backfill sort by id, which is the order they were added.
  //
  // Category mode keeps the aisle order the client then re-sorts by the
  // list's store order (see the grouping in GroceryList). COALESCE, because
  // an uncategorized item joins to a NULL sort order and SQLite sorts NULLs
  // first in ASC — which put "Autres / Non classé" at the TOP of the list.
  // It belongs at the bottom, especially now that items can be moved into
  // that bucket deliberately.
  const orderBy =
    list?.sort_mode === "manual"
      ? "COALESCE(gi.position, 999999) ASC, gi.id ASC"
      : "COALESCE(c.default_sort_order, 999) ASC, gi.id ASC";

  const { results } = await c.env.DB.prepare(
    `SELECT gi.*, c.name AS category_name, c.default_sort_order, c.is_custom AS category_is_custom
     FROM grocery_items gi
     LEFT JOIN categories c ON c.id = gi.category_id
     WHERE gi.list_id = ?
     ORDER BY ${orderBy}`
  )
    .bind(listId)
    .all();
  return c.json(results);
});

// Rewrites one list's order as a dense 1..N sequence. Sending the full order
// rather than a single moved item keeps the client and server from
// disagreeing about what the neighbouring positions were, and with a list
// this size the extra statements cost nothing.
//
// The full order really is required: renumbering a subset from 1 would give
// those items positions that already belong to the items left out, and the
// list would come back interleaved. A payload that doesn't cover the list
// exactly once is rejected rather than half-applied — it means the client
// was working from a stale list, and refetching is the right recovery.
app.put("/api/grocery-lists/:id/order", async (c) => {
  const listId = c.req.param("id");
  const body = await c.req.json<{ ids?: number[] }>();
  if (!Array.isArray(body.ids)) {
    return c.json({ error: "Un ordre est attendu" }, 400);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT id FROM grocery_items WHERE list_id = ?"
  )
    .bind(listId)
    .all<{ id: number }>();
  const inList = new Set(results.map((row) => row.id));

  const seen = new Set(body.ids);
  if (
    seen.size !== body.ids.length ||
    seen.size !== inList.size ||
    body.ids.some((id) => !inList.has(id))
  ) {
    return c.json({ error: "L'ordre envoyé ne correspond plus à la liste" }, 409);
  }

  await c.env.DB.batch(
    body.ids.map((id, index) =>
      c.env.DB.prepare("UPDATE grocery_items SET position = ? WHERE id = ?").bind(
        index + 1,
        id
      )
    )
  );

  return c.json({ ok: true });
});

interface GroceryItemPayload {
  name: string;
  quantity?: number;
  unit?: string;
  category_id?: number;
  recipe_id?: number;
  list_id: number;
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
  const body = await c.req.json<GroceryItemPayload>();

  if (!body.list_id) {
    return c.json({ error: "list_id est requis" }, 400);
  }
  const listId = body.list_id;
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
    : await (async () => {
        // No dictionary match — fall back to comparing names directly.
        // Filtered in JS (not SQL) so the comparison can be accent-
        // insensitive, same as the dictionary match above (SQLite's lower()
        // doesn't fold accents).
        const { results } = await c.env.DB.prepare(
          `SELECT id, name, quantity, unit FROM grocery_items
           WHERE list_id = ? AND food_id IS NULL AND is_checked = 0`
        )
          .bind(listId)
          .all<{ id: number; name: string; quantity: number | null; unit: string | null }>();
        const identity = normalizeFoodIdentity(body.name);
        return {
          results: results.filter((row) => normalizeFoodIdentity(row.name) === identity),
        };
      })();

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
    // Report the merge rather than just returning an id. The incoming name
    // is intentionally discarded here (the existing line keeps its own), but
    // when the two names differ — "sucre en poudre" folding into "sucre" —
    // that looks like the app ignored what was typed. The caller uses this
    // to say what happened and point at the food dictionary, where giving
    // the more specific name its own entry separates the two for good.
    return c.json({ id: target.row.id, merged: true, merged_into: updatedName }, 200);
  }

  // New items land at the end of the manual order. A merge (above) returns
  // before this and leaves the target's position untouched, so absorbing a
  // duplicate never moves a line the user placed deliberately.
  //
  // Read the next position with its own statement rather than as a subquery
  // inside the INSERT's VALUES. Same result, but plain parameterised
  // statements are the path D1 is happiest with, and an insert that reads
  // from the table it writes to is the kind of construct worth not relying
  // on. Two lists being added to at the same instant could pick the same
  // position; that only affects tie order in manual mode and the next drag
  // rewrites every position anyway.
  const nextPosition = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(position), 0) + 1 AS next FROM grocery_items WHERE list_id = ?"
  )
    .bind(listId)
    .first<{ next: number }>();

  const result = await c.env.DB.prepare(
    `INSERT INTO grocery_items (list_id, name, quantity, unit, category_id, recipe_id, food_id, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      listId,
      body.name,
      body.quantity ?? null,
      unit,
      categoryId,
      body.recipe_id ?? null,
      foodId,
      nextPosition?.next ?? 1
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
    category_id?: number | null;
    remember_category?: boolean;
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

  // Manual aisle correction. An explicit null moves the item to the
  // "Autres / Non classé" bucket, which is stored as NULL rather than as
  // category 17 — same reasoning as the category delete handler above.
  if (body.category_id !== undefined) {
    if (body.category_id !== null) {
      const category = await c.env.DB.prepare("SELECT id FROM categories WHERE id = ?")
        .bind(body.category_id)
        .first<{ id: number }>();
      if (!category) return c.json({ error: "Catégorie introuvable" }, 400);
    }

    const statements = [
      c.env.DB.prepare("UPDATE grocery_items SET category_id = ? WHERE id = ?").bind(
        body.category_id,
        id
      ),
    ];

    // Opt-in: re-file the underlying food too, so future adds land in the
    // corrected aisle. Without this the category is re-derived from the
    // dictionary on every add (see POST above) and the correction lasts
    // only as long as this one row. Items with no dictionary match have
    // nothing to teach, so the flag is a no-op for them.
    if (body.remember_category) {
      const row = await c.env.DB.prepare("SELECT food_id FROM grocery_items WHERE id = ?")
        .bind(id)
        .first<{ food_id: number | null }>();
      if (row?.food_id != null) {
        statements.push(
          c.env.DB.prepare("UPDATE food_dictionary SET category_id = ? WHERE id = ?").bind(
            body.category_id,
            row.food_id
          )
        );
      }
    }

    await c.env.DB.batch(statements);
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

// Bulk clear for a list — "checked_only=1" removes just the found/bought
// items (post-shopping cleanup), otherwise the whole list is emptied. A
// single statement rather than N individual deletes, since this is exactly
// "delete everything matching a condition," not a user-picked subset.
app.delete("/api/grocery-lists/:id/items", async (c) => {
  const id = c.req.param("id");
  const checkedOnly = c.req.query("checked_only") === "1";
  await c.env.DB.prepare(
    checkedOnly
      ? "DELETE FROM grocery_items WHERE list_id = ? AND is_checked = 1"
      : "DELETE FROM grocery_items WHERE list_id = ?"
  )
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
