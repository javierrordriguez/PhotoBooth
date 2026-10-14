import type { Binding } from "../sync/types";
export interface Settings {
  name: string;
  date: string;
  interval: number;
  returnAfter: number;
  frame: "rose" | "lavender" | "midnight";
}
export const defaults: Settings = {
  name: "Tami",
  date: "",
  interval: 1,
  returnAfter: 45,
  frame: "lavender",
};
export function validateSettings(s: Settings): Settings {
  if (!s.name.trim() || s.name.trim().length > 40)
    throw new Error("El nombre debe tener entre 1 y 40 caracteres.");
  if (
    s.date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(s.date) ||
      new Date(s.date + "T12:00:00Z").toISOString().slice(0, 10) !== s.date)
  )
    throw new Error("La fecha no es válida.");
  if (!Number.isInteger(s.interval) || s.interval < 0 || s.interval > 15)
    throw new Error("El intervalo debe estar entre 0 y 15 segundos.");
  if (
    !Number.isInteger(s.returnAfter) ||
    s.returnAfter < 15 ||
    s.returnAfter > 300
  )
    throw new Error("El retorno debe estar entre 15 y 300 segundos.");
  if (!["rose", "lavender", "midnight"].includes(s.frame))
    throw new Error("Marco no válido.");
  return { ...s, name: s.name.trim() };
}
export type LocalStatus = "draft" | "pending";
export interface Session {
  id: string;
  createdAt: string;
  status: LocalStatus;
  settings: Settings;
  binding?: Binding;
}
export interface Photo {
  sessionId: string;
  position: number;
  type: "original" | "strip";
  blob: Blob;
  width: number;
  height: number;
}
export type Phase =
  | "welcome"
  | "countdown"
  | "capturing"
  | "review"
  | "saving"
  | "done";
const transitions: Record<Phase, Phase[]> = {
  welcome: ["countdown", "review"],
  countdown: ["capturing", "welcome", "review"],
  capturing: ["countdown", "review", "welcome"],
  review: ["welcome", "saving"],
  saving: ["review", "done"],
  done: ["welcome"],
};
export function transition(from: Phase, to: Phase): Phase {
  if (!transitions[from].includes(to))
    throw new Error(`Transición inválida: ${from} → ${to}`);
  return to;
}
export function assertOriginals(photos: Photo[], id: string) {
  if (
    photos.length !== 4 ||
    photos.some(
      (p) =>
        p.sessionId !== id ||
        p.type !== "original" ||
        !p.blob.size ||
        p.blob.type !== "image/jpeg" ||
        p.width <= 0 ||
        p.height <= 0,
    ) ||
    new Set(photos.map((p) => p.position)).size !== 4 ||
    photos.some(
      (p) => p.position < 1 || p.position > 4 || !Number.isInteger(p.position),
    )
  )
    throw new Error(
      "Se necesitan cuatro originales válidos de la misma sesión.",
    );
}
