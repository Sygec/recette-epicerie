// Shared helpers for images stored in R2.
//
// Recipes had these to themselves until cookbooks arrived and needed the same
// upload rules for cover art. Copying the allowlist would have been the wrong
// kind of cheap: it exists for a security reason (below), and a second copy is
// a second thing to forget to update.

import type { Env } from "./types";

// Images are stored in R2 and later re-served with this same Content-Type, on
// the same origin as the app (see the ASSETS catch-all in index.ts). Without
// an allowlist, an uploaded file claiming to be text/html or image/svg+xml
// could execute as a same-origin page when its /photos/* URL is opened
// directly — a stored-XSS path to the session token in localStorage. Only
// accept real raster image types.
export const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** The one French message for a rejected type, so both callers word it alike. */
export const PHOTO_TYPE_ERROR =
  "Format de fichier non pris en charge (JPEG, PNG, WEBP ou GIF requis)";

/**
 * Narrows a FormData value to a File.
 *
 * Workers' FormData yields `File | string`, and the Workers runtime doesn't
 * expose a `File` constructor to `instanceof` against, so this checks shape.
 */
export function isUploadedFile(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value
  );
}

/**
 * Deletes everything under `prefix` except `keepKey`.
 *
 * Nothing removed images from R2 before this existed, so the bucket
 * accumulated objects nothing pointed at. Called on every upload (to drop the
 * image being replaced) and on delete (to drop them all). Best-effort on
 * purpose: failing to tidy up must never fail the request that succeeded.
 */
export async function deleteStaleObjects(env: Env, prefix: string, keepKey?: string) {
  try {
    const listed = await env.PHOTOS.list({ prefix });
    const stale = listed.objects.map((o) => o.key).filter((k) => k !== keepKey);
    if (stale.length) await env.PHOTOS.delete(stale);
  } catch (err) {
    console.error("Could not clean up objects under", prefix, err);
  }
}
