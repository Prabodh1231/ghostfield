import { describe, expect, it } from "vitest";
import { runCpuJob } from "@core/runtime/cpuJob";
import { toMaterial, materialFor, type WallMaterialId } from "../src/materials";
import { WALL_ORDER, buildJob, type Scene } from "../src/scene";

/**
 * Headless shadow check (CPU solver, small room). One 1.6 m wall between the router and a
 * probe box; the same scene without the wall is the reference.
 * Shadow (dB) = 10 log10( mean |Ez|^2 in the box with the wall / mean |Ez|^2 in the box without it ).
 * Room 3.2 m on 320x320 cells (1.0 cm), 16-cell CPML. Run: pnpm --filter wifi-deadzone exec vitest run tests/shadow.test.ts
 */
const N = 320; // 3.2 m at 1.0 cm
const BOX = { x0: 2.0, x1: 2.4, y0: 1.4, y1: 1.8 };
const ROUTER = { x: 0.8, y: 1.6 };

function boxMean(power: Float32Array, dx: number): number {
  let s = 0;
  let c = 0;
  for (let j = Math.floor(BOX.y0 / dx); j < Math.ceil(BOX.y1 / dx); j++)
    for (let i = Math.floor(BOX.x0 / dx); i < Math.ceil(BOX.x1 / dx); i++) {
      s += power[j * N + i]!;
      c++;
    }
  return s / c;
}

function run(material: WallMaterialId | null, metalSigma?: number): number {
  const scene: Scene = {
    router: ROUTER,
    walls: material ? [{ x1: 1.6, y1: 0.8, x2: 1.6, y2: 2.4, material }] : [],
  };
  const materialOf = metalSigma === undefined ? undefined : (id: WallMaterialId) => (id === "metal" ? toMaterial(1, metalSigma) : materialFor(id));
  const b = buildJob(scene, N, { materialOf });
  const r = runCpuJob(b.job)!;
  return boxMean(r.power, b.dx);
}

describe("wall shadow, headless CPU solver", () => {
  it("metal casts a clear shadow, drywall only a weak one", () => {
    const ref = run(null);
    const rows: Record<string, number> = {};
    for (const id of WALL_ORDER) rows[id] = 10 * Math.log10(run(id) / ref);
    const broken = 10 * Math.log10(run("metal", 0) / ref);
    console.log("SHADOW dB (box behind wall vs same box with no wall):");
    for (const id of WALL_ORDER) console.log(`  ${id.padEnd(9)} ${rows[id]!.toFixed(2)} dB`);
    console.log(`  metal with sigma = 0 (break check): ${broken.toFixed(2)} dB`);
    expect(rows.metal!).toBeLessThan(-20);
    expect(rows.drywall!).toBeGreaterThan(-3);
    expect(rows.metal!).toBeLessThan(rows.concrete!);
    expect(rows.concrete!).toBeLessThan(rows.drywall!);
    // break check: with no conductivity the "metal" wall is just a thin air-like sheet.
    expect(broken).toBeGreaterThan(-3);
  }, 300000);
});
