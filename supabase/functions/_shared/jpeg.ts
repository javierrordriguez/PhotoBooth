import jpeg from "jpeg-js";
import { ApiError, MAX_BYTES, MAX_PIXELS } from "./protocol.ts";
export function validateJpeg(bytes: Uint8Array, width: number, height: number) {
  if (
    bytes.length < 4 ||
    bytes.length > MAX_BYTES ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes[bytes.length - 2] !== 255 ||
    bytes[bytes.length - 1] !== 217
  )
    throw new ApiError(422, "invalid_jpeg");
  try {
    const decoded = jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: false,
      tolerantDecoding: false,
      maxResolutionInMP: MAX_PIXELS / 1e6,
      // Full strip and 4K originals require >128 MiB with jpeg-js.
      // Keep an explicit ceiling below the Edge isolate memory limit.
      maxMemoryUsageInMB: 192,
    });
    if (decoded.width !== width || decoded.height !== height)
      throw new Error("dimensions");
  } catch {
    throw new ApiError(422, "invalid_jpeg");
  }
}
