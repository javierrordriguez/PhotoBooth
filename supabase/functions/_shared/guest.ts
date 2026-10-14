import { ApiError, boundedBody, sha256 } from "./protocol.ts";
export const validGuestToken = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function newGuestToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function tokenHash(token: string) {
  if (!validGuestToken(token)) throw new ApiError(404, "invalid");
  return sha256(new TextEncoder().encode(token));
}
export interface GuestRecord {
  state: "ready" | "preparing" | "invalid" | "expired" | "revoked" | "limited";
  name?: string;
  date?: string;
  expiresAt?: string;
  photos?: { position: number; path: string; size: number }[];
}
export interface GuestBackend {
  lookup(hash: string): Promise<GuestRecord>;
  sign(path: string, seconds: number): Promise<string>;
}
export function guestHandler(backend: GuestBackend, origins: string[]) {
  return async (request: Request) => {
    const origin = request.headers.get("origin");
    const allowed = !!origin && origins.includes(origin);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    if (allowed) {
      headers["Access-Control-Allow-Origin"] = origin!;
      headers["Access-Control-Allow-Headers"] = "content-type, apikey";
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    }
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    try {
      if (origin && !allowed) throw new ApiError(403, "origin_forbidden");
      if (request.method === "OPTIONS") {
        if (!allowed) throw new ApiError(403, "origin_forbidden");
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "POST")
        throw new ApiError(405, "method_not_allowed");
      let body: unknown;
      try {
        body = JSON.parse(
          new TextDecoder().decode(await boundedBody(request, 256)),
        );
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(400, "invalid");
      }
      const token =
        body && typeof body === "object" && "token" in body ? body.token : null;
      if (!validGuestToken(token)) throw new ApiError(404, "invalid");
      const hash = await tokenHash(token);
      const record = await backend.lookup(hash);
      if (record.state !== "ready") {
        if (record.state === "limited") headers["Retry-After"] = "60";
        return json(
          { state: record.state },
          record.state === "limited" ? 429 : 200,
        );
      }
      if (
        record.photos?.length !== 5 ||
        new Set(record.photos.map((p) => p.position)).size !== 5
      )
        throw new ApiError(503, "temporarily_unavailable");
      const photos = await Promise.all(
        record.photos.map(async (p) => ({
          position: p.position,
          size: p.size,
          url: await backend.sign(p.path, 120),
        })),
      );
      // Check again after signing: a revocation during signing must not release URLs.
      const check = await backend.lookup(hash);
      if (check.state !== "ready") return json({ state: check.state });
      return json({
        state: "ready",
        name: record.name,
        date: record.date,
        expiresAt: record.expiresAt,
        urlsExpireAt: new Date(Date.now() + 120000).toISOString(),
        photos,
      });
    } catch (e) {
      const error =
        e instanceof ApiError
          ? e
          : new ApiError(503, "temporarily_unavailable");
      return json({ state: error.code }, error.status);
    }
  };
}
