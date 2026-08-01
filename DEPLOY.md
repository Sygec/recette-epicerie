# Deploying Recettes & Courses

A step-by-step guide to putting the app online. No prior Cloudflare-CLI
experience assumed. You run these commands on **your own computer** — the
deploy needs *your* Cloudflare login.

## The big picture

The app has two kinds of things in your Cloudflare account:

1. **Infrastructure** — the database (D1) and photo storage (R2). These
   **already exist and are ready**; the database schema and sample recipes are
   already loaded. You do **not** set these up.
2. **Code** — the Worker (API) and the built frontend. "Deploying" just means
   uploading this code to Cloudflare.

The frontend and API run on a **single origin**: one `*.workers.dev` URL serves
the website, the API (`/api/*`), and the photos (`/photos/*`). There is no
separate Pages project, no `_routes.json`, and no CORS setup to worry about.

## What you need first

1. **Node.js** version 18 or newer. Check with:
   ```bash
   node --version
   ```
   If that errors, install it from https://nodejs.org.

2. **The code, on the right branch:**
   ```bash
   git clone https://github.com/sygec/recette-epicerie.git
   cd recette-epicerie
   git checkout claude/zip-file-review-0ri196
   ```
   (Already have the folder? Just `cd` into it and run the `git checkout` line.)

## Deploy — 4 steps

### 1. Install the Worker's tools and log into Cloudflare

```bash
cd worker
npm install
npx wrangler login
```

`wrangler login` opens your browser and asks you to authorize. Click **Allow**.
This connects the CLI to *your* Cloudflare account (the same one that has the
D1 database and R2 bucket). You only do this once per computer.

### 2. Set the shared login password

```bash
npx wrangler secret put APP_PASSWORD
```

It prompts for a value — type the password you want to use to log into the app
and press Enter. It is stored **encrypted** in Cloudflare, never in the code.

### 3. Deploy

Uploads the API **and** the built frontend together. The frontend build runs
automatically first (an npm `predeploy` hook), so there is no separate build
step to forget:

```bash
npm run deploy
```

When it finishes, it prints a URL like
`https://recipe-grocery-worker.<your-name>.workers.dev`.

> Use `npm run deploy`, not `npx wrangler deploy`. The latter skips the hook
> and will upload whatever stale `frontend/dist` happens to be lying around —
> or fail outright if there isn't one.

### 4. Open the URL

Visit that URL in your browser. You'll see the login screen — type the password
from step 2. That's your live app. 🎉

## Updating the app later

| You changed... | Run this (from `worker/`) |
| --- | --- |
| The frontend, the Worker, or both | `npm run deploy` |
| Staging instead of production | `npm run deploy:staging` |
| The password | `npx wrangler secret put APP_PASSWORD` (no redeploy needed) |

Both deploy scripts rebuild the frontend first, so the same command covers
every kind of change.

## Automatic deploys (Cloudflare Workers Builds)

Pushes to `dev` build and deploy to staging automatically. That is configured
in the Cloudflare dashboard, under the Worker's **Settings → Build**, and it
needs these three values:

| Setting | Value |
| --- | --- |
| Root directory | `worker` |
| Build command | *(leave empty)* |
| Deploy command | `npm run deploy:ci` |

**Root directory must be `worker`** — `wrangler.toml` lives there, and running
wrangler from the repo root fails with "Missing entry-point to Worker script or
to assets directory". A quick way to spot that mistake in the build log: if npm
has to *install* wrangler (`npm warn exec ... will be installed`) rather than
using the version pinned in `worker/package.json`, it is running from the wrong
directory.

The build command stays empty because `deploy:ci` already builds the frontend
through its own `predeploy:ci` hook. Keeping that logic in `package.json`
rather than in the dashboard means it is version-controlled and identical to
what a local deploy does.

## Database migrations

`worker/schema.sql` only creates things that don't exist yet, so it can't add
a column to a database that's already live. New columns come as numbered files
in `worker/migrations/`, run by hand, **once per database**:

```bash
cd worker
npx wrangler d1 execute recipe-grocery-app --remote --file=./migrations/0004_add_sort_mode_and_position.sql
```

Three things to know before running one:

- **They are not idempotent.** SQLite has no `ADD COLUMN IF NOT EXISTS`, so a
  second run fails with "duplicate column name".
- **A partial apply is a dead end if you just re-run the file.** It stops on
  the first already-applied statement and never reaches the rest. Check what
  actually landed before assuming, e.g. for migration 0004:

  ```bash
  npx wrangler d1 execute recipe-grocery-app --remote --command "SELECT name FROM pragma_table_info('grocery_items')"
  ```

  Check every table the migration touches, not just one — 0004 alters both
  `grocery_items` and `grocery_lists`, and checking only the first is how a
  half-applied migration got misdiagnosed here. Keep each command on ONE line:
  a `\` line-continuation is bash-only and arrives mangled in PowerShell,
  which fails as an opaque Cloudflare API error rather than a syntax error.

  Then run only the statements whose column is missing. Symptom to watch for:
  the app loads and reads fine, but writes fail with a bare 500 — a missing
  column only breaks the statements that name it.
- **Staging and production share one database** (see `wrangler.toml`). There is
  no separate copy of the data, so running a migration "for staging" changes
  real data. Take a restore point first:

  ```bash
  npx wrangler d1 time-travel info recipe-grocery-app
  ```

  D1 keeps 30 days of point-in-time restore, no setup needed.

Migrations so far add columns with defaults, so a Worker deployed *before* the
migration keeps working *after* it — it's safe to migrate first, then deploy.

To bring a local dev database up to date, run the same file with `--local`.

## What each command does

| Command | Plain-English purpose |
| --- | --- |
| `npx wrangler login` | Lets the CLI act on your Cloudflare account |
| `npx wrangler secret put APP_PASSWORD` | Sets the app's login password, stored securely |
| `npm run deploy` (in `worker/`) | Builds the frontend, then puts the whole app online at one URL |
| `npm run deploy:ci` (in `worker/`) | Same build, but uploads a version instead of deploying — what Cloudflare Workers Builds runs |

## Local development (optional)

To run the app on your own machine while developing:

```bash
# one time: set a local password (this file is gitignored)
cd worker
cp .dev.vars.example .dev.vars   # edit the value if you like

# terminal 1 — the API + a local copy of the database
npm install && npx wrangler dev

# terminal 2 — the frontend with hot reload
cd ../frontend && npm install && npm run dev
```

Then open the Vite URL it prints (usually http://localhost:5173). It proxies
`/api` and `/photos` to the local Worker on port 8787.

> Note: `wrangler dev` uses a **local** copy of the database by default, which
> starts empty. To load the schema and sample data into it:
> ```bash
> cd worker
> npx wrangler d1 execute recipe-grocery-app --local --file=./schema.sql
> npx wrangler d1 execute recipe-grocery-app --local --file=./seed.sql
> ```
> (Drop `--local` to run against the real remote database instead — be careful,
> that changes live data.)

## Troubleshooting

- **`wrangler: command not found`** — use `npx wrangler ...` (with the `npx`
  prefix), and make sure you ran `npm install` in `worker/` first.
- **Login page rejects every password** — the `APP_PASSWORD` secret isn't set
  for production. Re-run step 2, then redeploy.
- **App loads but recipes don't appear** — a stale `frontend/dist` was
  uploaded, which happens when `npx wrangler deploy` is run directly. Use
  `npm run deploy`.
- **`wrangler deploy` complains it can't find `../frontend/dist`** — you ran
  `npx wrangler deploy` directly, which skips the build hook. Use
  `npm run deploy` instead.
- **A Workers build fails with "Missing entry-point to Worker script"** — the
  build's root directory isn't `worker`. See the table above.
