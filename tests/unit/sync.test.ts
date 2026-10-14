import "fake-indexeddb/auto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  BoothDB,
  createDraft,
  saveOriginal,
  confirmSession,
} from "../../src/persistence/db";
import { defaults, type Photo } from "../../src/sessions/model";
import { enqueue, runJob, adoptLocal, retryDelay } from "../../src/sync/engine";
import type { SyncApi } from "../../src/sync/client";
import { ApiError } from "../../supabase/functions/_shared/protocol";
import type { Binding } from "../../src/sync/types";
let db: BoothDB;
const binding: Binding = {
  projectUrl: "https://example.supabase.co",
  deviceId: crypto.randomUUID(),
  eventId: crypto.randomUUID(),
  eventName: "Test",
};
beforeEach(() => {
  db = new BoothDB("sync-" + crypto.randomUUID());
});
afterEach(async () => {
  await db.delete();
});
async function seed(bound = true) {
  if (bound) await db.connection.put({ id: "active", binding });
  const s = await createDraft(defaults, db);
  for (let i = 1; i <= 4; i++)
    await saveOriginal(
      {
        sessionId: s.id,
        position: i,
        type: "original",
        blob: new Blob(["jpeg-" + i], { type: "image/jpeg" }),
        width: 1920,
        height: 1080,
      },
      db,
    );
  const strip: Photo = {
    sessionId: s.id,
    position: 0,
    type: "strip",
    blob: new Blob(["strip"], { type: "image/jpeg" }),
    width: 1200,
    height: 3600,
  };
  await confirmSession(s.id, strip, db);
  await enqueue(db);
  return s;
}
function api() {
  const stored = new Set<number>();
  const result = () => ({
    status: stored.size === 5 ? "ready" : "uploading",
    uploaded: [...stored],
  });
  return {
    stored,
    link: vi.fn(async () => ({ registered: true })),
    context: vi.fn(async () => ({
      ...binding,
      deviceName: "Laptop",
      eventDate: "2026-12-12",
      settings: {},
    })),
    init: vi.fn(async () => result()),
    upload: vi.fn(async (_b: Binding, _id: string, pos: number) => {
      stored.add(pos);
      return result();
    }),
    finalize: vi.fn(async () => result()),
  } satisfies SyncApi & { stored: Set<number> };
}
it("las sesiones de Fase 1 requieren vinculación explícita", async () => {
  const s = await seed(false);
  expect(await db.syncJobs.count()).toBe(0);
  await adoptLocal(binding, db);
  expect((await db.syncJobs.get(s.id))?.binding).toEqual(binding);
});
it("recupera después de perder respuesta y no duplica subidas confirmadas", async () => {
  const s = await seed();
  const remote = api();
  const base = remote.upload.getMockImplementation()!;
  remote.upload.mockImplementationOnce(async (b, id, pos) => {
    await base(b, id, pos);
    throw new TypeError("offline");
  });
  await runJob((await db.syncJobs.get(s.id))!, remote, db, 1000);
  let job = (await db.syncJobs.get(s.id))!;
  expect(job.state).toBe("retry");
  expect(job.nextAttempt).toBeGreaterThan(1000);
  db.close();
  await db.open();
  await runJob(job, remote, db, job.nextAttempt);
  job = (await db.syncJobs.get(s.id))!;
  expect(job.state).toBe("synced");
  expect(remote.upload).toHaveBeenCalledTimes(5);
  expect(await db.photos.count()).toBe(5);
});
it("no sube contenido a otra identidad/evento", async () => {
  const s = await seed();
  const remote = api();
  remote.context.mockResolvedValue({
    ...binding,
    deviceId: crypto.randomUUID(),
    deviceName: "Wrong",
    eventDate: "2026-12-12",
    settings: {},
  });
  await runJob((await db.syncJobs.get(s.id))!, remote, db);
  expect((await db.syncJobs.get(s.id))?.state).toBe("blocked");
  expect(remote.init).not.toHaveBeenCalled();
});
it("errores permanentes bloquean, rate limit reintenta y nunca borra fotos", async () => {
  const s = await seed();
  const remote = api();
  remote.init.mockRejectedValueOnce(new ApiError(429, "rate_limited"));
  await runJob((await db.syncJobs.get(s.id))!, remote, db);
  expect((await db.syncJobs.get(s.id))?.state).toBe("retry");
  remote.init.mockRejectedValueOnce(new ApiError(403, "operation_forbidden"));
  await runJob((await db.syncJobs.get(s.id))!, remote, db);
  expect((await db.syncJobs.get(s.id))?.state).toBe("blocked");
  expect(await db.photos.count()).toBe(5);
  expect(retryDelay(50)).toBe(300000);
});
it("no declara sincronizada sin confirmación remota de los cinco objetos", async () => {
  const s = await seed();
  const remote = api();
  remote.finalize.mockResolvedValue({
    status: "uploading",
    uploaded: [0, 1, 2, 3],
  });
  await runJob((await db.syncJobs.get(s.id))!, remote, db);
  expect((await db.syncJobs.get(s.id))?.state).toBe("retry");
});
