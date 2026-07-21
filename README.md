# Recettes & Courses — Phase 1 Scaffold

Phase 1 (Core MVP) of the recipe & grocery list app, per the product spec.
Infrastructure (D1 + R2) is already provisioned on your Cloudflare account:

- **D1 database:** `recipe-grocery-app` (`6782f5af-9035-4725-ad2e-eb62aba5b364`) — schema + seeded categories already applied
- **R2 bucket:** `recipe-grocery-app-photos`

This scaffold has two parts:

- `worker/` — the API (Hono on Cloudflare Workers), talks to D1 and R2
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

### 2. Deploy the Worker (API)

```bash
wrangler deploy
```

This prints a `*.workers.dev` URL — that's your API base.

### 3. Deploy the frontend to Pages

```bash
cd ../frontend
npm install
npm run build
wrangler pages deploy dist --project-name=recipe-grocery-app
```

### 4. Connect frontend to the Worker

In production, the frontend needs `/api/*` and `/photos/*` requests routed to
the Worker. The simplest approach: add a Pages Function or a `_routes.json` /
custom domain route so the Pages project proxies those paths to the deployed
Worker (the local `vite.config.ts` proxy only works for `wrangler dev`/`vite
dev`). Alternatively, point the frontend's `fetch` calls in `src/lib/api.ts`
at the full `https://recipe-grocery-worker.<your-subdomain>.workers.dev` URL.

## Local development

```bash
# terminal 1
cd worker && npm install && wrangler dev

# terminal 2
cd frontend && npm install && npm run dev
```

Then open the Vite dev URL (usually `http://localhost:5173`) — it proxies
`/api` and `/photos` to the Worker on `localhost:8787`.
