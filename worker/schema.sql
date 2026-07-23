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
  food_id INTEGER REFERENCES food_dictionary(id),
  is_checked INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Food dictionary — cross-language recognition (Phase 2)
--
-- Maps free-text ingredient names (in French or English) to a canonical food
-- entry, used to (a) auto-assign the right aisle category regardless of
-- language, and (b) merge duplicate items across recipes ("onions" and
-- "oignons" collapse into one grocery-list line). No translation happens —
-- an item's displayed name is always whatever was typed or imported; the
-- dictionary only drives categorization and merge-matching.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS food_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS food_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  food_id INTEGER NOT NULL REFERENCES food_dictionary(id) ON DELETE CASCADE,
  alias TEXT NOT NULL UNIQUE,
  lang TEXT NOT NULL
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

-- ---------------------------------------------------------------------------
-- Seed: starting food dictionary (~70 common items, FR canonical name +
-- FR/EN aliases). Extend this list over time as unmatched items come up.
-- ---------------------------------------------------------------------------

INSERT INTO food_dictionary (id, canonical_name, category_id) VALUES
  (1,  'oignon',                1),
  (2,  'ail',                   1),
  (3,  'tomate',                1),
  (4,  'carotte',               1),
  (5,  'pomme de terre',        1),
  (6,  'pomme',                 1),
  (7,  'banane',                1),
  (8,  'laitue',                1),
  (9,  'concombre',             1),
  (10, 'poivron',               1),
  (11, 'champignon',            1),
  (12, 'citron',                1),
  (13, 'lime',                  1),
  (14, 'avocat',                1),
  (15, 'céleri',                1),
  (16, 'brocoli',               1),
  (17, 'épinards',              1),
  (18, 'persil',                1),
  (19, 'gingembre',             1),
  (20, 'courgette',             1),
  (21, 'poulet',                2),
  (22, 'bœuf haché',            2),
  (23, 'porc',                  2),
  (24, 'bacon',                 2),
  (25, 'saumon',                2),
  (26, 'crevettes',             2),
  (27, 'dinde',                 2),
  (28, 'steak',                 2),
  (29, 'jambon',                3),
  (30, 'lait',                  4),
  (31, 'beurre',                4),
  (32, 'fromage',               4),
  (33, 'crème',                 4),
  (34, 'crème sure',            4),
  (35, 'yogourt',               4),
  (36, 'œuf',                   4),
  (37, 'pain',                  5),
  (38, 'baguette',              5),
  (39, 'tortillas',             5),
  (40, 'crème glacée',          6),
  (41, 'petits pois surgelés',  6),
  (42, 'pâtes',                 7),
  (43, 'riz',                   7),
  (44, 'sauce tomate',          7),
  (45, 'tomates en conserve',   8),
  (46, 'haricots rouges',       8),
  (47, 'maïs en conserve',      8),
  (48, 'bouillon de poulet',    8),
  (49, 'farine',                9),
  (50, 'sucre',                 9),
  (51, 'cassonade',             9),
  (52, 'levure chimique',       9),
  (53, 'bicarbonate de soude',  9),
  (54, 'sel',                   9),
  (55, 'poivre',                9),
  (56, 'cannelle',              9),
  (57, 'vanille',               9),
  (58, 'chocolat',              9),
  (59, 'huile d''olive',        10),
  (60, 'vinaigre',              10),
  (61, 'moutarde',              10),
  (62, 'mayonnaise',            10),
  (63, 'miel',                  10),
  (64, 'sauce soya',            10),
  (65, 'céréales',              12),
  (66, 'sirop d''érable',       12),
  (67, 'café',                  13),
  (68, 'thé',                   13),
  (69, 'jus',                   13),
  (70, 'eau',                   13),
  (71, 'vin',                   13),
  (72, 'coriandre',             9),
  (73, 'huile végétale',        10),
  (74, 'poudre de chili',       9),
  (75, 'cumin',                 9),
  (76, 'poivre de Cayenne',     9),
  (77, 'mélasse',               9),
  (78, 'ketchup',               10),
  (79, 'moutarde de Dijon',     10),
  (80, 'moutarde à l''ancienne',10)
ON CONFLICT(id) DO NOTHING;

INSERT INTO food_aliases (food_id, alias, lang) VALUES
  (1, 'oignon', 'fr'), (1, 'oignons', 'fr'), (1, 'onion', 'en'), (1, 'onions', 'en'),
  (2, 'ail', 'fr'), (2, 'gousse d''ail', 'fr'), (2, 'garlic', 'en'),
  (3, 'tomate', 'fr'), (3, 'tomates', 'fr'), (3, 'tomato', 'en'), (3, 'tomatoes', 'en'),
  (4, 'carotte', 'fr'), (4, 'carottes', 'fr'), (4, 'carrot', 'en'), (4, 'carrots', 'en'),
  (5, 'pomme de terre', 'fr'), (5, 'pommes de terre', 'fr'), (5, 'patate', 'fr'), (5, 'patates', 'fr'), (5, 'potato', 'en'), (5, 'potatoes', 'en'),
  (6, 'pomme', 'fr'), (6, 'pommes', 'fr'), (6, 'apple', 'en'), (6, 'apples', 'en'),
  (7, 'banane', 'fr'), (7, 'bananes', 'fr'), (7, 'banana', 'en'), (7, 'bananas', 'en'),
  (8, 'laitue', 'fr'), (8, 'lettuce', 'en'),
  (9, 'concombre', 'fr'), (9, 'concombres', 'fr'), (9, 'cucumber', 'en'), (9, 'cucumbers', 'en'),
  (10, 'poivron', 'fr'), (10, 'poivrons', 'fr'), (10, 'bell pepper', 'en'), (10, 'bell peppers', 'en'),
  (11, 'champignon', 'fr'), (11, 'champignons', 'fr'), (11, 'mushroom', 'en'), (11, 'mushrooms', 'en'),
  (12, 'citron', 'fr'), (12, 'citrons', 'fr'), (12, 'lemon', 'en'), (12, 'lemons', 'en'),
  (13, 'lime', 'fr'), (13, 'limes', 'fr'), (13, 'citron vert', 'fr'),
  (14, 'avocat', 'fr'), (14, 'avocats', 'fr'), (14, 'avocado', 'en'), (14, 'avocados', 'en'),
  (15, 'céleri', 'fr'), (15, 'celery', 'en'),
  (16, 'brocoli', 'fr'), (16, 'broccoli', 'en'),
  (17, 'épinards', 'fr'), (17, 'épinard', 'fr'), (17, 'spinach', 'en'),
  (18, 'persil', 'fr'), (18, 'parsley', 'en'),
  (19, 'gingembre', 'fr'), (19, 'ginger', 'en'),
  (20, 'courgette', 'fr'), (20, 'courgettes', 'fr'), (20, 'zucchini', 'en'),
  (21, 'poulet', 'fr'), (21, 'chicken', 'en'),
  (22, 'bœuf haché', 'fr'), (22, 'boeuf haché', 'fr'), (22, 'viande hachée', 'fr'), (22, 'ground beef', 'en'), (22, 'minced beef', 'en'),
  (23, 'porc', 'fr'), (23, 'pork', 'en'),
  (24, 'bacon', 'fr'),
  (25, 'saumon', 'fr'), (25, 'salmon', 'en'),
  (26, 'crevettes', 'fr'), (26, 'crevette', 'fr'), (26, 'shrimp', 'en'), (26, 'shrimps', 'en'), (26, 'prawns', 'en'),
  (27, 'dinde', 'fr'), (27, 'turkey', 'en'),
  (28, 'steak', 'fr'),
  (29, 'jambon', 'fr'), (29, 'ham', 'en'),
  (30, 'lait', 'fr'), (30, 'milk', 'en'),
  (31, 'beurre', 'fr'), (31, 'butter', 'en'),
  (32, 'fromage', 'fr'), (32, 'cheese', 'en'),
  (33, 'crème', 'fr'), (33, 'creme', 'fr'), (33, 'cream', 'en'),
  (34, 'crème sure', 'fr'), (34, 'creme sure', 'fr'), (34, 'sour cream', 'en'),
  (35, 'yogourt', 'fr'), (35, 'yaourt', 'fr'), (35, 'yogurt', 'en'),
  (36, 'œuf', 'fr'), (36, 'œufs', 'fr'), (36, 'oeuf', 'fr'), (36, 'oeufs', 'fr'), (36, 'egg', 'en'), (36, 'eggs', 'en'),
  (37, 'pain', 'fr'), (37, 'bread', 'en'),
  (38, 'baguette', 'fr'),
  (39, 'tortilla', 'fr'), (39, 'tortillas', 'fr'),
  (40, 'crème glacée', 'fr'), (40, 'creme glacee', 'fr'), (40, 'ice cream', 'en'),
  (41, 'petits pois surgelés', 'fr'), (41, 'frozen peas', 'en'),
  (42, 'pâtes', 'fr'), (42, 'pates', 'fr'), (42, 'spaghetti', 'en'), (42, 'pasta', 'en'),
  (43, 'riz', 'fr'), (43, 'rice', 'en'),
  (44, 'sauce tomate', 'fr'), (44, 'tomato sauce', 'en'),
  (45, 'tomates en conserve', 'fr'), (45, 'tomates broyées', 'fr'), (45, 'tomates concassées', 'fr'), (45, 'canned tomatoes', 'en'), (45, 'crushed tomatoes', 'en'),
  (46, 'haricots rouges', 'fr'), (46, 'red kidney beans', 'en'), (46, 'kidney beans', 'en'),
  (47, 'maïs en conserve', 'fr'), (47, 'canned corn', 'en'),
  (48, 'bouillon de poulet', 'fr'), (48, 'chicken broth', 'en'), (48, 'chicken stock', 'en'),
  (49, 'farine', 'fr'), (49, 'flour', 'en'),
  (50, 'sucre', 'fr'), (50, 'sugar', 'en'),
  (51, 'cassonade', 'fr'), (51, 'brown sugar', 'en'),
  (52, 'levure chimique', 'fr'), (52, 'poudre à pâte', 'fr'), (52, 'baking powder', 'en'),
  (53, 'bicarbonate de soude', 'fr'), (53, 'baking soda', 'en'),
  (54, 'sel', 'fr'), (54, 'salt', 'en'),
  (55, 'poivre', 'fr'), (55, 'pepper', 'en'), (55, 'black pepper', 'en'),
  (56, 'cannelle', 'fr'), (56, 'cinnamon', 'en'),
  (57, 'vanille', 'fr'), (57, 'vanilla', 'en'),
  (58, 'chocolat', 'fr'), (58, 'chocolate', 'en'),
  (59, 'huile d''olive', 'fr'), (59, 'olive oil', 'en'),
  (60, 'vinaigre', 'fr'), (60, 'vinegar', 'en'),
  (61, 'moutarde', 'fr'), (61, 'mustard', 'en'),
  (62, 'mayonnaise', 'fr'), (62, 'mayo', 'en'),
  (63, 'miel', 'fr'), (63, 'honey', 'en'),
  (64, 'sauce soya', 'fr'), (64, 'soy sauce', 'en'),
  (65, 'céréales', 'fr'), (65, 'cereal', 'en'),
  (66, 'sirop d''érable', 'fr'), (66, 'maple syrup', 'en'),
  (67, 'café', 'fr'), (67, 'coffee', 'en'),
  (68, 'thé', 'fr'), (68, 'tea', 'en'),
  (69, 'jus', 'fr'), (69, 'juice', 'en'),
  (70, 'eau', 'fr'), (70, 'water', 'en'),
  (71, 'vin', 'fr'), (71, 'wine', 'en'),
  (72, 'coriandre', 'fr'), (72, 'coriandre moulue', 'fr'), (72, 'coriander', 'en'), (72, 'ground coriander', 'en'),
  (73, 'huile végétale', 'fr'), (73, 'vegetable oil', 'en'),
  (74, 'poudre de chili', 'fr'), (74, 'chili powder', 'en'),
  (75, 'cumin', 'fr'), (75, 'cumin moulu', 'fr'), (75, 'ground cumin', 'en'),
  (76, 'poivre de cayenne', 'fr'), (76, 'cayenne', 'fr'), (76, 'cayenne pepper', 'en'),
  (77, 'mélasse', 'fr'), (77, 'molasses', 'en'),
  (78, 'ketchup', 'fr'),
  (79, 'moutarde de dijon', 'fr'), (79, 'dijon mustard', 'en'),
  (80, 'moutarde à l''ancienne', 'fr'), (80, 'whole-grain mustard', 'en'), (80, 'wholegrain mustard', 'en'), (80, 'whole grain mustard', 'en')
ON CONFLICT(alias) DO NOTHING;
