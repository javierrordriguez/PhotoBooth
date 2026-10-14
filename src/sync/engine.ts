import { db, type BoothDB } from "../persistence/db";
import { assertOriginals } from "../sessions/model";
import {
  ApiError,
  manifest,
  sha256,
} from "../../supabase/functions/_shared/protocol";
import type { SyncApi } from "./client";
import type { Binding, SyncJob } from "./types";
import { registerLink } from "../gallery/links";
export const retryDelay = (attempts: number) =>
  Math.min(300000, 5000 * 2 ** Math.min(attempts - 1, 6));
export async function enqueue(database: BoothDB = db) {
  await database.transaction(
    "rw",
    database.sessions,
    database.syncJobs,
    async () => {
      const sessions = await database.sessions
        .where("status")
        .equals("pending")
        .toArray();
      for (const s of sessions)
        if (s.binding && !(await database.syncJobs.get(s.id)))
          await database.syncJobs.add({
            sessionId: s.id,
            binding: s.binding,
            state: "pending",
            attempts: 0,
            nextAttempt: 0,
            uploaded: [],
            updatedAt: new Date().toISOString(),
          });
    },
  );
}
export async function adoptLocal(binding: Binding, database = db) {
  await database.transaction("rw", database.sessions, async () => {
    const sessions = await database.sessions
      .where("status")
      .equals("pending")
      .toArray();
    for (const s of sessions)
      if (!s.binding) await database.sessions.update(s.id, { binding });
  });
  await enqueue(database);
}
export async function runJob(
  job: SyncJob,
  api: SyncApi,
  database: BoothDB = db,
  now = Date.now(),
) {
  await database.syncJobs.update(job.sessionId, {
    state: "syncing",
    attempts: job.attempts + 1,
    error: undefined,
    updatedAt: new Date(now).toISOString(),
  });
  try {
    const context = await api.context();
    if (
      context.deviceId !== job.binding.deviceId ||
      context.eventId !== job.binding.eventId
    )
      throw new ApiError(403, "binding_mismatch");
    const s = await database.sessions.get(job.sessionId);
    if (!s || s.status !== "pending")
      throw new ApiError(422, "local_session_incomplete");
    const photos = await database.photos
      .where("sessionId")
      .equals(s.id)
      .sortBy("position");
    assertOriginals(
      photos.filter((p) => p.type === "original"),
      s.id,
    );
    if (photos.length !== 5 || photos[0]?.type !== "strip")
      throw new ApiError(422, "local_session_incomplete");
    const computed = manifest(
      await Promise.all(
        photos.map(async (p) => ({
          position: p.position,
          type: p.type,
          size: p.blob.size,
          width: p.width,
          height: p.height,
          sha256: await sha256(new Uint8Array(await p.blob.arrayBuffer())),
        })),
      ),
    );
    if (
      job.manifest &&
      JSON.stringify(computed) !== JSON.stringify(job.manifest)
    )
      throw new ApiError(409, "local_content_changed");
    await database.syncJobs.update(s.id, { manifest: computed });
    const remote = await api.init(job.binding, s.id, computed);
    await registerLink(s.id, job.binding, api, database);
    for (const photo of photos) {
      if (remote.uploaded.includes(photo.position)) continue;
      const result = await api.upload(
        job.binding,
        s.id,
        photo.position,
        photo.blob,
      );
      await database.syncJobs.update(s.id, { uploaded: result.uploaded });
    }
    const final = await api.finalize(job.binding, s.id);
    if (final.status !== "ready" || new Set(final.uploaded).size !== 5)
      throw new ApiError(503, "remote_not_ready");
    await database.syncJobs.update(s.id, {
      state: "synced",
      uploaded: final.uploaded,
      error: undefined,
      nextAttempt: 0,
      updatedAt: new Date().toISOString(),
    });
    // Deliberately retain all five local files after remote confirmation.
  } catch (e) {
    const blocked =
      e instanceof ApiError &&
      [400, 401, 403, 409, 413, 415, 422].includes(e.status);
    await database.syncJobs.update(job.sessionId, {
      state: blocked ? "blocked" : "retry",
      error: e instanceof ApiError ? e.code : "network_or_storage_error",
      nextAttempt:
        now +
        Math.max(
          e instanceof ApiError && e.status === 429 ? 60000 : 0,
          retryDelay(job.attempts + 1),
        ),
      updatedAt: new Date().toISOString(),
    });
  }
}
export async function retryJobs(database = db) {
  await database.syncJobs
    .where("state")
    .anyOf("retry", "blocked")
    .modify({ state: "pending", nextAttempt: 0 });
}
export function startSync(api: SyncApi, database = db) {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running || !navigator.onLine || !navigator.locks) return;
    running = true;
    try {
      await navigator.locks.request(
        "tami-sync-v2",
        { ifAvailable: true },
        async (lock) => {
          if (!lock || stopped) return;
          await enqueue(database);
          const jobs = await database.syncJobs.toArray();
          for (const job of jobs) {
            if (stopped) break;
            if (
              job.state === "synced" ||
              job.state === "blocked" ||
              job.nextAttempt > Date.now()
            )
              continue;
            await runJob(job, api, database);
          }
        },
      );
    } catch {
      /* IndexedDB unavailable: UI shows its own durable-storage error. */
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 15000);
  window.addEventListener("online", tick);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("online", tick);
  };
}
