# Phase 3 Design — Servings Scaling, Per-Store Ordering, Meal Planning

Design doc for the three Phase 3 features called out in the product spec
(see `README.md`). Written for review before implementation — nothing here
is built yet. Build order: **servings scaling → per-store ordering → meal
planning**, since meal planning's "add the week to the grocery list" action
depends on servings scaling, and per-store ordering is independent but
smaller than meal planning.

Conventions followed throughout, matching the existing codebase: Hono routes
added to `worker/src/index.ts`, idempotent schema changes appended to
`worker/schema.sql` (+ a one-off `worker/migrations/000N_*.sql` for the live
DB, per the pattern `migrations/0001_add_food_id_to_grocery_items.sql`
already set), typed methods added to `frontend/src/lib/api.ts`, French UI
copy, soft (unenforced) FK references via plain `INTEGER REFERENCES` columns
— the same style `grocery_items.recipe_id` already uses.

---

## 1. Servings scaling

**Goal:** let a user viewing a recipe say "I want to cook this for 6, not
the 4 it's written for" and have ingredient quantities (and what gets added
to the grocery list) scale accordingly.

### Data model

No new tables. `recipes.servings` already exists and is the scaling base.
Scaling is **computed, not stored** — nothing about the recipe or its
ingredients changes in the database. This avoids a whole class of problems
(edit-while-scaled, stale scaled values, concurrent scaling by two views).

### API

No backend change needed for the scaling math itself — it's pure
client-side arithmetic on data already being fetched. The only backend
touch is that `addAllToGroceryList` (already in `RecipeDetail.tsx`) will
send the *scaled* quantity per ingredient to the existing
`POST /api/grocery-items` — same endpoint, same payload shape, just a
different number.

### UI (`RecipeDetail.tsx`)

- A servings stepper near the existing "N portions" text: `− [4] +`,
  defaulting to `recipe.servings`.
- Ingredient list quantities re-render as `quantity * (desiredServings /
  recipe.servings)`, rounded for display (see rounding below).
- "Ajouter à la liste de courses" sends scaled quantities instead of raw
  ones.
- Recipes with `servings == null` (spec allows this — it's an optional
  field): hide the stepper, scaling isn't offered, behavior is unchanged
  from today.
- Ingredients with `quantity == null` (e.g. "sel, au goût") are never
  scaled — only the numeric ones are, matching how `convertForMerge` in
  `foodDictionary.ts` already treats missing quantities as opaque.

### Rounding / display

Quantities are stored as `REAL`. Scaling a stored `1` by `6/4` gives `1.5`,
which displays cleanly, but `1/3`-based recipes scaled oddly can produce
repeating decimals (`0.3333…`). Round display to 2 decimal places; do not
attempt fraction-glyph formatting (e.g. "1 ½") — no existing code does that
and it's a separate, optional polish item, not required for the feature to
work.

### Edge cases

- Desired servings must be a positive integer (stepper min `1`, no upper
  bound needed — a user tripling a recipe for a party is a legitimate use).
- Scaling factor is per-recipe-view state (not persisted) — leaving the
  page and coming back resets to `recipe.servings`. Persisting a
  "last-used servings" would be a nice-to-have, not required for v1.

---

## 2. Per-store ingredient ordering

**Goal:** let the grocery list be ordered/grouped to match how a specific
store's aisles are laid out, instead of (or in addition to) the generic
category order.

### Existing gap found while researching this

`grocery_lists.active_store_id` **already exists** in `schema.sql` (line
90) but there is no `stores` table and nothing in `worker/src/index.ts` or
the frontend reads or writes it — it's dead scaffolding from Phase 1/2,
presumably anticipating this exact feature.

Separately: `categories.default_sort_order` exists and is used to *sort the
"add item" category dropdown* (`GroceryList.tsx` line 229), but the actual
rendered grocery-list groups (`grouped`, built at line 177) are **not**
sorted by it — group order today is just "whichever category's items
appeared first in the list from the API." This should be fixed as part of
this feature (sorting `grouped` by the active ordering — store-specific if
a store is selected, `default_sort_order` otherwise) since per-store
ordering is meaningless if the fallback default ordering isn't even applied
today.

### Data model

```sql
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_category_order (
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (store_id, category_id)
);
```

A store without a row for a given category (e.g. a category created after
the store's order was last set) falls back to that category's
`default_sort_order` — so `store_category_order` only needs rows for
categories the user has actually dragged into a custom position, not a
full copy of every category.

`grocery_lists.active_store_id` gets its first real use: `PATCH
/api/grocery-lists/active-store` sets it (single implicit list, matching
how `GroceryList.tsx` calls `getGroceryItems()` with no list id today).

### API

- `GET /api/stores`, `POST /api/stores {name}`, `PUT /api/stores/:id
  {name}`, `DELETE /api/stores/:id` — same shape as the existing
  `/api/categories` CRUD.
- `GET /api/stores/:id/category-order` → `{category_id, sort_order}[]`
  (categories not customized for this store are simply absent — client
  fills the gap with `default_sort_order`).
- `PUT /api/stores/:id/category-order` → replace-all with a full ordered
  `category_id[]` array (simplest contract for a drag-to-reorder UI: send
  the whole new order, server assigns `0..n-1`).
- `PATCH /api/grocery-lists/active-store {store_id: number | null}`.
- `GET /api/grocery-items` needs to also return the resolved sort position
  per item's category so the frontend doesn't need a second round trip —
  either join in `store_category_order` server-side when an active store is
  set, or have the frontend fetch `/api/stores/:id/category-order`
  alongside categories (mirrors how it already fetches categories
  separately today — simpler, no endpoint-shape change needed).

### UI

- New "Magasin" selector in `GroceryList.tsx` header (a `<select>` next to
  the title, same visual weight as the category dropdown) — "Aucun
  magasin" (falls back to default order) or a saved store.
- A small store management view (add/rename/delete stores, drag to reorder
  categories for the selected store) — could live inline in
  `GroceryList.tsx` behind a "Gérer les magasins" toggle, consistent with
  how custom-category management is already inline rather than a separate
  page.
- `grouped` sorts by the resolved order (store override, else
  `default_sort_order`) before rendering.

---

## 3. Meal planning

**Goal:** assign recipes to days (and optionally meal slots) on a calendar,
and bulk-add a date range's planned recipes to the grocery list.

### Data model

```sql
CREATE TABLE IF NOT EXISTS meal_plan_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,               -- 'YYYY-MM-DD'
  meal_slot TEXT NOT NULL DEFAULT 'diner',  -- 'dejeuner' | 'diner' | 'souper'
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  servings INTEGER,                 -- NULL = use recipe.servings (feature 1)
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_meal_plan_entries_date ON meal_plan_entries(date);
```

No separate "plan" grouping entity (week/month) — flat rows keyed by date
keep this simple and match the app's single-household, single-list model.
A week view is just "entries where date is in this 7-day range," computed
client-side from `today`/a picked week, not a stored concept.

### API

- `GET /api/meal-plan?start=YYYY-MM-DD&end=YYYY-MM-DD` → entries in range,
  joined with recipe title/photo for display.
- `POST /api/meal-plan {date, meal_slot, recipe_id, servings?, notes?}`.
- `PUT /api/meal-plan/:id` (change date/slot/servings — supports drag-to-a-
  different-day in the UI).
- `DELETE /api/meal-plan/:id`.
- `POST /api/meal-plan/add-to-grocery-list {start, end}` — server-side loop
  over entries in range, reusing the same ingredient→grocery-item merge
  path `POST /api/grocery-items` already goes through (food-dictionary
  matching, unit conversion, quantity scaling by `servings ?? recipe.
  servings` from feature 1). One bulk endpoint instead of N client-side
  calls, both for fewer round trips and so a partial failure is one error
  instead of "3 of 12 ingredients failed" like `addAllToGroceryList`
  currently risks for a single recipe.

### UI

- New route `/planification`, new nav entry alongside "Recettes" /
  "Courses".
- 7-day week view (prev/next week navigation), each day showing its
  slot(s) with the assigned recipe's title/thumbnail; click a slot to open
  a recipe picker (reuse the existing recipe search from `RecipeList.tsx`).
- "Ajouter la semaine à la liste de courses" button → the bulk endpoint
  above, then navigate to `/courses` (same pattern
  `addAllToGroceryList` already uses for a single recipe).
- Empty slots render as an unobtrusive "+" — most days won't be filled for
  every slot.

### Open question for you

Single meal slot per day (just "what's for dinner") vs. three slots
(déjeuner/dîner/souper)? The schema above supports either — `meal_slot`
defaults to `'diner'`, so starting with dinner-only and adding slots later
is non-breaking either way. Worth deciding before UI work since it changes
the week-grid layout (7 rows vs. a 7×3 grid).

---

## Sequencing / migrations

1. `worker/schema.sql`: append the three feature's `CREATE TABLE`
   statements (idempotent, matches existing pattern).
2. One `worker/migrations/000N_phase3.sql` applied to the **live** D1 via
   the Cloudflare MCP tool, per the established workflow — schema.sql alone
   doesn't touch already-provisioned live data/tables.
3. Servings scaling ships first and needs no migration at all (pure
   frontend + no new tables) — good candidate to build and ship
   independently while the other two are still being reviewed.
4. Per-store ordering and meal planning each get their own migration/PR-
   sized chunk of work rather than one giant change, so each can be tested
   against the live D1 and deployed on its own.

## Explicitly out of scope for this pass

- Fraction-glyph quantity display (e.g. "1 ½") for scaled servings.
- Multi-list / multi-household support — everything above assumes the
  current single implicit grocery list and single shared login.
- Nutrition/calorie totals for a planned week — not in the original spec.
