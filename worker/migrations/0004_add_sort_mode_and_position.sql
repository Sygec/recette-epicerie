-- One-time migration for databases created before manual list ordering.
-- Adds grocery_lists.sort_mode and grocery_items.position.
--
-- Not idempotent — SQLite has no "ADD COLUMN IF NOT EXISTS", so running this
-- twice against the same database errors with "duplicate column name". It
-- only needs to run once per database. A fresh database created from
-- schema.sql already has both columns and doesn't need this file.
--
-- NOTE: staging and production share ONE database (see wrangler.toml), so
-- running this "for staging" is running it against real data. Take a D1 Time
-- Travel bookmark first:
--
--   wrangler d1 time-travel info recipe-grocery-app
--   wrangler d1 execute recipe-grocery-app --remote --file=./migrations/0004_add_sort_mode_and_position.sql
--   wrangler d1 execute recipe-grocery-app --local  --file=./migrations/0004_add_sort_mode_and_position.sql
--
-- Both columns are additive with defaults, so a Worker deployed before this
-- migration keeps working after it — it's safe to migrate ahead of deploying.

ALTER TABLE grocery_lists ADD COLUMN sort_mode TEXT NOT NULL DEFAULT 'category';
ALTER TABLE grocery_items ADD COLUMN position INTEGER;

-- Seed positions per list, from the order items are displayed in today
-- (aisle order, then insertion order), so the first switch to manual mode
-- starts from the list the user is already looking at rather than a
-- reshuffle. COALESCE mirrors the query in GET /api/grocery-items: an
-- uncategorized item has a NULL sort order and belongs at the bottom, not
-- the top.
--
-- This deliberately uses categories.default_sort_order rather than each
-- list's store_category_order: the per-store order is applied client-side
-- when grouping, so there is no single server-side ordering to mirror here.
-- Any list whose store reorders aisles just gets a starting point, which the
-- user then drags into shape — which is the whole point of manual mode.
WITH ordered AS (
  SELECT
    gi.id AS gid,
    ROW_NUMBER() OVER (
      PARTITION BY gi.list_id
      ORDER BY COALESCE(c.default_sort_order, 999) ASC, gi.id ASC
    ) AS pos
  FROM grocery_items gi
  LEFT JOIN categories c ON c.id = gi.category_id
)
UPDATE grocery_items
SET position = (SELECT pos FROM ordered WHERE ordered.gid = grocery_items.id);
