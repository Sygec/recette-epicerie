-- One-time migration for databases created before the food dictionary
-- (Phase 2). Adds the food_id column to the existing grocery_items table.
--
-- Not idempotent — SQLite has no "ADD COLUMN IF NOT EXISTS", so running this
-- twice against the same database will error with "duplicate column name".
-- That's fine: it only needs to run once per database. A fresh database
-- created from schema.sql already has this column and doesn't need this file
-- at all.
--
--   wrangler d1 execute recipe-grocery-app --remote --file=./migrations/0001_add_food_id_to_grocery_items.sql
--   wrangler d1 execute recipe-grocery-app --local --file=./migrations/0001_add_food_id_to_grocery_items.sql

ALTER TABLE grocery_items ADD COLUMN food_id INTEGER REFERENCES food_dictionary(id);
