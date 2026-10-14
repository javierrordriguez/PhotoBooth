import { describe, it, expect } from "vitest";
import {
  transition,
  assertOriginals,
  validateSettings,
  defaults,
  type Photo,
} from "../../src/sessions/model";
const photo = (position: number): Photo => ({
  sessionId: "a",
  position,
  type: "original",
  blob: new Blob(["jpeg"], { type: "image/jpeg" }),
  width: 1920,
  height: 1080,
});
describe("sesiones", () => {
  it("solo permite transiciones explícitas", () => {
    expect(transition("welcome", "countdown")).toBe("countdown");
    expect(transition("review", "saving")).toBe("saving");
    expect(transition("saving", "review")).toBe("review");
    expect(() => transition("welcome", "done")).toThrow();
    expect(() => transition("countdown", "done")).toThrow();
  });
  it("rechaza originales de otra sesión, repetidos o incompletos", () => {
    const p = [1, 2, 3, 4].map(photo);
    expect(() => assertOriginals(p, "a")).not.toThrow();
    expect(() => assertOriginals(p, "b")).toThrow();
    expect(() => assertOriginals([p[0]!, p[0]!, p[2]!, p[3]!], "a")).toThrow();
    expect(() => assertOriginals(p.slice(0, 3), "a")).toThrow();
  });
  it("valida límites, nombre y fechas reales", () => {
    expect(validateSettings(defaults)).toEqual(defaults);
    expect(() =>
      validateSettings({ ...defaults, date: "2026-02-30" }),
    ).toThrow();
    expect(() => validateSettings({ ...defaults, interval: -1 })).toThrow();
    expect(() => validateSettings({ ...defaults, returnAfter: 0 })).toThrow();
    expect(() => validateSettings({ ...defaults, name: " " })).toThrow();
  });
});
