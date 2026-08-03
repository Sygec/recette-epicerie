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

There are **two** Worker projects, one per environment, each watching its own
branch:

| Cloudflare project | Production branch | Deploys to |
| --- | --- | --- |
| `recipe-grocery-worker-staging` | `dev` | staging |
| `recipe-grocery-worker` | `main` | production |

Both are configured in the Cloudflare dashboard under **Settings → Build**.
These are per-project settings: filling them in on one does nothing for the
other.

**The one rule that matters: wrangler must run from `worker/`.** That is where
`wrangler.toml` lives, and wrangler started anywhere else fails with "Missing
entry-point to Worker script or to assets directory". There are two ways to
satisfy it, and the two projects happen to use one each — either is fine, but
don't mix halves of them.

*Path `worker`, and let the npm scripts do the rest:*

| Setting | Value |
| --- | --- |
| Path (root directory) | `worker` |
| Build command | *(leave empty)* |
| Deploy command | `npm run deploy:ci` |

The build command stays empty because `deploy:ci` already builds the frontend
through its own `predeploy:ci` hook. Keeping that logic in `package.json`
rather than in the dashboard means it is version-controlled and identical to
what a local deploy does.

*Or Path `/`, with each command changing directory itself* — which is what
`recipe-grocery-worker` does today:

| Setting | Value |
| --- | --- |
| Path (root directory) | `/` |
| Build command | `cd frontend && npm install && npm run build` |
| Deploy command | `cd worker && npm install && npx wrangler deploy --env=""` |

Here the build command builds the frontend, so `wrangler deploy` finds
`../frontend/dist` already waiting. Every command that touches wrangler needs
its own `cd worker` — the one described below didn't, which is where this bit
us.

A quick way to spot a command running from the wrong directory: if the build
log shows npm *installing* wrangler (`npm warn exec ... will be installed`)
rather than using the version pinned in `worker/package.json`, it is not in
`worker/`.

### Non-production branches

**Both projects have non-production branch builds turned off**, under
**Settings → Build → Branch control**. Each therefore builds only its own
branch: a push to `dev` builds staging and nothing else, a push to `main`
builds production and nothing else. One push, one build, one check.

It is worth knowing why, because the default is the opposite and turning it
back on has a sharp edge.

Left on, a project builds *every* branch, not only its own. For a branch that
isn't its production branch it runs a separate field, **Non-production branch
deploy command**, instead of the deploy command. That field is marked optional,
but optional means "fall back to the default" — a bare `npx wrangler versions
upload` — not "do nothing", so clearing it switches nothing off.

**"Non-production branch" is relative to the project, and each project treats
the other's branch as one.** Neither settings page tells you this, because each
shows only its own production branch:

| Push to... | `recipe-grocery-worker-staging` runs | `recipe-grocery-worker` runs |
| --- | --- | --- |
| `dev` | its deploy command *(production branch)* | its non-production command |
| `main` | its non-production command | its deploy command *(production branch)* |

So `main` is a non-production branch as far as staging is concerned, exactly as
`dev` is to production.

That is what bit this repo. Every push to `dev` also started a build on the
*production* project, where the bare default ran wrangler from the repo root —
no `cd worker`, no `wrangler.toml` — and failed with "Missing entry-point".
GitHub showed a red **"Workers Builds: recipe-grocery-worker"** check on the
pull request, which reads as "production is broken" while production was
perfectly fine. Two pull requests were merged over that check before anyone
opened the log.

Whether it fails at all depends on nothing but the project's Path. Under Path
`worker` the bare default already runs in the right directory and succeeds;
under Path `/` it doesn't. Identical command, opposite outcome — which is why
this hit production and may never have touched staging.

Two things make that failure easy to misread, worth remembering if it ever
comes back:

- `versions upload` only uploads a version — it never shifts traffic. A failure
  there cannot have broken a running deployment, whatever the check says.
- Cloudflare stamps the GitHub check when the build ends, so the API reports
  identical start and end times for a build that ran for minutes. That looks
  like a build that was skipped and never ran. Read the log, not the
  timestamps.

If you do want these builds back — for a version uploaded per pull request —
give the non-production command the same `cd worker` the deploy command beside
it already has:

```
cd worker && npm install && npx wrangler versions upload
```

Note that even when it succeeds it uploads a version built from the *other*
environment's branch. Nothing breaks, since traffic never moves, but each
Worker's version list ends up mixed and harder to read later. That is the
reason both projects have it off.

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
- **A Workers build fails with "Missing entry-point to Worker script"** — that
  command isn't running in `worker/`. Either the Path setting or a `cd worker`
  in front of it has to put it there. See the tables above.
- **A pull request into `main` shows a red "Workers Builds:
  recipe-grocery-worker" check** — non-production branch builds have been
  switched back on for that project. It is building the *source* branch with
  its non-production command, not production failing. Check the log: if the
  deploy step ran wrangler without a `cd worker` in front of it, that is what
  happened. See "Non-production branches".
- **A build check reports a failure with no duration** — Cloudflare stamps the
  GitHub check when the build ends, so the API can show identical start and
  end times for a build that ran for minutes. Read the build log rather than
  the timestamps.
