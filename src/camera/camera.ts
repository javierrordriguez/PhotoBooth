import { jpeg } from "../composition/strip";
import type { Photo } from "../sessions/model";
export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}
export async function openCamera(deviceId?: string) {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "La cámara necesita HTTPS o localhost y un navegador compatible.",
    );
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      ...(deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: "user" }),
    },
  });
}
export async function capture(
  video: HTMLVideoElement,
  sessionId: string,
  position: number,
): Promise<Photo> {
  if (video.readyState < 2 || !video.videoWidth)
    throw new Error("La cámara todavía no está lista.");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo capturar.");
    ctx.drawImage(video, 0, 0);
    return {
      sessionId,
      position,
      type: "original",
      width: canvas.width,
      height: canvas.height,
      blob: await jpeg(canvas),
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelado", "AbortError"));
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelado", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
export function cameraError(e: unknown) {
  const name = e instanceof Error ? e.name : "";
  return name === "NotAllowedError"
    ? "Permití el acceso a la cámara en el navegador y volvé a intentar."
    : name === "NotFoundError"
      ? "No encontramos una cámara conectada."
      : name === "NotReadableError"
        ? "La cámara está ocupada. Cerrá otras aplicaciones que la estén usando."
        : e instanceof Error
          ? e.message
          : "No se pudo iniciar la cámara.";
}
