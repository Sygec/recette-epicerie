-- Recettes & Courses — sample/test data (Phase 1)
--
-- Idempotent: re-running deletes the seeded rows (fixed low IDs) and
-- re-inserts them, so it will not pile up duplicates. Uses explicit IDs so
-- ingredients/steps/tags line up on every run. Safe on an empty database too.
--
-- Apply to the remote database:
--   wrangler d1 execute recipe-grocery-app --remote --file=./seed.sql
-- Apply to a local dev database:
--   wrangler d1 execute recipe-grocery-app --local --file=./seed.sql

-- --- Clean out previously seeded rows (cascades to children) ------------------
DELETE FROM recipes WHERE id IN (1, 2, 3, 4, 5);
DELETE FROM grocery_lists WHERE id = 1;
DELETE FROM tags WHERE id IN (1, 2, 3, 4, 5, 6);

-- --- Tags --------------------------------------------------------------------
INSERT INTO tags (id, name) VALUES
  (1, 'Rapide'),
  (2, 'Végétarien'),
  (3, 'Italien'),
  (4, 'Plat principal'),
  (5, 'Poulet'),
  (6, 'Salade');

-- --- Recipe 1: Pâtes carbonara ----------------------------------------------
INSERT INTO recipes (id, title, description, photo_url, servings, prep_time, cook_time, difficulty, source_url, notes)
VALUES (1, 'Pâtes carbonara',
  'La vraie carbonara romaine : pas de crème, juste des œufs, du pecorino et du guanciale.',
  NULL, 4, 10, 15, 'Facile', 'https://www.example.com/carbonara',
  'Retirer la poêle du feu avant d''ajouter les œufs pour éviter qu''ils ne cuisent en omelette.');

INSERT INTO ingredients (recipe_id, name, quantity, unit, sort_order) VALUES
  (1, 'Spaghetti', 400, 'g', 0),
  (1, 'Guanciale (ou pancetta)', 150, 'g', 1),
  (1, 'Jaunes d''œufs', 4, NULL, 2),
  (1, 'Pecorino romano râpé', 80, 'g', 3),
  (1, 'Poivre noir', NULL, NULL, 4);

INSERT INTO steps (recipe_id, step_number, text) VALUES
  (1, 1, 'Faire cuire les spaghetti dans une grande casserole d''eau salée.'),
  (1, 2, 'Faire revenir le guanciale coupé en lardons jusqu''à ce qu''il soit croustillant.'),
  (1, 3, 'Mélanger les jaunes d''œufs avec le pecorino et beaucoup de poivre.'),
  (1, 4, 'Égoutter les pâtes, les mélanger hors du feu avec le guanciale puis le mélange œufs-fromage. Détendre avec un peu d''eau de cuisson.');

INSERT INTO recipe_tags (recipe_id, tag_id) VALUES (1, 3), (1, 4);

-- --- Recipe 2: Poulet rôti aux légumes --------------------------------------
INSERT INTO recipes (id, title, description, photo_url, servings, prep_time, cook_time, difficulty, source_url, notes)
VALUES (2, 'Poulet rôti aux légumes',
  'Un poulet du dimanche tout simple, rôti sur un lit de légumes racines.',
  NULL, 4, 20, 75, 'Moyen', NULL,
  'Arroser le poulet avec son jus toutes les 20 minutes pour une peau bien dorée.');

INSERT INTO ingredients (recipe_id, name, quantity, unit, sort_order) VALUES
  (2, 'Poulet entier', 1, NULL, 0),
  (2, 'Pommes de terre', 800, 'g', 1),
  (2, 'Carottes', 4, NULL, 2),
  (2, 'Oignons', 2, NULL, 3),
  (2, 'Huile d''olive', 3, 'c. à soupe', 4),
  (2, 'Thym', NULL, NULL, 5),
  (2, 'Sel et poivre', NULL, NULL, 6);

INSERT INTO steps (recipe_id, step_number, text) VALUES
  (2, 1, 'Préchauffer le four à 200 °C.'),
  (2, 2, 'Couper les légumes en gros morceaux et les disposer dans un plat avec l''huile, le thym, le sel et le poivre.'),
  (2, 3, 'Poser le poulet sur les légumes, l''assaisonner généreusement.'),
  (2, 4, 'Enfourner environ 1 h 15, en arrosant régulièrement, jusqu''à ce que le jus soit clair.');

INSERT INTO recipe_tags (recipe_id, tag_id) VALUES (2, 4), (2, 5);

-- --- Recipe 3: Salade de quinoa (favorite) ----------------------------------
INSERT INTO recipes (id, title, description, photo_url, servings, prep_time, cook_time, difficulty, source_url, notes)
VALUES (3, 'Salade de quinoa aux légumes',
  'Une salade fraîche et complète, parfaite pour les lunchs de la semaine.',
  NULL, 2, 15, 15, 'Facile', NULL, NULL);

INSERT INTO ingredients (recipe_id, name, quantity, unit, sort_order) VALUES
  (3, 'Quinoa', 200, 'g', 0),
  (3, 'Concombre', 1, NULL, 1),
  (3, 'Tomates cerises', 250, 'g', 2),
  (3, 'Feta', 100, 'g', 3),
  (3, 'Citron', 1, NULL, 4),
  (3, 'Huile d''olive', 2, 'c. à soupe', 5),
  (3, 'Menthe fraîche', NULL, NULL, 6);

INSERT INTO steps (recipe_id, step_number, text) VALUES
  (3, 1, 'Rincer le quinoa et le cuire 15 min dans deux fois son volume d''eau. Laisser tiédir.'),
  (3, 2, 'Couper le concombre et les tomates cerises, émietter la feta.'),
  (3, 3, 'Mélanger le tout avec le jus de citron, l''huile d''olive et la menthe ciselée. Assaisonner.');

INSERT INTO recipe_tags (recipe_id, tag_id) VALUES (3, 1), (3, 2), (3, 6);

-- Mark the quinoa salad as a favorite.
INSERT INTO favorites (recipe_id) VALUES (3) ON CONFLICT(recipe_id) DO NOTHING;

-- --- Recipe 4: Sauce à spaghetti ---------------------------------------------
INSERT INTO recipes (id, title, description, photo_url, servings, prep_time, cook_time, difficulty, source_url, notes)
VALUES (4, 'Sauce à spaghetti',
  'Une sauce à spaghetti classique à la viande, avec un soupçon de saucisson sec en option — se congèle très bien en portions.',
  NULL, 8, 25, 75, 'Facile', 'https://www.ricardocuisine.com/en/recipes/6441-spaghetti-sauce',
  'Congeler à plat dans des sacs refermables pour économiser l''espace.');

INSERT INTO ingredients (recipe_id, name, quantity, unit, sort_order) VALUES
  (4, 'Oignon', 1, NULL, 0),
  (4, 'Huile d''olive', 3, 'c. à soupe', 1),
  (4, 'Viande hachée mi-maigre (bœuf, veau, porc)', 450, 'g', 2),
  (4, 'Gousses d''ail', 2, NULL, 3),
  (4, 'Chorizo, pepperoni ou autre saucisson sec, haché finement (facultatif)', 55, 'g', 4),
  (4, 'Tomates italiennes broyées, en conserve', 2, 'boîtes de 796 ml', 5),
  (4, 'Origan séché', 0.5, 'c. à thé', 6),
  (4, 'Feuille de laurier', 1, NULL, 7),
  (4, 'Sel et poivre', NULL, NULL, 8);

INSERT INTO steps (recipe_id, step_number, text) VALUES
  (4, 1, 'Dans une grande casserole, à feu moyen-vif, attendrir l''oignon dans l''huile.'),
  (4, 2, 'Ajouter la viande hachée et cuire, en la défaisant à la cuillère de bois, jusqu''à ce qu''elle soit bien dorée. Saler et poivrer.'),
  (4, 3, 'Ajouter l''ail et la saucisse; cuire 2 minutes en remuant.'),
  (4, 4, 'Ajouter les tomates, l''origan et la feuille de laurier; bien mélanger et porter à ébullition.'),
  (4, 5, 'Laisser mijoter à feu doux environ 1 heure, ou jusqu''à ce que la sauce épaississe. Rectifier l''assaisonnement.');

INSERT INTO recipe_tags (recipe_id, tag_id) VALUES (4, 3), (4, 4);

-- --- Recipe 5: Macaroni au fromage, chili et dindon --------------------------
-- Imported from https://ledindon.qc.ca/recettes/macaroni-au-fromage-chili-et-dindon/
-- The page's Recipe JSON-LD only carries name/image/recipeYield — no
-- recipeIngredient or recipeInstructions, and its prepTime/cookTime aren't
-- valid ISO 8601 durations (" 5Minutes" instead of "PT5M") — so the import
-- endpoint's json-ld path leaves description, prep_time, cook_time,
-- ingredients and steps all empty, exactly as it would via the real
-- /api/recipes/import call.
INSERT INTO recipes (id, title, description, photo_url, servings, prep_time, cook_time, difficulty, source_url, notes)
VALUES (5, 'Macaroni au fromage, chili et dindon',
  NULL, 'https://ledindon.qc.ca/wp-content/uploads/2022/11/6694_modale.jpg',
  6, NULL, NULL, NULL, 'https://ledindon.qc.ca/recettes/macaroni-au-fromage-chili-et-dindon/',
  'Ingrédients et étapes non fournis par la page source (aucune donnée structurée) — à compléter manuellement.');

-- --- Grocery list -----------------------------------------------------------
INSERT INTO grocery_lists (id, name) VALUES (1, 'Liste de courses');

-- category_id references the seeded aisle categories:
--   1 Fruits et légumes · 2 Viandes et poissons · 4 Produits laitiers et œufs
--   5 Boulangerie et pain · 7 Pâtes et sauces · 13 Boissons
INSERT INTO grocery_items (list_id, name, quantity, unit, category_id, recipe_id, is_checked) VALUES
  (1, 'Bananes', 6, NULL, 1, NULL, 0),
  (1, 'Tomates cerises', 250, 'g', 1, 3, 0),
  (1, 'Poulet entier', 1, NULL, 2, 2, 0),
  (1, 'Lait', 2, 'L', 4, NULL, 1),
  (1, 'Feta', 100, 'g', 4, 3, 0),
  (1, 'Baguette', 2, NULL, 5, NULL, 1),
  (1, 'Spaghetti', 400, 'g', 7, 1, 0),
  (1, 'Café', 1, NULL, 13, NULL, 0);
