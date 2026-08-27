export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  APP_PASSWORD: string;
  // Static assets binding: the built frontend SPA (see [assets] in wrangler.toml).
  ASSETS: Fetcher;
  // Optional: the deterministic paths (URL import, PDF recipe import, cookbook
  // contents) all work without it. Only cookbook recipe extraction needs it,
  // and it says so plainly when it is missing rather than failing obscurely.
  //   wrangler secret put ANTHROPIC_API_KEY
  ANTHROPIC_API_KEY?: string;
}
