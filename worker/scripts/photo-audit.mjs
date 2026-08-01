#!/usr/bin/env node
// Audits recipe photos in R2 against the database, and optionally repairs.
//
// Nothing deleted from R2 before this, so the bucket accumulated objects
// nothing points at. Worse, saving the edit form used to wipe a recipe's
// photo_url — so some recipes lost their photo while the image itself is
// still sitting in the bucket. Keys are "recipes/<recipeId>/<millis>-<name>",
// which is what makes those recoverable rather than guesswork.
//
// Report only (default) — touches nothing:
//   node scripts/photo-audit.mjs --url https://your-worker.workers.dev
//
// Then, if the plan looks right:
//   node scripts/photo-audit.mjs --url https://your-worker.workers.dev --apply
//
// The password is prompted for, or taken from $APP_PASSWORD.
// --apply sends back exactly the plan that was printed, so nothing is acted
// on that you have not seen. The server re-checks every key against the live
// photo_url set before deleting, so a key that became a recipe's current
// photo in between is kept regardless.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const baseUrl = (value("--url") ?? "").replace(/\/$/, "");
const apply = has("--apply");

if (!baseUrl) {
  console.error("Usage: node scripts/photo-audit.mjs --url <worker-url> [--apply]");
  process.exit(1);
}

async function prompt(question, { silent = false } = {}) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  if (silent) {
    // Keep the password off the screen.
    const onData = (char) => {
      if (["\n", "\r", ""].includes(char.toString())) return;
      stdout.write("[2K[200D" + question);
    };
    stdin.on("data", onData);
    const answer = await rl.question(question);
    stdin.off("data", onData);
    rl.close();
    stdout.write("\n");
    return answer;
  }
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

const password = process.env.APP_PASSWORD ?? (await prompt("Mot de passe : ", { silent: true }));

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(body.error ?? `${path} failed with ${res.status}`);
  return body;
}

const { token } = await api("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ password }),
});
const auth = { Authorization: `Bearer ${token}` };

const audit = await api("/api/maintenance/photo-audit", { headers: auth });
const { summary, entries, remap, delete_keys: deleteKeys } = audit;

// Real photos are hundreds of KB, but a report that says "0.00 MB" for
// everything is useless when the objects happen to be small.
const size = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};
const bucket = (verdict) => entries.filter((e) => e.verdict === verdict);

console.log(`\n${summary.total} objects under recipes/\n`);
console.log(`  in use         ${String(summary.in_use).padStart(4)}   current photo of a recipe — kept`);
console.log(`  restorable     ${String(summary.restorable).padStart(4)}   recipe lost its photo; image still here`);
console.log(`  superseded     ${String(summary.superseded).padStart(4)}   replaced by a newer upload`);
console.log(`  dangling       ${String(summary.dangling).padStart(4)}   recipe no longer exists`);
console.log(`  unattributable ${String(summary.unattributable).padStart(4)}   unexpected key layout — never deleted`);
console.log(`\n  ${deleteKeys.length} objects would be deleted, reclaiming ${size(summary.reclaimed_bytes)}\n`);

if (remap.length) {
  console.log("WOULD RESTORE these photos to recipes that lost them:\n");
  for (const r of remap) {
    console.log(`  recipe ${r.recipe_id}  ${r.recipe_title ?? "(untitled)"}`);
    console.log(`    -> ${r.photo_url}`);
    console.log(`       uploaded ${r.uploaded}`);
  }
  console.log("");
}

for (const [verdict, label] of [
  ["superseded", "WOULD DELETE — superseded by a newer upload"],
  ["dangling", "WOULD DELETE — recipe no longer exists"],
]) {
  const rows = bucket(verdict);
  if (!rows.length) continue;
  console.log(`${label} (${rows.length}):\n`);
  for (const e of rows) {
    const who = e.recipe_title ? `recipe ${e.recipe_id} — ${e.recipe_title}` : `recipe ${e.recipe_id}`;
    console.log(`  ${e.key}`);
    console.log(`    ${who}, ${size(e.size)}, uploaded ${e.uploaded}`);
  }
  console.log("");
}

const unattributable = bucket("unattributable");
if (unattributable.length) {
  console.log(`LEFT ALONE — key doesn't match recipes/<id>/ (${unattributable.length}):\n`);
  for (const e of unattributable) console.log(`  ${e.key}`);
  console.log("");
}

if (!apply) {
  console.log("Report only — nothing was changed.");
  console.log("Re-run with --apply to restore and delete exactly what is listed above.");
  process.exit(0);
}

if (!remap.length && !deleteKeys.length) {
  console.log("Nothing to do.");
  process.exit(0);
}

const confirm = await prompt(
  `Restore ${remap.length} photo(s) and permanently delete ${deleteKeys.length} object(s)? [y/N] `
);
if (confirm.trim().toLowerCase() !== "y") {
  console.log("Aborted — nothing was changed.");
  process.exit(0);
}

const result = await api("/api/maintenance/photo-cleanup", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({
    delete_keys: deleteKeys,
    remap: remap.map(({ recipe_id, photo_url }) => ({ recipe_id, photo_url })),
  }),
});

console.log(`\nRestored ${result.remapped.length} photo(s).`);
console.log(`Deleted ${result.deleted.length} object(s).`);
if (result.skipped.length) {
  console.log(
    `Kept ${result.skipped.length} that became a recipe's current photo since the audit.`
  );
}
