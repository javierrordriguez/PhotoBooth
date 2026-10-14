import { it, expect } from "vitest";
import { slots, cover, SIZE } from "../../src/composition/strip";
it("coloca cuatro fotos dentro de la tira sin superposición", () => {
  const boxes = slots();
  expect(boxes).toHaveLength(4);
  for (const [i, b] of boxes.entries()) {
    expect(b.x + b.width).toBeLessThan(SIZE.width);
    expect(b.y + b.height).toBeLessThan(3100);
    if (i) expect(b.y).toBeGreaterThan(boxes[i - 1]!.y + boxes[i - 1]!.height);
  }
});
it("recorta simétricamente sin deformar originales apaisados o verticales", () => {
  for (const [w, h] of [
    [4000, 3000],
    [3000, 4000],
    [1920, 1080],
  ]) {
    const c = cover(w!, h!, 1048, 676);
    expect(c.sw / c.sh).toBeCloseTo(1048 / 676);
    expect(c.sx * 2 + c.sw).toBeCloseTo(w!);
    expect(c.sy * 2 + c.sh).toBeCloseTo(h!);
    expect(c.sx).toBeGreaterThanOrEqual(0);
    expect(c.sy).toBeGreaterThanOrEqual(0);
  }
  expect(() => cover(0, 100, 20, 20)).toThrow();
});
