import { createClient } from "@supabase/supabase-js";
import { guestHandler, type GuestRecord } from "../_shared/guest.ts";
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error("Missing server configuration");
  return value;
};
const service = createClient(
  required("SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const allowedOrigins = required("ALLOWED_ORIGINS")
  .split(",")
  .map((x) => x.trim());
if (allowedOrigins.some((x) => new URL(x).origin !== x || x === "*"))
  throw new Error("Invalid origins");
Deno.serve(
  guestHandler(
    {
      async lookup(hash) {
        const { data, error } = await service.rpc("guest_gallery", {
          p_hash: hash,
        });
        if (error) throw new Error("Lookup failed");
        return data as GuestRecord;
      },
      async sign(path, seconds) {
        const { data, error } = await service.storage
          .from("booth-photos")
          .createSignedUrl(path, seconds);
        if (error || !data) throw new Error("Signing failed");
        return data.signedUrl;
      },
    },
    allowedOrigins,
  ),
);
