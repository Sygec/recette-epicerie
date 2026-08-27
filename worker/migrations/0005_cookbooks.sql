-- One-time migration for the cookbook catalogue.
-- Adds cookbooks, cookbook_entries, and two columns on recipes.
--
-- Partly idempotent. The CREATE statements are guarded and re-run safely; the
-- two ALTERs on recipes are not — SQLite has no "ADD COLUMN IF NOT EXISTS",
-- so a second run errors with "duplicate column name". A fresh database
-- created from schema.sql already has everything here and doesn't need this
-- file.
--
-- IF THIS HALF-APPLIED: the file stops on the first failing statement, so a
-- blind re-run can leave the second ALTER unapplied. A missing cookbook_page
-- doesn't break the existing app — nothing reads it yet — but the cookbook
-- import writes it, so it fails at import time rather than at deploy time.
-- Check what actually landed:
--
--   wrangler d1 execute recipe-grocery-app --remote --command \
--     "SELECT (SELECT COUNT(*) FROM pragma_table_info('recipes') WHERE name='cookbook_id') AS has_cookbook_id, \
--             (SELECT COUNT(*) FROM pragma_table_info('recipes') WHERE name='cookbook_page') AS has_cookbook_page, \
--             (SELECT COUNT(*) FROM sqlite_master WHERE name='cookbooks') AS has_cookbooks, \
--             (SELECT COUNT(*) FROM sqlite_master WHERE name='cookbook_entries') AS has_entries"
--
-- Then run only the statements whose object is missing — each is independent.
--
-- NOTE: staging and production share ONE database (see wrangler.toml), so
-- running this "for staging" is running it against real data. Take a D1 Time
-- Travel bookmark first:
--
--   wrangler d1 time-travel info recipe-grocery-app
--   wrangler d1 execute recipe-grocery-app --remote --file=./migrations/0005_cookbooks.sql
--   wrangler d1 execute recipe-grocery-app --local  --file=./migrations/0005_cookbooks.sql
--
-- Everything here is additive and nullable, so a Worker deployed before this
-- migration keeps working after it — migrate ahead of deploying, not after.

-- A book the user owns. A file is optional: a paper cookbook on the shelf is
-- a catalogue entry in its own right, and source_file_name only unlocks the
-- recipe import.
CREATE TABLE IF NOT EXISTS cookbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  year INTEGER,
  isbn TEXT,
  page_count INTEGER,
  description TEXT,
  cover_url TEXT,
  notes TEXT,
  -- Which local file this book expects, and how big it was. Not a checksum:
  -- the point is to catch "you picked the wrong PDF", not to prove identity,
  -- and hashing a 200 MB file in the browser to say so isn't worth it.
  source_file_name TEXT,
  source_file_size INTEGER,
  -- Off by default: the whole reason for the catalogue is that a few hundred
  -- imported recipes would otherwise swamp "Mes recettes". Search ignores
  -- this flag, so nothing is ever unfindable.
  show_in_recipe_list INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per recipe found in the book's index, whether or not it has been
-- imported. Kept separate from recipes so that scanning a book is cheap and
-- repeatable: a re-scan merges into this table without touching anything the
-- user has already imported or edited.
CREATE TABLE IF NOT EXISTS cookbook_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cookbook_id INTEGER NOT NULL REFERENCES cookbooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  -- Accent- and case-folded title, via normalizeFoodIdentity(). Stored rather
  -- than computed so the unique index below can use it.
  title_key TEXT NOT NULL,
  -- Nullable on purpose: an EPUB has no page numbers, and that format is a
  -- planned follow-up. Ordering falls back to title when it's NULL.
  page_number INTEGER,
  end_page INTEGER,
  chapter TEXT,
  -- Set once imported; this is what makes "don't import twice" work, and what
  -- greys the entry out in the picker. SET NULL on delete so deleting the
  -- recipe makes the entry importable again rather than orphaning it.
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  imported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The identity of an entry within its book. Note SQLite treats NULLs as
-- distinct in a unique index, so page-less entries (EPUB, later) don't
-- collide with each other on title alone — dedup for those is handled in
-- cookbookIndex.ts rather than here.
CREATE UNIQUE INDEX IF NOT EXISTS cookbook_entries_identity
  ON cookbook_entries(cookbook_id, page_number, title_key);

CREATE INDEX IF NOT EXISTS cookbook_entries_by_cookbook
  ON cookbook_entries(cookbook_id);

-- Which book a recipe came from. Separate from cookbook_entries.recipe_id:
-- that one answers "has this index entry been consumed", this one answers
-- "which book is this recipe from" — and it's what lets a hand-typed recipe
-- be attributed to a paper cookbook that has no entries at all.
ALTER TABLE recipes ADD COLUMN cookbook_id INTEGER REFERENCES cookbooks(id) ON DELETE SET NULL;
ALTER TABLE recipes ADD COLUMN cookbook_page INTEGER;

CREATE INDEX IF NOT EXISTS recipes_by_cookbook ON recipes(cookbook_id);
