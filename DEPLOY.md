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

## Deploy — 5 steps

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

### 3. Build the frontend

This turns the React source into the static files the Worker will serve.

```bash
cd ../frontend
npm install
npm run build
```

### 4. Deploy

Uploads the API **and** the built frontend together.

```bash
cd ../worker
npx wrangler deploy
```

When it finishes, it prints a URL like
`https://recipe-grocery-worker.<your-name>.workers.dev`.

### 5. Open the URL

Visit that URL in your browser. You'll see the login screen — type the password
from step 2. That's your live app. 🎉

## Updating the app later

| You changed... | Run this |
| --- | --- |
| The frontend | `cd frontend && npm run build`, then `cd ../worker && npx wrangler deploy` |
| The Worker / API only | `cd worker && npx wrangler deploy` |
| The password | `cd worker && npx wrangler secret put APP_PASSWORD` (no redeploy needed) |

## What each command does

| Command | Plain-English purpose |
| --- | --- |
| `npx wrangler login` | Lets the CLI act on your Cloudflare account |
| `npx wrangler secret put APP_PASSWORD` | Sets the app's login password, stored securely |
| `npm run build` (in `frontend/`) | Compiles the website into static files |
| `npx wrangler deploy` (in `worker/`) | Puts the whole app online at one URL |

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
- **App loads but recipes don't appear** — the frontend wasn't rebuilt before
  deploying. Run step 3, then step 4 again.
- **`wrangler deploy` complains it can't find `../frontend/dist`** — you skipped
  the build. Run step 3 first.
