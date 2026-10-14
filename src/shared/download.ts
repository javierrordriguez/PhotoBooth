import { zip, strToU8 } from "fflate";
import type { Photo, Session } from "../sessions/model";
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function photoName(p: Photo) {
  return p.type === "strip" ? "tira.jpg" : `foto-${p.position}.jpg`;
}
export async function backup(sessions: Session[], photos: Photo[]) {
  const files: Record<string, Uint8Array> = {};
  for (const s of sessions) {
    files[`${s.id}/sesion.json`] = strToU8(
      JSON.stringify({ ...s, backupVersion: 1 }, null, 2),
    );
    for (const p of photos.filter((p) => p.sessionId === s.id))
      files[`${s.id}/${photoName(p)}`] = new Uint8Array(
        await p.blob.arrayBuffer(),
      );
  }
  return new Promise<Blob>((resolve, reject) =>
    zip(files, { level: 0 }, (e, data) =>
      e
        ? reject(e)
        : resolve(
            new Blob([new Uint8Array(data)], { type: "application/zip" }),
          ),
    ),
  );
}
