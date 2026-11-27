import { describe, expect, it } from "vitest";
import { runCpuJob } from "@core/runtime/cpuJob";
import { FREQ_5_HZ, FREQ_HZ, WALL_MATERIALS, ituEpsSigma, materialFor, type WallMaterialId } from "../src/materials";
import { BANDS, buildJob, cellsPerWavelength, gridFor, resampleImported, type ImportedWalls, type Band, type Scene } from "../src/scene";
import { C0 } from "../src/materials";
import { findDeadZones } from "../src/heatmap";

describe("5 GHz materials", () => {
  it("every ITU row is valid at 5.5 GHz and at 2.4 GHz", () => {
    for (const w of WALL_MATERIALS) {
      expect(FREQ_5_HZ / 1e9).toBeGreaterThanOrEqual(w.itu.range[0]);
      expect(FREQ_5_HZ / 1e9).toBeLessThanOrEqual(w.itu.range[1]);
      expect(FREQ_HZ / 1e9).toBeGreaterThanOrEqual(w.itu.range[0]);
      expect(FREQ_HZ / 1e9).toBeLessThanOrEqual(w.itu.range[1]);
    }
  });

  it("material values at 5.5 GHz follow epsr = a f^b, sigma = c f^d", () => {
    const f = FREQ_5_HZ / 1e9;
    // Hand-computed from Table 3: brick sigma = 0.0238 * 5.5^0.16, concrete sigma = 0.0462 * 5.5^0.7822.
    expect(ituEpsSigma(WALL_MATERIALS.find((w) => w.id === "brick")!.itu, f).sigma).toBeCloseTo(0.0238 * 5.5 ** 0.16, 6);
    expect(ituEpsSigma(WALL_MATERIALS.find((w) => w.id === "concrete")!.itu, f).sigma).toBeCloseTo(0.0462 * 5.5 ** 0.7822, 6);
    for (const w of WALL_MATERIALS) {
      const { epsr, sigma } = ituEpsSigma(w.itu, f);
      expect(epsr).toBeCloseTo(w.itu.a * f ** w.itu.b, 9);
      const m = materialFor(w.id, FREQ_5_HZ);
      expect(m.gammaU).toBeCloseTo(sigma / m.C, -2);
    }
    // Brick sigma at 5.5 GHz is about 0.0313 S/m, higher than 0.0274 at 2.4 GHz.
    expect(materialFor("brick", FREQ_5_HZ).gammaU).toBeGreaterThan(materialFor("brick", FREQ_HZ).gammaU);
  });

  it("the 5 GHz cell gives at least 12 cells per wavelength; so does 2.4 GHz", () => {
    expect(cellsPerWavelength("5")).toBeGreaterThanOrEqual(12);
    expect(cellsPerWavelength("2.4")).toBeGreaterThanOrEqual(12);
    expect(BANDS["5"].cellM).toBeLessThan(BANDS["2.4"].cellM);
    expect(C0 / FREQ_5_HZ / BANDS["5"].cellM).toBeGreaterThanOrEqual(12);
  });
});

describe("5 GHz grid", () => {
  it("on the GPU 5 GHz keeps the 7.68 m room; the CPU keeps the grid", () => {
    const n = gridFor("webgpu", 768, "5");
    expect(Math.abs(n * BANDS["5"].cellM - 7.68)).toBeLessThan(0.05);
    expect(n).toBeLessThan(2048);
    expect(gridFor("webgpu", 768, "2.4")).toBe(768);
    expect(gridFor("cpu", 384, "5")).toBe(384);
  });
});

describe("5 GHz is blocked more than 2.4 GHz", () => {
  // Same geometry in cells for both bands (so the same cost); the room is smaller at 5 GHz.
  const N = 320;
  function drop(band: Band, material: WallMaterialId): number {
    const s = BANDS[band].cellM / 0.01; // metres per 1.0 cm-grid metre
    const m = (v: number) => v * s;
    const run = (wall: boolean) => {
      const scene: Scene = { router: { x: m(0.8), y: m(1.6) }, walls: wall ? [{ x1: m(1.6), y1: m(0.8), x2: m(1.6), y2: m(2.4), material }] : [] };
      const b = buildJob(scene, N, { band });
      const r = runCpuJob(b.job)!;
      let sum = 0;
      let c = 0;
      for (let j = Math.floor(m(1.4) / b.dx); j < Math.ceil(m(1.8) / b.dx); j++)
        for (let i = Math.floor(m(2.0) / b.dx); i < Math.ceil(m(2.4) / b.dx); i++) {
          sum += r.power[j * N + i]!;
          c++;
        }
      return sum / c;
    };
    return 10 * Math.log10(run(true) / run(false));
  }
  it("concrete and brick cut the signal more at 5 GHz", () => {
    for (const id of ["concrete", "brick"] as const) {
      const lo = drop("2.4", id);
      const hi = drop("5", id);
      console.log(`${id}: 2.4 GHz ${lo.toFixed(2)} dB, 5 GHz ${hi.toFixed(2)} dB`);
      expect(hi).toBeLessThan(lo);
    }
  }, 300000);
});
describe("imported floor plan on a band switch", () => {
  // A 100 x 60 cell plan (1.0 m x 0.6 m at 1 cm) with a wall column at x = 50 and a full top row.
  const cols = 100;
  const rows = 60;
  const mask = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) mask[j * cols + 50] = 1;
  for (let i = 0; i < cols; i++) mask[i] = 1;
  const orig: ImportedWalls = { mask, cols, rows };
  const metres = (m: ImportedWalls, cell: number) => ({ w: m.cols * cell, h: m.rows * cell });

  it("GPU: same room size, so the walls cover the same metres on the finer grid", () => {
    const five = resampleImported(orig, BANDS["2.4"].cellM, BANDS["5"].cellM, 1, 1704);
    expect(Math.abs(metres(five, BANDS["5"].cellM).w - 1.0)).toBeLessThan(BANDS["5"].cellM);
    expect(Math.abs(metres(five, BANDS["5"].cellM).h - 0.6)).toBeLessThan(BANDS["5"].cellM);
    // the wall column stays at x = 0.5 m
    const col = [...Array(five.cols).keys()].filter((i) => five.mask[five.cols * 30 + i]);
    expect(Math.abs(col[0]! * BANDS["5"].cellM - 0.5)).toBeLessThan(0.01);
    // back to 2.4 GHz from the original gives the same mask
    expect(resampleImported(orig, BANDS["2.4"].cellM, BANDS["2.4"].cellM, 1, 768)).toBe(orig);
  });

  it("CPU: the whole flat shrinks by 0.45, so the same cells cover 0.45x the metres", () => {
    const r = BANDS["5"].cellM / BANDS["2.4"].cellM;
    const five = resampleImported(orig, BANDS["2.4"].cellM, BANDS["5"].cellM, r, 384);
    expect(five.cols).toBe(cols);
    expect(Array.from(five.mask)).toEqual(Array.from(mask));
  });

  it("is clipped to the grid", () => {
    expect(resampleImported(orig, 0.01, 0.0045, 1, 150).cols).toBe(150);
  });
});

describe("5 GHz job shape", () => {
  it("builds a 1704 x 1704 job with 5.5 GHz source and 0.45 cm cells, no solve", () => {
    const b = buildJob({ router: { x: 1, y: 1 }, walls: [{ x1: 2, y1: 1, x2: 2, y2: 3, material: "brick" }] }, 1704, { band: "5" });
    expect(b.n).toBe(1704);
    expect(b.dx).toBe(0.0045);
    expect(b.matIdx.length).toBe(1704 * 1704);
    expect(b.job.sources[0]!.freq).toBe(FREQ_5_HZ);
    expect(b.matIdx.some((v) => v > 0)).toBe(true);
  });
});

describe("dead-zone size limits follow the cell size", () => {
  it("a 25 x 25 cell patch is kept at 1 cm but dropped at 0.45 cm (same 7 cm patch is a speck)", () => {
    const n = 200;
    const db = new Float32Array(n * n).fill(0);
    for (let j = 80; j < 105; j++) for (let i = 80; i < 105; i++) db[j * n + i] = -50;
    expect(findDeadZones(db, n, 0.01).blobs.length).toBe(1);
    expect(findDeadZones(db, n, 0.0045).blobs.length).toBe(0);
  });
});