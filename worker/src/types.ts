export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  APP_PASSWORD: string;
  // Static assets binding: the built frontend SPA (see [assets] in wrangler.toml).
  ASSETS: Fetcher;
}
