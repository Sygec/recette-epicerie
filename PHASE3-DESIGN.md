# Phase 3 Design — Servings Scaling, Multi-List Ordering, Meal Planning

Design doc for the three Phase 3 features called out in the product spec
(see `README.md`). Written for review before implementation — nothing here
is built yet. Build order: **servings scaling → multi-list/per-store
ordering → meal planning**. Meal planning's "add the week to the grocery
list" action depends on both of the others: it scales by servings (feature
1) and needs a target list to add into now that lists are per-store
(feature 2) — so it goes last even though it's not the largest change on
its own.

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
- "Ajouter à la liste de courses" no longer adds directly — it opens the
  shared review step (section 4) pre-filled with scaled quantities.
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

## 2. Multiple grocery lists, one per store

**Revised after discussion.** Originally scoped as "one list, re-orderable
by store" — but the actual need is separate lists, one per store, so an
item only known to be on sale at a specific store lives on that store's
list and never bleeds into another. Each list has a 1:1 relationship with
a store, and that store also determines the list's aisle ordering.

### The app is already single-list today, deliberately

`worker/src/index.ts` has a `getOrCreateDefaultList()` helper (line 585)
with the comment *"Phase 1 keeps this to a single running list"* — it
always resolves to the oldest row in `grocery_lists`, creating one if none
exists. Every grocery-item route (`GET/POST /api/grocery-items`) calls it
and hard-codes that single `list_id`. This was a known, deliberate Phase 1
simplification, not an oversight — this feature is what removes it.

**Good news:** the merge/dedup query in `POST /api/grocery-items` (the
food-dictionary matching logic) is *already* scoped `WHERE list_id = ?
AND food_id = ?`. That's exactly the behavior wanted — items only merge
within the same list, so the same ingredient added to two different
stores' lists correctly stays as two separate lines. No change needed to
`foodDictionary.ts` or the merge logic itself; only the hard-coded
single-list resolution around it goes away.

`grocery_lists.active_store_id` already exists in `schema.sql` (line 90)
but nothing reads or writes it today. It becomes each list's permanent
store assignment — worth renaming to `store_id` for clarity now that it's
not "the currently active store" but "the store this list is for"
(`ALTER TABLE grocery_lists RENAME COLUMN active_store_id TO store_id`,
supported by D1's SQLite version, low risk).

Separately: `categories.default_sort_order` exists and is used to *sort
the "add item" category dropdown* (`GroceryList.tsx` line 229), but the
actual rendered grocery-list groups (`grouped`, built at line 177) are
**not** sorted by it — group order today is just "whichever category's
items appeared first in the list from the API." Fixed as part of this
feature (sorting `grouped` by the list's store order, falling back to
`default_sort_order`).

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

-- ALTER TABLE grocery_lists RENAME COLUMN active_store_id TO store_id;
-- (existing column, repurposed — see above)
```

A store without a row for a given category (e.g. a category created after
the store's order was last set) falls back to that category's
`default_sort_order` — so `store_category_order` only needs rows for
categories the user actually dragged into a custom position.

`grocery_lists` already cascade-deletes its items on delete
(`grocery_items.list_id REFERENCES grocery_lists(id) ON DELETE CASCADE`,
confirmed in `schema.sql`), so deleting a list is already safe at the DB
level — deleting a store, however, should probably **not** cascade-delete
the lists that reference it (a list without its store just falls back to
default ordering); `store_id` on `grocery_lists` stays a soft/unenforced
reference like `grocery_items.recipe_id` already is, so this needs no
special handling — just don't add `ON DELETE CASCADE` to it.

### API

- `GET /api/grocery-lists` → all lists with their store name joined.
- `POST /api/grocery-lists {name, store_id?}` → create a list.
- `PUT /api/grocery-lists/:id {name?, store_id?}` → rename / reassign
  store.
- `DELETE /api/grocery-lists/:id` → confirm dialog on the frontend (same
  pattern as recipe/category delete), cascades to its items via the
  existing FK.
- `GET /api/grocery-items?list_id=X` — `list_id` becomes a required query
  param; `getOrCreateDefaultList` is removed.
- `POST /api/grocery-items` — payload gains a required `list_id`.
- `PATCH /api/grocery-items/:id` / `DELETE /api/grocery-items/:id` —
  unaffected, already scoped by item id.
- `GET /api/stores`, `POST /api/stores {name}`, `PUT /api/stores/:id
  {name}`, `DELETE /api/stores/:id` — same shape as the existing
  `/api/categories` CRUD.
- `GET /api/stores/:id/category-order` → `{category_id, sort_order}[]`.
- `PUT /api/stores/:id/category-order` → replace-all with an ordered
  `category_id[]` array (server assigns `0..n-1`).

### UI

- `GroceryList.tsx` gains a list switcher (tabs across the top: "IGA",
  "Costco", …) — the open list persists as "last selected list id" in
  `localStorage`, same storage mechanism the session token already uses.
- Creating a list: inline "+ Liste" form (name + store dropdown),
  matching the existing inline "+ Catégorie" form already in this file.
  A list can be created with no store yet (falls back to default order)
  and have one assigned later.
- Store management (add/rename/delete stores, drag to reorder categories
  for a store) lives behind a "Gérer les magasins" toggle, same inline
  pattern as custom-category management today.
- `grouped` sorts by the open list's store order (falling back to
  `default_sort_order` if the list has no store) before rendering.
- **Decided:** adding ingredients (from a recipe or the weekly meal plan)
  always shows an explicit list dropdown at add-time rather than silently
  using whatever list happens to be open in another tab/session — see the
  shared review step in section 4. Pre-selecting the last-used list as a
  convenience default is fine since the dropdown is visible and must be
  confirmed either way, but say if you'd rather it start blank.

---

## 3. Meal planning

**Goal:** assign a recipe to each day (souper/dinner only, decided below)
on a calendar, and bulk-add a date range's planned recipes to the grocery
list.

**Decided:** one slot per day — souper (dinner) only, no déjeuner/dîner
slots. Dropped `meal_slot` from the schema entirely rather than keep an
unused column defaulting to a single value — it's cheap to add back as a
migration later if that ever changes, and carrying it now would just be
speculative.

### Data model

```sql
CREATE TABLE IF NOT EXISTS meal_plan_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,        -- 'YYYY-MM-DD', one souper per day
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  servings INTEGER,                 -- NULL = use recipe.servings (feature 1)
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_meal_plan_entries_date ON meal_plan_entries(date);
```

No separate "plan" grouping entity (week/month) — flat rows keyed by date
keep this simple and match the app's single-household model. A week view
is just "entries where date is in this 7-day range," computed client-side
from `today`/a picked week, not a stored concept. `date` is `UNIQUE` since
there's exactly one souper per day now — assigning a new recipe to an
already-planned day replaces it (`PUT`, not a second row).

### API

- `GET /api/meal-plan?start=YYYY-MM-DD&end=YYYY-MM-DD` → entries in range,
  joined with recipe title/photo for display.
- `POST /api/meal-plan {date, recipe_id, servings?, notes?}` — replaces any
  existing entry for that date (matches the `UNIQUE` constraint on `date`).
- `PUT /api/meal-plan/:id` (change date/servings — supports drag-to-a-
  different-day in the UI).
- `DELETE /api/meal-plan/:id`.
- No separate bulk "add whole week" endpoint — see section 4: since adding
  to the list now always goes through a manual selection step, "add the
  week" is the same review UI as a single recipe, just pre-loaded with
  every planned day's ingredients instead of one recipe's. Needs
  `GET /api/meal-plan` to embed each entry's recipe ingredients (join
  `ingredients`, not just title/photo) so the review step doesn't have to
  fetch each recipe separately.

### UI

- New route `/planification`, new nav entry alongside "Recettes" /
  "Courses".
- 7-day week view (prev/next week navigation), one row per day showing the
  planned souper's title/thumbnail; click a day to open a recipe picker
  (reuse the existing recipe search from `RecipeList.tsx`).
- "Ajouter la semaine à la liste de courses" button → opens the shared
  review step (section 4), pre-loaded with every planned recipe's
  ingredients (scaled per-entry `servings ?? recipe.servings`), grouped by
  day so it's clear which item came from which meal.
- Empty days render as an unobtrusive "+".

---

## 4. Shared: the "add to grocery list" review step

**New, added in response to feedback on the first draft.** Both
`RecipeDetail.tsx`'s "Ajouter à la liste de courses" and the meal plan's
"Ajouter la semaine à la liste de courses" (feature 3) currently would add
every ingredient unconditionally. Replaced with one shared review
component both call into, so ingredient selection and list targeting are
consistent everywhere instead of solved twice.

**What it shows**, in a modal (or a full inline panel on mobile widths,
consistent with how the rest of the app avoids heavy modal chrome):

- A **list dropdown** at the top (feature 2) — populated from
  `GET /api/grocery-lists`, pre-selected to the last-used list but always
  visible and changeable before confirming, so it's never silently wrong.
- One **checkbox row per ingredient** — name + scaled quantity/unit
  (feature 1's math, already computed by the caller). **Default: all
  unchecked** — opt-in, not opt-out. You check the handful of things you
  actually need (you're out of, or need more of) rather than unchecking
  the staples you already have every single time. For the meal-plan case,
  rows are grouped under a day/recipe heading
  (e.g. "Lundi — Poulet parmesan") rather than flattened, so it's clear
  where each item came from; the same ingredient appearing on two
  different days still shows as two rows here (merging happens after
  adding, via the existing list-scoped merge logic — this view is a
  selection step, not a preview of the final list).
- An "Ajouter (N)" button, N updating live as boxes are (un)checked,
  disabled at N=0.

**Submit behavior:** loop over the checked rows client-side, calling the
existing `POST /api/grocery-items` once per row with the chosen `list_id`
— the same pattern `addAllToGroceryList` already uses today, just against
a user-picked subset instead of everything. Kept as a client-side loop
rather than a new bulk endpoint: selection already bounds the count to
what the user actually wants (rarely more than a full week's worth of
recipes), and reusing the existing single-item endpoint means the
food-dictionary merge/scaling logic isn't duplicated anywhere.

**Decided:** default-unchecked (opt-in) makes a pantry-staple flag
unnecessary — nothing gets added unless you actively check it, so
salt/pepper/oil are already excluded by default same as everything else.
No `food_dictionary` change needed for this.

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
4. Multi-list/per-store ordering's migration creates `stores` and
   `store_category_order`, and renames `active_store_id` → `store_id` on
   `grocery_lists` — no data loss: the one existing list in live D1 keeps
   its id and items, just gets a name/store assignable after the fact.
5. Meal planning gets its own migration/PR-sized chunk after that, so each
   feature is tested against the live D1 and deployed independently.
6. The shared review step (section 4) is built alongside feature 2 (it
   needs the list dropdown to exist) and extended, not rebuilt, when
   feature 3 lands and starts feeding it multi-recipe data.

## Explicitly out of scope for this pass

- Fraction-glyph quantity display (e.g. "1 ½") for scaled servings.
- Multi-household support (multiple *logins*, permissions, etc.) — still
  a single shared login, just multiple grocery lists under it.
- Splitting a single recipe's *checked* ingredients across more than one
  list in a single add — one submit targets one list; adding some items
  to a second list is a second pass through the review step.
- Déjeuner/dîner slots for meal planning — souper-only, see feature 3.
- Nutrition/calorie totals for a planned week — not in the original spec.
- Pantry-staple auto-uncheck flag — moot now that everything defaults
  unchecked (section 4).
