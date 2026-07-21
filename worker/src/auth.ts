import type { Context, Next } from "hono";
import type { Env } from "./types";

// Generates a random opaque session token (not a JWT — kept deliberately
// simple since this is a single shared-login account, not multi-user auth).
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Middleware: requires a valid Bearer session token for protected routes.
export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return c.json({ error: "Authentification requise" }, 401);
  }

  const session = await c.env.DB.prepare(
    "SELECT token FROM sessions WHERE token = ?"
  )
    .bind(token)
    .first();

  if (!session) {
    return c.json({ error: "Session invalide ou expirée" }, 401);
  }

  await next();
}
