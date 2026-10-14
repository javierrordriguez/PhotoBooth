import { db, type BoothDB } from "../persistence/db";
import type { Binding } from "../sync/types";
import type { SyncApi } from "../sync/client";
import {
  newGuestToken,
  tokenHash,
} from "../../supabase/functions/_shared/guest";
export async function registerLink(
  id: string,
  binding: Binding,
  api: SyncApi,
  database: BoothDB = db,
) {
  const link = await database.transaction(
    "rw",
    database.guestLinks,
    async () => {
      const old = await database.guestLinks.get(id);
      if (old) return old;
      const value = {
        sessionId: id,
        token: newGuestToken(),
        registered: false,
      };
      await database.guestLinks.add(value);
      return value;
    },
  );
  if (!link.registered) {
    await api.link(binding, id, await tokenHash(link.token));
    await database.guestLinks.update(id, { registered: true });
  }
  return link.token;
}
export function galleryOrigin(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
