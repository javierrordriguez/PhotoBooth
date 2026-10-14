import {
  ApiError,
  MAX_BYTES,
  boundedBody,
  manifest,
  sha256,
  uuid,
  type DeviceContext,
} from "./protocol.ts";
import { validateJpeg } from "./jpeg.ts";
export interface StoredPhoto {
  position: number;
  storage_path: string;
  sha256: string;
  size_bytes: number;
  width: number;
  height: number;
  uploaded_at: string | null;
}
export interface RemoteState {
  status: "pending" | "uploading" | "failed" | "ready";
  photos: StoredPhoto[];
}
export interface Backend {
  authenticate(jwt: string): Promise<string>;
  command(
    user: string,
    action: string,
    id?: string,
    body?: unknown,
    position?: number,
  ): Promise<unknown>;
  upload(path: string, bytes: Uint8Array): Promise<void>;
  download(path: string): Promise<Uint8Array>;
}
const publicState = (state: RemoteState) => ({
  status: state.status,
  uploaded: state.photos.filter((p) => p.uploaded_at).map((p) => p.position),
});
export function createHandler(backend: Backend, origins: string[]) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const allowed = origin !== null && origins.includes(origin);
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    if (allowed) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] =
        "authorization, apikey, content-type, x-device-id, x-event-id";
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    }
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    try {
      if (origin && !allowed) throw new ApiError(403, "origin_forbidden");
      if (request.method === "OPTIONS") {
        if (!allowed) throw new ApiError(403, "origin_forbidden");
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "POST")
        throw new ApiError(405, "method_not_allowed");
      const bearer = request.headers
        .get("authorization")
        ?.match(/^Bearer ([^\s]+)$/i)?.[1];
      if (!bearer) throw new ApiError(401, "authentication_required");
      const user = await backend.authenticate(bearer);
      const context = (await backend.command(user, "context")) as DeviceContext;
      const url = new URL(request.url);
      const action = url.searchParams.get("action");
      if (action === "context") return json(context);
      if (
        request.headers.get("x-device-id") !== context.deviceId ||
        request.headers.get("x-event-id") !== context.eventId
      )
        throw new ApiError(403, "binding_mismatch");
      const id = uuid(url.searchParams.get("id"));
      if (action === "link") {
        const body = JSON.parse(
          new TextDecoder().decode(await boundedBody(request, 128)),
        ) as { hash?: unknown };
        if (typeof body.hash !== "string" || !/^[a-f0-9]{64}$/.test(body.hash))
          throw new ApiError(400, "invalid_hash");
        return json(await backend.command(user, "link", id, body.hash));
      }
      if (action === "init") {
        const bytes = await boundedBody(request, 16384);
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new ApiError(400, "invalid_json");
        }
        const items = manifest(parsed);
        return json(
          publicState(
            (await backend.command(user, "init", id, items)) as RemoteState,
          ),
        );
      }
      if (action === "status")
        return json(
          publicState(
            (await backend.command(user, "status", id)) as RemoteState,
          ),
        );
      if (action === "upload") {
        const pos = url.searchParams.get("position");
        if (pos === null || !/^[0-4]$/.test(pos))
          throw new ApiError(400, "invalid_position");
        const slot = (await backend.command(
          user,
          "slot",
          id,
          undefined,
          Number(pos),
        )) as StoredPhoto;
        if (request.headers.get("content-type") !== "image/jpeg")
          throw new ApiError(415, "invalid_mime");
        const bytes = await boundedBody(request, MAX_BYTES);
        if (
          bytes.length !== slot.size_bytes ||
          (await sha256(bytes)) !== slot.sha256
        )
          throw new ApiError(409, "content_mismatch");
        validateJpeg(bytes, slot.width, slot.height);
        try {
          try {
            await backend.upload(slot.storage_path, bytes);
          } catch {
            // Lost upload response or duplicate: accept only the identical persisted object.
            const existing = await backend.download(slot.storage_path);
            if (
              existing.length !== slot.size_bytes ||
              (await sha256(existing)) !== slot.sha256
            )
              throw new ApiError(409, "storage_conflict");
          }
          return json(
            publicState(
              (await backend.command(
                user,
                "ack",
                id,
                undefined,
                Number(pos),
              )) as RemoteState,
            ),
          );
        } catch (e) {
          try {
            await backend.command(user, "failed", id);
          } catch {
            /* never log credentials or payloads */
          }
          throw e;
        }
      }
      if (action === "finalize") {
        const state = (await backend.command(
          user,
          "status",
          id,
        )) as RemoteState;
        if (
          state.photos.length !== 5 ||
          state.photos.some((p) => !p.uploaded_at)
        )
          throw new ApiError(409, "incomplete_session");
        for (const p of state.photos) {
          const bytes = await backend.download(p.storage_path);
          if (
            bytes.length !== p.size_bytes ||
            (await sha256(bytes)) !== p.sha256
          )
            throw new ApiError(409, "storage_conflict");
        }
        return json(
          publicState(
            (await backend.command(user, "finalize", id)) as RemoteState,
          ),
        );
      }
      throw new ApiError(400, "invalid_action");
    } catch (e) {
      const error =
        e instanceof ApiError
          ? e
          : new ApiError(503, "temporarily_unavailable");
      if (error.status === 429) headers["Retry-After"] = "60";
      return json({ error: error.code }, error.status);
    }
  };
}
