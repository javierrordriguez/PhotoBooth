import { beforeEach, it, expect, vi } from "vitest";
import jpeg from "jpeg-js";
import { validateJpeg } from "../../supabase/functions/_shared/jpeg";
import {
  createHandler,
  type Backend,
  type StoredPhoto,
} from "../../supabase/functions/_shared/handler";
import {
  ApiError,
  boundedBody,
  sha256,
  manifest,
} from "../../supabase/functions/_shared/protocol";
import { publicConfig } from "../../src/sync/client";
const id = crypto.randomUUID(),
  deviceId = crypto.randomUUID(),
  eventId = crypto.randomUUID();
it("acepta una tira completa y un original 4K dentro del presupuesto de memoria", () => {
  for (const [width, height] of [
    [1200, 3600],
    [3840, 2160],
  ] as const) {
    const encoded = jpeg.encode(
      { width, height, data: new Uint8Array(width * height * 4).fill(255) },
      90,
    ).data;
    expect(() => validateJpeg(encoded, width, height)).not.toThrow();
  }
}, 30000);
let bytes: Uint8Array,
  slot: StoredPhoto,
  backend: Backend,
  command: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  bytes = new Uint8Array(
    jpeg.encode(
      { width: 2, height: 2, data: new Uint8Array(16).fill(255) },
      90,
    ).data,
  );
  slot = {
    position: 1,
    storage_path: "private/path.jpg",
    sha256: await sha256(bytes),
    size_bytes: bytes.length,
    width: 2,
    height: 2,
    uploaded_at: null,
  };
  command = vi.fn(async (_u: string, action: string) => {
    if (action === "context") return { deviceId, eventId };
    if (action === "slot") return slot;
    return { status: "uploading", photos: [{ ...slot, uploaded_at: "now" }] };
  });
  backend = {
    authenticate: vi.fn(async (token) => {
      if (token !== "valid") throw new ApiError(401, "authentication_required");
      return "verified-user";
    }),
    command,
    upload: vi.fn(async () => {}),
    download: vi.fn(async () => bytes),
  };
});
function request(
  action: string,
  body?: Uint8Array,
  extra: Record<string, string> = {},
) {
  return new Request(
    `https://example.supabase.co/functions/v1/device-api?action=${action}&id=${id}&position=1`,
    {
      method: "POST",
      headers: {
        Origin: "http://localhost:4173",
        Authorization: "Bearer valid",
        "x-device-id": deviceId,
        "x-event-id": eventId,
        "Content-Type": "image/jpeg",
        ...extra,
      },
      body: body ? new Uint8Array(body) : undefined,
    },
  );
}
const handler = () => createHandler(backend, ["http://localhost:4173"]);
it("rechaza anónimos y origen no permitido antes de operaciones sensibles", async () => {
  expect(
    (await handler()(request("upload", bytes, { Authorization: "" }))).status,
  ).toBe(401);
  expect(command).not.toHaveBeenCalled();
  expect(
    (
      await handler()(
        request("upload", bytes, { Origin: "https://evil.example" }),
      )
    ).status,
  ).toBe(403);
  expect(command).not.toHaveBeenCalled();
});
it("usuario autenticado sin dispositivo no se convierte en administrador", async () => {
  command.mockRejectedValue(new ApiError(403, "operation_forbidden"));
  expect((await handler()(request("context"))).status).toBe(403);
  expect(backend.upload).not.toHaveBeenCalled();
});
it("verifica vinculación y no expone paths ni hashes en la respuesta", async () => {
  expect(
    (
      await handler()(
        request("upload", bytes, { "x-device-id": crypto.randomUUID() }),
      )
    ).status,
  ).toBe(403);
  const res = await handler()(request("upload", bytes));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "uploading", uploaded: [1] });
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("access-control-allow-origin")).toBe(
    "http://localhost:4173",
  );
  expect(command).toHaveBeenCalledWith(
    "verified-user",
    "ack",
    id,
    undefined,
    1,
  );
});
it("valida JPEG real, hash, MIME y tamaño, no solo extensión", async () => {
  expect(
    (await handler()(request("upload", bytes, { "Content-Type": "image/png" })))
      .status,
  ).toBe(415);
  expect(
    (await handler()(request("upload", new Uint8Array([1, 2, 3])))).status,
  ).toBe(409);
  expect(
    (
      await handler()(
        request("upload", bytes, { "Content-Length": "12582913" }),
      )
    ).status,
  ).toBe(413);
  const fake = new Uint8Array([255, 216, 0, 0, 255, 217]);
  slot = { ...slot, size_bytes: fake.length, sha256: await sha256(fake) };
  expect((await handler()(request("upload", fake))).status).toBe(422);
  expect(backend.upload).not.toHaveBeenCalled();
});
it("recupera una subida cuya respuesta se perdió comprobando el objeto", async () => {
  vi.mocked(backend.upload).mockRejectedValue(new Error("response lost"));
  const res = await handler()(request("upload", bytes));
  expect(res.status).toBe(200);
  expect(backend.download).toHaveBeenCalledWith(slot.storage_path);
});
it("no acepta un objeto existente con contenido distinto", async () => {
  vi.mocked(backend.upload).mockRejectedValue(new Error("duplicate"));
  vi.mocked(backend.download).mockResolvedValue(new Uint8Array([1, 2]));
  expect((await handler()(request("upload", bytes))).status).toBe(409);
  expect(command.mock.calls.some((c) => c[1] === "ack")).toBe(false);
});
it("finalizar exige los cinco objetos y su contenido persistido", async () => {
  expect((await handler()(request("finalize"))).status).toBe(409);
  command.mockImplementation(async (_u: string, a: string) =>
    a === "context"
      ? { deviceId, eventId }
      : a === "status"
        ? {
            status: "uploading",
            photos: Array.from({ length: 5 }, (_, position) => ({
              ...slot,
              position,
              uploaded_at: "now",
            })),
          }
        : {
            status: "ready",
            photos: Array.from({ length: 5 }, (_, position) => ({
              ...slot,
              position,
              uploaded_at: "now",
            })),
          },
  );
  vi.mocked(backend.download).mockResolvedValue(new Uint8Array([9]));
  expect((await handler()(request("finalize"))).status).toBe(409);
  expect(command.mock.calls.some((c) => c[1] === "finalize")).toBe(false);
  vi.mocked(backend.download).mockResolvedValue(bytes);
  expect((await handler()(request("finalize"))).status).toBe(200);
});
it("limita cuerpos sin Content-Length y rechaza manifiestos inválidos", async () => {
  await expect(
    boundedBody(
      new Request("https://example.com", { method: "POST", body: "123456" }),
      5,
    ),
  ).rejects.toThrow("file_too_large");
  expect(() => manifest([])).toThrow();
  expect(() =>
    publicConfig("https://example.supabase.co", "sb_secret_bad"),
  ).toThrow();
  expect(() =>
    publicConfig("http://example.com", "sb_publishable_test"),
  ).toThrow();
});
