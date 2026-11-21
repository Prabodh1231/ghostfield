import { describe, expect, it } from "vitest";
import { runCpuJob } from "@core/runtime/cpuJob";
import { stackLevels } from "../src/audio";
import { C0, FREQS, buildFieldJob, buildRoom, cornerCells, defaultScene, gammaQ, type Scene } from "../src/scene";

describe("scene", () => {
  it("gamma_q = Rf / rho_eff", () => {
    expect(gammaQ(5000)).toBeCloseTo(5000 / 1.2, 6);
    expect(gammaQ(10000)).toBeCloseTo(10000 / 1.2, 6);
  });

  it("foam is 2 cells thick at 2.5 cm; a superchunk is a 60 cm triangle in the nearest corner", () => {
    const s: Scene = { ...defaultScene(), traps: [{ type: "foam", x1: 1, y1: 2, x2: 2, y2: 2 }] };
    const r = buildRoom(s, 0.025);
    const rows = new Set<number>();
    for (let i = 0; i < r.rf.length; i++) if (r.rf[i]) rows.add(Math.floor(i / r.nx));
    expect(rows.size).toBe(2);
    const c = buildRoom({ ...defaultScene(), traps: [{ type: "chunk", x1: 0.1, y1: 0.1, x2: 0.1, y2: 0.1 }] }, 0.025);
    let n = 0;
    for (let i = 0; i < c.rf.length; i++) if (c.rf[i] === 10000) n++;
    expect(n).toBe((24 * 25) / 2);
    expect(c.rf[0]).toBe(10000); // corner cell
  });

  it("a rectangle has 4 concave corners, an L-shape 5", () => {
    const r = buildRoom(defaultScene(), 0.05);
    expect(cornerCells(r.nx, r.ny, r.solid)).toHaveLength(4);
    const l = buildRoom({ ...defaultScene(), shape: "L" }, 0.05);
    expect(cornerCells(l.nx, l.ny, l.solid)).toHaveLength(5);
  });

  it("map at the (1,0) mode: boom at the walls, null on the middle line (CPU grid, 5 cm)", () => {
    const s: Scene = { ...defaultScene(), w: 5, h: 4, sub: { x: 0.3, y: 0.3 } };
    const f10 = C0 / (2 * 5);
    const { room, job } = buildFieldJob(s, 0.05, f10);
    const p = runCpuJob(job)!.power;
    const at = (x: number, y: number) => p[Math.floor(y / 0.05) * room.nx + Math.floor(x / 0.05)]!;
    const wall = at(0.1, 2) + at(4.9, 2);
    const mid = 2 * at(2.5, 2);
    console.log(`(1,0) map: wall power / middle power = ${(wall / mid).toFixed(1)}`);
    expect(wall).toBeGreaterThan(10 * mid);
  }, 120000);

  it("laptop stack: a boom is louder than a null, total level stays <= 1", () => {
    const db = FREQS.map((f) => (Math.abs(f - 100) < 3 ? 10 : Math.abs(f - 200) < 3 ? -20 : 0));
    const sum = (f: number) => stackLevels(FREQS, db, f).reduce((a, b) => a + b, 0);
    expect(sum(100)).toBeGreaterThan(sum(150));
    expect(sum(150)).toBeGreaterThan(sum(200));
    expect(sum(100)).toBeLessThanOrEqual(1);
  });
});
