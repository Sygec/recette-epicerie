import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { generateToken, requireAuth } from "./auth";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

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
    `SELECT gi.*, c.name AS category_name, c.default_sort_order
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

app.post("/api/grocery-items", async (c) => {
  const listId = await getOrCreateDefaultList(c.env);
  const body = await c.req.json<GroceryItemPayload>();

  if (!body.name || !body.name.trim()) {
    return c.json({ error: "Le nom de l'article est obligatoire" }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO grocery_items (list_id, name, quantity, unit, category_id, recipe_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      listId,
      body.name,
      body.quantity ?? null,
      body.unit ?? null,
      body.category_id ?? null,
      body.recipe_id ?? null
    )
    .run();

  return c.json({ id: result.meta.last_row_id }, 201);
});

app.patch("/api/grocery-items/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ is_checked?: boolean }>();

  await c.env.DB.prepare("UPDATE grocery_items SET is_checked = ? WHERE id = ?")
    .bind(body.is_checked ? 1 : 0, id)
    .run();

  return c.json({ ok: true });
});

app.delete("/api/grocery-items/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM grocery_items WHERE id = ?")
    .bind(id)
    .run();
  return c.json({ ok: true });
});

export default app;
