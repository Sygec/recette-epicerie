-- Recettes & Courses — D1 schema (Phase 1)
--
-- This is the source of truth for the database structure. It was reconstructed
-- from the live `recipe-grocery-app` D1 database and is safe to re-run: every
-- statement is guarded with IF NOT EXISTS / ON CONFLICT.
--
-- Apply to the remote database:
--   wrangler d1 execute recipe-grocery-app --remote --file=./schema.sql
-- Apply to a local dev database:
--   wrangler d1 execute recipe-grocery-app --local --file=./schema.sql

-- ---------------------------------------------------------------------------
-- Auth
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  servings INTEGER,
  prep_time INTEGER,
  cook_time INTEGER,
  difficulty TEXT,
  source_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  aisle_category TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  text TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Tags & favorites
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS recipe_tags (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Grocery lists
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_custom INTEGER NOT NULL DEFAULT 0,
  default_sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grocery_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Liste de courses',
  active_store_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grocery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  category_id INTEGER REFERENCES categories(id),
  recipe_id INTEGER REFERENCES recipes(id),
  is_checked INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Seed: default aisle categories (French, grocery-store order)
-- ---------------------------------------------------------------------------

INSERT INTO categories (id, name, is_custom, default_sort_order) VALUES
  (1,  'Fruits et légumes',            0, 1),
  (2,  'Viandes et poissons',          0, 2),
  (3,  'Charcuterie / Traiteur',       0, 3),
  (4,  'Produits laitiers et œufs',    0, 4),
  (5,  'Boulangerie et pain',          0, 5),
  (6,  'Surgelés',                     0, 6),
  (7,  'Pâtes et sauces',              0, 7),
  (8,  'Conserves et soupes',          0, 8),
  (9,  'Pâtisserie et épices',         0, 9),
  (10, 'Condiments et vinaigrettes',   0, 10),
  (11, 'Collations',                   0, 11),
  (12, 'Céréales et déjeuner',         0, 12),
  (13, 'Boissons',                     0, 13),
  (14, 'Cuisine internationale',       0, 14),
  (15, 'Ménager et papier',            0, 15),
  (16, 'Santé et beauté',              0, 16),
  (17, 'Autres / Non classé',          0, 17)
ON CONFLICT(id) DO NOTHING;
