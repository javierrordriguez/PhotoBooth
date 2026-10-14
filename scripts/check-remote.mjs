// Read-only security smoke checks. No privileged credentials or real images.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const lines = (await readFile(".env.local", "utf8")).split(/\r?\n/);
const config = Object.fromEntries(
  lines
    .filter((x) => x.startsWith("VITE_"))
    .map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i), x.slice(i + 1).trim()];
    }),
);
const base = config.VITE_SUPABASE_URL;
const key = config.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.ok(base?.startsWith("https://") && key?.startsWith("sb_publishable_"));
const origin = "http://127.0.0.1:5173";
const endpoint = base + "/functions/v1/device-api?action=context";
for (const authorization of [
  undefined,
  "Bearer invalid-token",
  "Bearer " + key,
]) {
  const headers = { Origin: origin, apikey: key };
  if (authorization) headers.Authorization = authorization;
  const result = await fetch(endpoint, { method: "POST", headers });
  assert.equal(result.status, 401);
  assert.equal(result.headers.get("cache-control"), "no-store");
}
const preflight = await fetch(endpoint, {
  method: "OPTIONS",
  headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
});
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
const foreign = await fetch(endpoint, {
  method: "POST",
  headers: { Origin: "https://unauthorized.invalid" },
});
assert.equal(foreign.status, 403);
assert.equal(foreign.headers.get("access-control-allow-origin"), null);
for (const table of [
  "events",
  "devices",
  "photo_sessions",
  "photos",
  "event_admins",
]) {
  const response = await fetch(
    base + "/rest/v1/" + table + "?select=*&limit=1",
    { headers: { apikey: key } },
  );
  assert.ok(
    [401, 403].includes(response.status),
    table + " must deny anonymous reads",
  );
}
console.log(
  "Remote smoke passed: invalid credentials, CORS, no-store and five protected tables.",
);
