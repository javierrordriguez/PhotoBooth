export const MAX_BYTES = 12 * 1024 * 1024;
export const MAX_PIXELS = 12_000_000;
export interface ManifestItem {
  position: number;
  type: "original" | "strip";
  size: number;
  sha256: string;
  width: number;
  height: number;
}
export interface DeviceContext {
  deviceId: string;
  eventId: string;
  deviceName: string;
  eventName: string;
  eventDate: string;
  settings: Record<string, unknown>;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApiError(400, "invalid_id");
  return value;
}
export function manifest(value: unknown): ManifestItem[] {
  if (!Array.isArray(value) || value.length !== 5)
    throw new ApiError(400, "invalid_manifest");
  const items = value
    .map((p: Record<string, unknown>) => {
      if (
        !p ||
        typeof p !== "object" ||
        !Number.isInteger(p.position) ||
        Number(p.position) < 0 ||
        Number(p.position) > 4 ||
        p.type !== (p.position === 0 ? "strip" : "original") ||
        !Number.isInteger(p.size) ||
        Number(p.size) < 1 ||
        Number(p.size) > MAX_BYTES ||
        typeof p.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(p.sha256) ||
        !Number.isInteger(p.width) ||
        !Number.isInteger(p.height) ||
        Number(p.width) < 1 ||
        Number(p.height) < 1 ||
        Number(p.width) > 8192 ||
        Number(p.height) > 8192 ||
        Number(p.width) * Number(p.height) > MAX_PIXELS ||
        (p.position === 0 && (p.width !== 1200 || p.height !== 3600))
      )
        throw new ApiError(422, "invalid_manifest");
      return {
        position: Number(p.position),
        type: p.type,
        size: Number(p.size),
        sha256: p.sha256,
        width: Number(p.width),
        height: Number(p.height),
      } as ManifestItem;
    })
    .sort((a, b) => a.position - b.position);
  if (new Set(items.map((x) => x.position)).size !== 5)
    throw new ApiError(422, "invalid_manifest");
  return items;
}
export async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new ApiError(413, "file_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "empty_body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new ApiError(413, "file_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
