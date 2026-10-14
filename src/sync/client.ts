import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ApiError,
  type DeviceContext,
  type ManifestItem,
} from "../../supabase/functions/_shared/protocol";
import type { Binding } from "./types";
export interface SyncApi {
  context(): Promise<DeviceContext>;
  init(
    binding: Binding,
    id: string,
    manifest: ManifestItem[],
  ): Promise<RemoteReply>;
  upload(
    binding: Binding,
    id: string,
    position: number,
    blob: Blob,
  ): Promise<RemoteReply>;
  finalize(binding: Binding, id: string): Promise<RemoteReply>;
  link(binding: Binding, id: string, hash: string): Promise<unknown>;
}
export interface RemoteReply {
  status: string;
  uploaded: number[];
}
export function publicConfig(url: unknown, key: unknown) {
  if (!url && !key) return null;
  if (
    typeof url !== "string" ||
    typeof key !== "string" ||
    !key.startsWith("sb_publishable_")
  )
    throw new Error(
      "Configurá URL y clave pública sb_publishable_ de Supabase. Nunca uses una clave secreta.",
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
  )
    throw new Error("Supabase necesita HTTPS (o localhost para pruebas).");
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error("Usá la URL base de Supabase.");
  return { url: parsed.origin, key };
}
let config: ReturnType<typeof publicConfig> = null;
let configError = "";
try {
  config = publicConfig(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
} catch (e) {
  configError = e instanceof Error ? e.message : "Configuración inválida.";
}
export { configError };
export const projectUrl = config?.url ?? "";
export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "tami-device-auth",
      },
    })
  : null;
async function call(
  action: string,
  binding?: Binding,
  id?: string,
  body?: BodyInit,
  position?: number,
): Promise<unknown> {
  if (!supabase || !config) throw new ApiError(401, "not_configured");
  if (binding && binding.projectUrl !== config.url)
    throw new ApiError(403, "project_mismatch");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session)
    throw new ApiError(401, "authentication_required");
  const params = new URLSearchParams({ action });
  if (id) params.set("id", id);
  if (position !== undefined) params.set("position", String(position));
  const headers: Record<string, string> = {
    apikey: config.key,
    Authorization: `Bearer ${data.session.access_token}`,
    "Content-Type": action === "upload" ? "image/jpeg" : "application/json",
  };
  if (binding) {
    headers["x-device-id"] = binding.deviceId;
    headers["x-event-id"] = binding.eventId;
  }
  const response = await fetch(
    `${config.url}/functions/v1/device-api?${params}`,
    {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(60000),
    },
  );
  const value = await response
    .json()
    .catch(() => ({ error: "invalid_response" }));
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof value.error === "string" ? value.error : "server_error",
    );
  return value;
}
export const syncApi: SyncApi = {
  link: (binding, id, hash) =>
    call("link", binding, id, JSON.stringify({ hash })),
  context: () => call("context") as Promise<DeviceContext>,
  init: (binding, id, manifest) =>
    call("init", binding, id, JSON.stringify(manifest)) as Promise<RemoteReply>,
  upload: (binding, id, position, blob) =>
    call("upload", binding, id, blob, position) as Promise<RemoteReply>,
  finalize: (binding, id) =>
    call("finalize", binding, id) as Promise<RemoteReply>,
};
