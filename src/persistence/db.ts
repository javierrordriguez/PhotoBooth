import Dexie, { type Table } from "dexie";
import type { Binding, SyncJob } from "../sync/types";
import {
  assertOriginals,
  validateSettings,
  type Session,
  type Photo,
  type Settings,
} from "../sessions/model";
export class BoothDB extends Dexie {
  sessions!: Table<Session, string>;
  photos!: Table<Photo, [string, number]>;
  settings!: Table<{ id: string; value: Settings }, string>;
  syncJobs!: Table<SyncJob, string>;
  connection!: Table<{ id: string; binding: Binding }, string>;
  guestLinks!: Table<
    { sessionId: string; token: string; registered: boolean },
    string
  >;
  constructor(name = "tami-photo-booth-v1") {
    super(name);
    this.version(1).stores({
      sessions: "id,createdAt,status",
      photos: "[sessionId+position],sessionId",
      settings: "id",
    });
    this.version(2).stores({
      syncJobs: "sessionId,state,nextAttempt",
      connection: "id",
    });
    this.version(3).stores({ guestLinks: "sessionId" });
  }
}
export const db = new BoothDB();
export async function createDraft(
  settings: Settings,
  database = db,
): Promise<Session> {
  const s: Session = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "draft",
    settings: validateSettings(settings),
    binding: (await database.connection.get("active"))?.binding,
  };
  await database.sessions.add(s);
  return s;
}
export async function saveOriginal(photo: Photo, database = db) {
  await database.transaction(
    "rw",
    database.sessions,
    database.photos,
    async () => {
      const s = await database.sessions.get(photo.sessionId);
      if (
        !s ||
        s.status !== "draft" ||
        photo.type !== "original" ||
        !Number.isInteger(photo.position) ||
        photo.position < 1 ||
        photo.position > 4 ||
        !photo.blob.size ||
        photo.blob.type !== "image/jpeg"
      )
        throw new Error("Captura no válida.");
      await database.photos.put(photo);
    },
  );
}
export async function confirmSession(id: string, strip: Photo, database = db) {
  await database.transaction(
    "rw",
    database.sessions,
    database.photos,
    async () => {
      const s = await database.sessions.get(id);
      if (!s) throw new Error("Sesión inexistente.");
      assertOriginals(
        await database.photos
          .where("sessionId")
          .equals(id)
          .filter((p) => p.type === "original")
          .toArray(),
        id,
      );
      if (
        strip.sessionId !== id ||
        strip.type !== "strip" ||
        strip.position !== 0 ||
        !strip.blob.size ||
        strip.blob.type !== "image/jpeg" ||
        strip.width !== 1200 ||
        strip.height !== 3600
      )
        throw new Error("Tira no válida.");
      if (s.status === "pending") return;
      await database.photos.put(strip);
      await database.sessions.update(id, { status: "pending" });
    },
  );
}
export async function discardDraft(id: string, database = db) {
  await database.transaction(
    "rw",
    database.sessions,
    database.photos,
    async () => {
      const s = await database.sessions.get(id);
      if (s?.status !== "draft")
        throw new Error("Solo se pueden descartar borradores.");
      await database.photos.where("sessionId").equals(id).delete();
      await database.sessions.delete(id);
    },
  );
}
export function storageError(e: unknown) {
  return e instanceof Error && /quota/i.test(e.name + " " + e.message)
    ? "No queda espacio en el navegador. Exportá un respaldo y liberá espacio antes de reintentar. Las fotos de esta captura siguen en memoria mientras no cierres la página."
    : e instanceof Error
      ? e.message
      : "No se pudo guardar. Reintentá sin cerrar esta página.";
}
