import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  BoothDB,
  createDraft,
  saveOriginal,
  confirmSession,
  discardDraft,
} from "../../src/persistence/db";
import { defaults, type Photo } from "../../src/sessions/model";
let db: BoothDB;
beforeEach(() => {
  db = new BoothDB("test-" + crypto.randomUUID());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});
const original = (id: string, position: number): Photo => ({
  sessionId: id,
  position,
  type: "original",
  blob: new Blob(["jpeg"], { type: "image/jpeg" }),
  width: 4000,
  height: 3000,
});
const strip = (id: string): Photo => ({
  ...original(id, 0),
  type: "strip",
  width: 1200,
  height: 3600,
});
it("migra una base real de Fase 1 conservando fotos sin vincularlas", async () => {
  const legacy = new Dexie(db.name);
  legacy
    .version(1)
    .stores({
      sessions: "id,createdAt,status",
      photos: "[sessionId+position],sessionId",
      settings: "id",
    });
  const id = crypto.randomUUID();
  await legacy
    .table("sessions")
    .add({
      id,
      status: "draft",
      createdAt: new Date().toISOString(),
      settings: defaults,
    });
  await legacy.table("photos").add(original(id, 1));
  legacy.close();
  await db.open();
  expect((await db.sessions.get(id))?.binding).toBeUndefined();
  expect((await db.photos.get([id, 1]))?.blob.size).toBe(4);
  expect(await db.syncJobs.count()).toBe(0);
  expect(await db.connection.count()).toBe(0);
});
it("recupera borradores tras reabrir IndexedDB", async () => {
  const s = await createDraft(defaults, db);
  await saveOriginal(original(s.id, 1), db);
  db.close();
  await db.open();
  expect((await db.sessions.get(s.id))?.status).toBe("draft");
  expect(await db.photos.count()).toBe(1);
});
it("confirma cinco archivos de forma idempotente", async () => {
  const s = await createDraft(defaults, db);
  for (let i = 1; i <= 4; i++) await saveOriginal(original(s.id, i), db);
  await saveOriginal(original(s.id, 1), db);
  await confirmSession(s.id, strip(s.id), db);
  await confirmSession(s.id, strip(s.id), db);
  expect(await db.photos.count()).toBe(5);
  expect((await db.sessions.get(s.id))?.status).toBe("pending");
  await expect(discardDraft(s.id, db)).rejects.toThrow();
});
it("no confirma una sesión incompleta ni mezcla sesiones", async () => {
  const a = await createDraft(defaults, db),
    b = await createDraft(defaults, db);
  for (let i = 1; i <= 3; i++) await saveOriginal(original(a.id, i), db);
  await saveOriginal(original(b.id, 4), db);
  await expect(confirmSession(a.id, strip(a.id), db)).rejects.toThrow();
  expect((await db.sessions.get(a.id))?.status).toBe("draft");
  expect(await db.photos.where("sessionId").equals(a.id).count()).toBe(3);
});
it("revierte la tira si falla actualizar la sesión y permite reintentar", async () => {
  const s = await createDraft(defaults, db);
  for (let i = 1; i <= 4; i++) await saveOriginal(original(s.id, i), db);
  const mock = vi
    .spyOn(db.sessions, "update")
    .mockRejectedValueOnce(
      new DOMException("Sin espacio", "QuotaExceededError"),
    );
  await expect(confirmSession(s.id, strip(s.id), db)).rejects.toThrow();
  mock.mockRestore();
  expect(await db.photos.count()).toBe(4);
  expect((await db.sessions.get(s.id))?.status).toBe("draft");
  await confirmSession(s.id, strip(s.id), db);
  expect(await db.photos.count()).toBe(5);
});
it("descarta solamente el borrador seleccionado", async () => {
  const a = await createDraft(defaults, db),
    b = await createDraft(defaults, db);
  await saveOriginal(original(a.id, 1), db);
  await saveOriginal(original(b.id, 1), db);
  await discardDraft(a.id, db);
  expect(await db.sessions.count()).toBe(1);
  expect((await db.photos.toArray())[0]?.sessionId).toBe(b.id);
});
