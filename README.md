# Recettes & Courses — Phase 1 Scaffold

Phase 1 (Core MVP) of the recipe & grocery list app, per the product spec.
Infrastructure (D1 + R2) is already provisioned on your Cloudflare account:

- **D1 database:** `recipe-grocery-app` (`6782f5af-9035-4725-ad2e-eb62aba5b364`) — schema + seeded categories already applied
- **R2 bucket:** `recipe-grocery-app-photos`

This scaffold has two parts:

- `worker/` — the API (Hono on Cloudflare Workers), talks to D1 and R2, and
  also serves the built frontend as static assets (single origin)
- `frontend/` — the React + Tailwind PWA, talks to the Worker API

## What's included (Phase 1)

- Shared login (single password, session token) — see `worker/wrangler.toml`
- Manual recipe entry: title, description, photo, ingredients, steps, servings,
  prep/cook time, difficulty, source URL, notes
- Recipe list, detail view, full-text search, tags, favorites
- Basic grocery list: standalone items, grouped by the seeded aisle categories, check-off

**Not yet included** (later phases per the spec): recipe→list auto-population is
present as a basic "add all ingredients" button, but the food dictionary,
cross-language merging, URL import, custom categories (Phase 2), meal planning,
servings scaling, per-store ordering (Phase 3) are not built yet.

## Deploying

You'll need `wrangler` (Cloudflare's CLI) and to be logged into the same
Cloudflare account these resources were created on. This part needs an actual
terminal — it's a good fit for Claude Code.

### 1. Set the shared login password

```bash
cd worker
npm install
wrangler secret put APP_PASSWORD
# paste the password you want to use — do not commit it anywhere
```

### 2. Build the frontend

The Worker serves the frontend as static assets, so it needs to be built
first. The Worker's `wrangler.toml` points `[assets].directory` at
`../frontend/dist`.

```bash
cd ../frontend
npm install
npm run build
```

### 3. Deploy the Worker (API + frontend, single origin)

```bash
cd ../worker
wrangler deploy
```

This uploads the API **and** `../frontend/dist` together and prints a single
`*.workers.dev` URL. That one origin serves everything:

- `/api/*` and `/photos/*` are handled by the Worker
- static files (JS/CSS/manifest) are served directly
- any other path falls back to `index.html` so client-side routing works

Because the frontend and API share an origin, the frontend's relative
`fetch("/api/...")` calls in `src/lib/api.ts` work in production as-is — no
Pages project, `_routes.json`, or CORS configuration required. Re-run
`npm run build` in `frontend/` and `wrangler deploy` in `worker/` to ship
frontend changes.

## Local development

```bash
# terminal 1
cd worker && npm install && wrangler dev

# terminal 2
cd frontend && npm install && npm run dev
```

Then open the Vite dev URL (usually `http://localhost:5173`) — it proxies
`/api` and `/photos` to the Worker on `localhost:8787`.
