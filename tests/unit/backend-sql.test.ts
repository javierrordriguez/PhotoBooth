import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
let pg: PGlite;
let userA: string, userB: string, deviceA: string, eventId: string;
const files = () =>
  [0, 1, 2, 3, 4].map((position) => ({
    position,
    type: position === 0 ? "strip" : "original",
    size: 100,
    sha256: "a".repeat(64),
    width: position === 0 ? 1200 : 1920,
    height: position === 0 ? 3600 : 1080,
  }));
async function rpc(
  user: string,
  action: string,
  id: string | null = null,
  manifest: unknown = null,
  position: number | null = null,
) {
  const r = await pg.query<{ result: Record<string, unknown> }>(
    "select public.booth_command($1,$2,$3,$4,$5) as result",
    [user, action, id, manifest ? JSON.stringify(manifest) : null, position],
  );
  return r.rows[0]!.result;
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select on storage.objects to authenticated,anon;`,
  );
  await pg.exec(
    await readFile("supabase/migrations/202610140001_booth.sql", "utf8"),
  );
  await pg.exec(
    await readFile(
      "supabase/migrations/202610140002_guest_gallery.sql",
      "utf8",
    ),
  );
}, 60000);
beforeEach(async () => {
  await pg.exec(
    "reset role;truncate public.photos,public.photo_sessions,public.event_admins,public.devices,public.events,auth.users cascade;",
  );
  await pg.exec(
    "update public.guest_rate_limit set requests=0,window_start=now()",
  );
  userA = crypto.randomUUID();
  userB = crypto.randomUUID();
  deviceA = crypto.randomUUID();
  eventId = crypto.randomUUID();
  await pg.query("insert into auth.users values ($1),($2)", [userA, userB]);
  await pg.query(
    "insert into public.events(id,name,event_date) values($1,'Test','2026-12-12')",
    [eventId],
  );
  await pg.query(
    "insert into public.devices(id,event_id,auth_user_id,name,enabled) values($1,$2,$3,'A',true),($4,$2,$5,'B',true)",
    [deviceA, eventId, userA, crypto.randomUUID(), userB],
  );
});
afterAll(async () => {
  await pg?.close();
});
it("permite al rol de servidor ejecutar la RPC sin privilegios de propietario", async () => {
  await pg.exec("set role service_role");
  expect((await rpc(userA, "context")).deviceId).toBe(deviceA);
  expect((await rpc(userA, "init", crypto.randomUUID(), files())).status).toBe(
    "pending",
  );
});
it("aplica la migración, bucket privado y cinco posiciones inmutables", async () => {
  const bucket = await pg.query<{ public: boolean }>(
    "select public from storage.buckets",
  );
  expect(bucket.rows[0]?.public).toBe(false);
  const id = crypto.randomUUID();
  await rpc(userA, "init", id, files());
  await rpc(userA, "init", id, files());
  expect(
    (await pg.query<{ n: number }>("select count(*)::int n from public.photos"))
      .rows[0]?.n,
  ).toBe(5);
  await expect(
    rpc(
      userA,
      "init",
      id,
      files().map((p) => ({ ...p, size: 101 })),
    ),
  ).rejects.toThrow("manifest_conflict");
  await expect(rpc(userA, "finalize", id)).rejects.toThrow(
    "incomplete_session",
  );
});
it("rechaza cantidades incorrectas y posiciones repetidas sin dejar sesión parcial", async () => {
  const id = crypto.randomUUID();
  await expect(rpc(userA, "init", id, files().slice(0, 4))).rejects.toThrow();
  const duplicate = files();
  duplicate[4] = duplicate[3]!;
  await expect(rpc(userA, "init", id, duplicate)).rejects.toThrow();
  expect(
    (
      await pg.query<{ n: number }>(
        "select count(*)::int n from public.photo_sessions",
      )
    ).rows[0]?.n,
  ).toBe(0);
});
it("no permite a un dispositivo consultar ni alterar sesiones de otro", async () => {
  const id = crypto.randomUUID();
  await rpc(userA, "init", id, files());
  await expect(rpc(userB, "status", id)).rejects.toThrow("session_forbidden");
  await expect(rpc(userB, "slot", id, null, 1)).rejects.toThrow(
    "session_forbidden",
  );
  await expect(rpc(userB, "init", id, files())).rejects.toThrow(
    "session_forbidden",
  );
});
it("bloquea dispositivos deshabilitados incluso con identidad Auth válida", async () => {
  await pg.query("update public.devices set enabled=false where id=$1", [
    deviceA,
  ]);
  await expect(rpc(userA, "context")).rejects.toThrow("device_forbidden");
});
it("completa solo después de cinco confirmaciones y no permite volver atrás", async () => {
  const id = crypto.randomUUID();
  await rpc(userA, "init", id, files());
  for (let p = 0; p < 5; p++) {
    await rpc(userA, "slot", id, null, p);
    await rpc(userA, "ack", id, null, p);
  }
  expect((await rpc(userA, "finalize", id)).status).toBe("ready");
  expect((await rpc(userA, "finalize", id)).status).toBe("ready");
  await expect(
    pg.query(
      "update public.photo_sessions set status='uploading' where id=$1",
      [id],
    ),
  ).rejects.toThrow("invalid_transition");
});
it("revocación y vencimiento bloquean operaciones", async () => {
  const id = crypto.randomUUID();
  await rpc(userA, "init", id, files());
  await pg.query(
    "update public.photo_sessions set revoked_at=now() where id=$1",
    [id],
  );
  await expect(rpc(userA, "status", id)).rejects.toThrow("session_inactive");
  await pg.query(
    "update public.photo_sessions set revoked_at=null,created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",
    [id],
  );
  await expect(rpc(userA, "status", id)).rejects.toThrow("session_inactive");
});
it("limita solicitudes y sesiones del dispositivo", async () => {
  await pg.query(
    "update public.devices set request_count=120,request_window=now() where id=$1",
    [deviceA],
  );
  await expect(rpc(userA, "context")).rejects.toThrow("rate_limited");
  await pg.query(
    "update public.devices set request_count=0,max_sessions=1 where id=$1",
    [deviceA],
  );
  await rpc(userA, "init", crypto.randomUUID(), files());
  await expect(
    rpc(userA, "init", crypto.randomUUID(), files()),
  ).rejects.toThrow("session_limit");
});
it("anon y authenticated no acceden a tablas ni RPC privilegiada ni Storage", async () => {
  await pg.exec(
    "insert into storage.objects values(gen_random_uuid(),'booth-photos');create policy broad_test_only on storage.objects for select to authenticated using(true);",
  );
  for (const role of ["anon", "authenticated"]) {
    await pg.exec(`set role ${role}`);
    await expect(pg.query("select * from public.photos")).rejects.toThrow(
      "permission denied",
    );
    await expect(rpc(userA, "context")).rejects.toThrow("permission denied");
    expect((await pg.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
    await pg.exec("reset role");
  }
  await pg.exec("drop policy broad_test_only on storage.objects;");
});
async function guest(hash: string) {
  return (
    await pg.query<{ r: Record<string, unknown> }>(
      "select public.guest_gallery($1) r",
      [hash],
    )
  ).rows[0]!.r;
}
async function link(user: string, id: string, hash: string) {
  return pg.query("select public.booth_link($1,$2,$3)", [user, id, hash]);
}
it("token vinculado idempotente, aislado y no reemplazable por otro hash", async () => {
  const id = crypto.randomUUID();
  await rpc(userA, "init", id, files());
  await expect(link(userB, id, "a".repeat(64))).rejects.toThrow();
  await link(userA, id, "a".repeat(64));
  await link(userA, id, "a".repeat(64));
  await expect(link(userA, id, "b".repeat(64))).rejects.toThrow();
  expect((await guest("a".repeat(64))).state).toBe("preparing");
  expect((await guest("b".repeat(64))).state).toBe("invalid");
});
it("galería entrega exclusivamente cinco archivos listos y bloquea revocación/vencimiento", async () => {
  const id = crypto.randomUUID();
  await rpc(userA, "init", id, files());
  await link(userA, id, "c".repeat(64));
  for (let p = 0; p < 5; p++) {
    await rpc(userA, "slot", id, null, p);
    await rpc(userA, "ack", id, null, p);
  }
  await rpc(userA, "finalize", id);
  const ready = await guest("c".repeat(64));
  expect(ready.state).toBe("ready");
  expect(ready.photos).toHaveLength(5);
  await pg.query(
    "update public.photo_sessions set revoked_at=now() where id=$1",
    [id],
  );
  expect(await guest("c".repeat(64))).toEqual({ state: "revoked" });
  await pg.query(
    "update public.photo_sessions set revoked_at=null,created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",
    [id],
  );
  expect(await guest("c".repeat(64))).toEqual({ state: "expired" });
});
it("limita intentos inválidos y deniega RPC de galería al navegador", async () => {
  await pg.exec("update public.guest_rate_limit set requests=600");
  expect(await guest("d".repeat(64))).toEqual({ state: "limited" });
  await pg.exec("set role anon");
  await expect(guest("d".repeat(64))).rejects.toThrow();
  await pg.exec("reset role;set role authenticated");
  await expect(
    link(userA, crypto.randomUUID(), "e".repeat(64)),
  ).rejects.toThrow();
});
