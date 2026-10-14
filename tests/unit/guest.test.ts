import "fake-indexeddb/auto";
import { it, expect, vi } from "vitest";
import {
  guestHandler,
  newGuestToken,
  tokenHash,
  validGuestToken,
  type GuestRecord,
} from "../../supabase/functions/_shared/guest";
import { BoothDB } from "../../src/persistence/db";
import { registerLink, galleryOrigin } from "../../src/gallery/links";
import type { SyncApi } from "../../src/sync/client";
const origin = "https://gallery.example";
const request = (token: unknown) =>
  new Request("https://edge.example", {
    method: "POST",
    headers: { Origin: origin },
    body: JSON.stringify({ token }),
  });
it("genera tokens de 256 bits y hashes independientes", async () => {
  const values = Array.from({ length: 100 }, newGuestToken);
  expect(new Set(values).size).toBe(100);
  for (const value of values) {
    expect(validGuestToken(value)).toBe(true);
    expect(await tokenHash(value)).not.toBe(value);
  }
  for (const invalid of ["", null, "a".repeat(63), "A".repeat(64), "../other"])
    expect(validGuestToken(invalid)).toBe(false);
});
it("envía solo el hash y recupera el mismo token tras respuesta perdida", async () => {
  const db = new BoothDB("links-" + crypto.randomUUID());
  const binding = {
    projectUrl: "https://example.supabase.co",
    deviceId: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    eventName: "Test",
  };
  const call = vi
    .fn()
    .mockRejectedValueOnce(new Error("lost"))
    .mockResolvedValue({ registered: true });
  const api = { link: call } as unknown as SyncApi;
  try {
    await expect(registerLink("session", binding, api, db)).rejects.toThrow();
    const saved = await db.guestLinks.get("session");
    db.close();
    await db.open();
    const token = await registerLink("session", binding, api, db);
    expect(token).toBe(saved?.token);
    expect(call.mock.calls[0]?.[2]).toBe(await tokenHash(token));
    expect(call.mock.calls[1]?.[2]).toBe(await tokenHash(token));
    expect((await db.guestLinks.get("session"))?.registered).toBe(true);
  } finally {
    await db.delete();
  }
});
it("rechaza tokens inválidos, GET y orígenes ajenos sin consultar datos", async () => {
  const lookup = vi.fn();
  const handle = guestHandler({ lookup, sign: vi.fn() }, [origin]);
  expect((await handle(request("bad"))).status).toBe(404);
  expect((await handle(new Request("https://edge.example"))).status).toBe(405);
  expect(
    (
      await handle(
        new Request("https://edge.example", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(lookup).not.toHaveBeenCalled();
});
it.each(["preparing", "invalid", "expired", "revoked", "limited"] as const)(
  "no firma archivos para estado %s",
  async (state) => {
    const sign = vi.fn();
    const handle = guestHandler({ lookup: async () => ({ state }), sign }, [
      origin,
    ]);
    const response = await handle(request(newGuestToken()));
    expect(await response.json()).toEqual({ state });
    expect(sign).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  },
);
it("firma solo los cinco objetos autorizados por 120 segundos", async () => {
  const token = newGuestToken();
  const record: GuestRecord = {
    state: "ready",
    name: "Test",
    photos: Array.from({ length: 5 }, (_, position) => ({
      position,
      path: "own/" + position,
      size: 100,
    })),
  };
  const lookup = vi.fn(async () => record);
  const sign = vi.fn(async (p: string) => "https://storage.example/" + p);
  const response = await guestHandler({ lookup, sign }, [origin])(
    request(token),
  );
  const result = await response.json();
  expect(result.photos).toHaveLength(5);
  expect(result.photos[0].path).toBeUndefined();
  expect(lookup).toHaveBeenCalledWith(await tokenHash(token));
  expect(sign).toHaveBeenCalledWith("own/0", 120);
});
it("revocación durante la firma impide entregar enlaces", async () => {
  const lookup = vi
    .fn()
    .mockResolvedValueOnce({
      state: "ready",
      photos: Array.from({ length: 5 }, (_, position) => ({
        position,
        path: String(position),
        size: 1,
      })),
    })
    .mockResolvedValueOnce({ state: "revoked" });
  const result = await guestHandler(
    { lookup, sign: async () => "https://storage.example/signed" },
    [origin],
  )(request(newGuestToken()));
  expect(await result.json()).toEqual({ state: "revoked" });
});
it("no genera QR con localhost ni URL que contenga credenciales o rutas", () => {
  for (const value of [
    "",
    undefined,
    "http://localhost:5173",
    "https://a:b@example.com",
    "https://example.com/s/token",
  ])
    expect(galleryOrigin(value)).toBeNull();
  expect(galleryOrigin(origin)).toBe(origin);
});
