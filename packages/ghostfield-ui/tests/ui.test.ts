import { describe, expect, it } from "vitest";
import { importSketch, ramp, SketchError } from "../src";

type Fixture = { img: ImageData; walls: [number, number][] };

/** White page (bg gray fn of x), with a pen rectangle outline 3 px wide, optionally rotated by `deg`. */
function page(w: number, h: number, bg: (x: number) => number, deg = 0): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  const a = (deg * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Rotate back into the un-rotated frame; rectangle is 200 x 120 centred.
      const dx = (x - cx) * Math.cos(-a) - (y - cy) * Math.sin(-a);
      const dy = (x - cx) * Math.sin(-a) + (y - cy) * Math.cos(-a);
      const edge = Math.max(Math.abs(dx) - 100, Math.abs(dy) - 60);
      const ink = edge > -1.5 && edge < 1.5;
      const v = ink ? bg(x) * 0.3 : bg(x);
      const p = 4 * (y * w + x);
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
  return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
}

const opts = (extra = {}) => ({ maxCols: 100, maxRows: 60, scale: { x1: 50, y1: 100, x2: 250, y2: 100, metres: 5 }, ...extra });
// Rectangle 200 x 120 px centred in a 300 x 200 image: x 50..250, y 40..160. Scale: 200 px = 5 m.

describe("importSketch", () => {
  const cases: [string, ImageData][] = [
    ["clean", page(300, 200, () => 240)],
    ["shadowed", page(300, 200, (x) => 250 - (x / 300) * 130)],
    ["rotated 3 deg", page(300, 200, () => 240, 3)],
  ];
  for (const [name, img] of cases) {
    it(`finds the walls of the ${name} sketch and not the paper`, () => {
      const r = importSketch(img, opts());
      const at = (x: number, y: number) => r.solid[Math.floor((y / 200) * r.rows) * r.cols + Math.floor((x / 300) * r.cols)];
      expect(at(150, 40)).toBe(1); // top wall
      expect(at(50, 100)).toBe(1); // left wall
      expect(at(150, 100)).toBe(0); // inside the room
      expect(at(10, 10)).toBe(0); // paper outside
      const frac = r.solid.reduce((s, v) => s + v, 0) / r.solid.length;
      expect(frac).toBeLessThan(0.2);
    });
  }

  it("scale: 200 px = 5 m gives metres per cell", () => {
    const r = importSketch(cases[0]![1], opts());
    expect(r.metresPerCell).toBeCloseTo((300 / r.cols) * (5 / 200), 3);
  });

  it("refuses a room that is too big for the grid, and a too dark picture", () => {
    expect(() => importSketch(cases[0]![1], opts({ cellMetres: 0.04 }))).toThrow(/too big/);
    const dark = page(300, 200, () => 240);
    for (let i = 0; i < dark.data.length; i += 4) if ((i / 4) % 5 < 4) dark.data[i] = dark.data[i + 1] = dark.data[i + 2] = 10;
    expect(() => importSketch(dark, opts())).toThrow(SketchError);
  });
});

describe("ramp", () => {
  it("runs from #05070B to #38F2D6 and clamps", () => {
    expect(ramp(0)).toEqual([5, 7, 11]);
    expect(ramp(1)).toEqual([56, 242, 214]);
    expect(ramp(5)).toEqual([56, 242, 214]);
  });
});
