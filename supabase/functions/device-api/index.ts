import { createClient } from "@supabase/supabase-js";
import { createHandler, type Backend } from "../_shared/handler.ts";
import { ApiError } from "../_shared/protocol.ts";
// This file is deployed only to Supabase; never imported by the frontend.
const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
};
const client = createClient(
  env("SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const origins = env("ALLOWED_ORIGINS")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
if (origins.some((x) => new URL(x).origin !== x || x === "*"))
  throw new Error("Invalid ALLOWED_ORIGINS");
const backend: Backend = {
  async authenticate(jwt) {
    const { data, error } = await client.auth.getUser(jwt);
    if (error || !data.user || data.user.is_anonymous)
      throw new ApiError(401, "authentication_required");
    return data.user.id;
  },
  async command(user, action, id, body, position) {
    if (action === "link") {
      const { data, error } = await client.rpc("booth_link", {
        p_user: user,
        p_session: id,
        p_hash: body,
      });
      if (error)
        throw new ApiError(
          error.code === "42501"
            ? 403
            : /token_conflict/.test(error.message)
              ? 409
              : /rate_limited/.test(error.message)
                ? 429
                : 503,
          "link_unavailable",
        );
      return data;
    }
    const { data, error } = await client.rpc("booth_command", {
      p_user: user,
      p_action: action,
      p_session: id ?? null,
      p_manifest: body ?? null,
      p_position: position ?? null,
    });
    if (error) {
      const message = error.message;
      if (/rate_limited/.test(message)) throw new ApiError(429, "rate_limited");
      if (/session_limit/.test(message))
        throw new ApiError(409, "session_limit");
      if (error.code === "42501")
        throw new ApiError(403, "operation_forbidden");
      if (
        /manifest_conflict|incomplete_session|invalid_transition/.test(message)
      )
        throw new ApiError(409, "session_conflict");
      throw new ApiError(503, "temporarily_unavailable");
    }
    return data;
  },
  async upload(path, bytes) {
    const { error } = await client.storage
      .from("booth-photos")
      .upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: false,
        cacheControl: "0",
      });
    if (error) throw new ApiError(503, "storage_unavailable");
  },
  async download(path) {
    const { data, error } = await client.storage
      .from("booth-photos")
      .download(path);
    if (error || !data) throw new ApiError(503, "storage_unavailable");
    return new Uint8Array(await data.arrayBuffer());
  },
};
Deno.serve(createHandler(backend, origins));
