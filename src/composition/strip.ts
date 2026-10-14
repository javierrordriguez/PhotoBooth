import { assertOriginals, type Photo, type Settings } from "../sessions/model";
export const SIZE = { width: 1200, height: 3600 };
export const palettes = {
  lavender: { paper: "#f0eaf6", ink: "#4d3c67", accent: "#b7a0d4" },
  rose: { paper: "#fff0ec", ink: "#753e51", accent: "#cf8b9c" },
  midnight: { paper: "#272738", ink: "#faf2df", accent: "#c4ad76" },
};
export function slots() {
  return Array.from({ length: 4 }, (_, i) => ({
    x: 76,
    y: 130 + i * 720,
    width: 1048,
    height: 676,
  }));
}
export function cover(sw: number, sh: number, dw: number, dh: number) {
  if (Math.min(sw, sh, dw, dh) <= 0) throw new Error("Dimensiones inválidas");
  const scale = Math.max(dw / sw, dh / sh);
  return {
    sx: (sw - dw / scale) / 2,
    sy: (sh - dh / scale) / 2,
    sw: dw / scale,
    sh: dh / scale,
  };
}
export function jpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("No se pudo generar la imagen.")),
      "image/jpeg",
      0.95,
    ),
  );
}
export async function compose(
  photos: Photo[],
  settings: Settings,
): Promise<Photo> {
  const id = photos[0]?.sessionId ?? "";
  assertOriginals(photos, id);
  const canvas = document.createElement("canvas");
  Object.assign(canvas, SIZE);
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Canvas no disponible.");
  const p = palettes[settings.frame];
  c.fillStyle = p.paper;
  c.fillRect(0, 0, 1200, 3600);
  c.strokeStyle = p.accent;
  c.lineWidth = 3;
  c.strokeRect(30, 30, 1140, 3540);
  const sorted = [...photos].sort((a, b) => a.position - b.position);
  try {
    for (const [i, photo] of sorted.entries()) {
      const bitmap = await createImageBitmap(photo.blob);
      try {
        const slot = slots()[i]!;
        const crop = cover(
          bitmap.width,
          bitmap.height,
          slot.width,
          slot.height,
        );
        c.drawImage(
          bitmap,
          crop.sx,
          crop.sy,
          crop.sw,
          crop.sh,
          slot.x,
          slot.y,
          slot.width,
          slot.height,
        );
      } finally {
        bitmap.close();
      }
    }
    c.fillStyle = p.ink;
    c.textAlign = "center";
    c.font = "italic 138px Georgia";
    c.fillText(settings.name, 600, 3230, 1030);
    c.font = "26px Arial";
    c.fillText("MIS 15 · RECUERDOS PARA SIEMPRE", 600, 3310);
    if (settings.date) {
      c.font = "32px Arial";
      c.fillText(settings.date.split("-").reverse().join(" · "), 600, 3385);
    }
    c.font = "48px Georgia";
    c.fillStyle = p.accent;
    c.fillText("✦", 600, 3480);
    return {
      sessionId: id,
      position: 0,
      type: "strip",
      blob: await jpeg(canvas),
      ...SIZE,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
