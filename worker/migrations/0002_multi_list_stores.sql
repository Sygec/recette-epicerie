-- One-time migration for databases created before multi-list/per-store
-- grocery lists (Phase 3). Adds stores + store_category_order, and renames
-- grocery_lists.active_store_id (unused scaffolding from Phase 1/2) to
-- store_id now that it's a real, permanent list->store assignment.
--
-- Not idempotent — running the RENAME COLUMN twice errors once the old name
-- no longer exists. That's fine: it only needs to run once per database. A
-- fresh database created from schema.sql already has store_id and doesn't
-- need this file at all.
--
--   wrangler d1 execute recipe-grocery-app --remote --file=./migrations/0002_multi_list_stores.sql
--   wrangler d1 execute recipe-grocery-app --local --file=./migrations/0002_multi_list_stores.sql

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

ALTER TABLE grocery_lists RENAME COLUMN active_store_id TO store_id;
