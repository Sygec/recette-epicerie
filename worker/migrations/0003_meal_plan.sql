-- One-time migration for databases created before meal planning (Phase 3).
-- Unlike 0001/0002, this one IS idempotent (CREATE TABLE/INDEX IF NOT
-- EXISTS only, no column renames) — safe to run more than once, and a
-- fresh database from schema.sql already has this and doesn't need it.
--
--   wrangler d1 execute recipe-grocery-app --remote --file=./migrations/0003_meal_plan.sql
--   wrangler d1 execute recipe-grocery-app --local --file=./migrations/0003_meal_plan.sql

CREATE TABLE IF NOT EXISTS meal_plan_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  servings INTEGER,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_meal_plan_entries_date ON meal_plan_entries(date);
