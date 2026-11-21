import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Material } from "../src/coefficients";
import { rigidWalls } from "../src/cpu";
import { makeSolver, maxAbs, maxAbsDiff, ricker } from "./helpers";

/**
 * Test 2: reciprocity. h(A->B) = h(B->A) in a random L-shaped room with random traps.
 *
 * h(A->B): a pulse injected into u at cell A, u recorded at cell B. Source and probe are both
 * on u. C is uniform, so the injection and the read-out have the same weight and the discrete
 * operator is symmetric. L varies (random sound-speed patches) and traps are patches with
 * flow loss gammaQ (bass traps are flow resistivity).
 * The room is the full grid minus a solid notch in one corner (rigid inner walls, `rigidWalls`).
 *
 * Case 1 is lossless (no traps). Case 2 adds traps. Metric:
 *   err = max_t |h_AB - h_BA| / max_t |h_AB|.
 * Fixed fast-check seed. f32 fields: tolerance is stated.
 */
const SEED = 20261121;
const STEPS = 700;
const TOL_LOSSLESS = 2e-5;
const TOL_LOSSY = 2e-5;

const C0 = 1;

function build(spec: { nx: number; ny: number; seed: number }, lossy: boolean) {
  const { nx, ny } = spec;
  let s = spec.seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  // Solid notch in the top-right corner: 35..60 % of each side.
  const notchW = Math.floor(nx * (0.35 + 0.25 * rnd()));
  const notchH = Math.floor(ny * (0.35 + 0.25 * rnd()));
  const solid = new Uint8Array(nx * ny);
  for (let j = ny - notchH; j < ny; j++) for (let i = nx - notchW; i < nx; i++) solid[j * nx + i] = 1;
  // Random L patches and traps (rectangles).
  const L = new Float64Array(nx * ny).fill(1);
  const gq = new Float64Array(nx * ny);
  const rect = () => {
    const w = 2 + Math.floor(rnd() * 6);
    const h = 2 + Math.floor(rnd() * 6);
    return { x0: Math.floor(rnd() * (nx - w)), y0: Math.floor(rnd() * (ny - h)), w, h };
  };
  for (let k = 0; k < 3; k++) {
    const r = rect();
    const v = 0.6 + 1.2 * rnd();
    for (let j = r.y0; j < r.y0 + r.h; j++) for (let i = r.x0; i < r.x0 + r.w; i++) L[j * nx + i] = v;
  }
  if (lossy)
    for (let k = 0; k < 3; k++) {
      const r = rect();
      const v = 0.05 + 0.4 * rnd();
      for (let j = r.y0; j < r.y0 + r.h; j++) for (let i = r.x0; i < r.x0 + r.w; i++) gq[j * nx + i] = v;
    }
  // Two random fluid cells A != B.
  const fluid: number[] = [];
  for (let c = 0; c < nx * ny; c++) if (!solid[c]) fluid.push(c);
  const a = fluid[Math.floor(rnd() * fluid.length)]!;
  let b = fluid[Math.floor(rnd() * fluid.length)]!;
  if (b === a) b = fluid[(fluid.indexOf(a) + 1) % fluid.length]!;
  return { nx, ny, solid, L, gq, a, b };
}

function response(room: ReturnType<typeof build>, from: number, to: number): number[] {
  const { nx, ny, solid, L, gq } = room;
  const mat = (i: number, j: number): Material => ({ C: C0, L: L[j * nx + i]!, gammaU: 0, gammaQ: gq[j * nx + i]! });
  const { solver } = makeSolver(nx, ny, 1, mat, () => rigidWalls(nx, ny, solid));
  solver.addSource({ ix: from % nx, iy: Math.floor(from / nx), value: ricker(0.06) });
  const p = solver.addProbe(to % nx, Math.floor(to / nx));
  solver.run(STEPS);
  return p.samples;
}

function recipErr(spec: { nx: number; ny: number; seed: number }, lossy: boolean): number {
  const room = build(spec, lossy);
  const hab = response(room, room.a, room.b);
  const hba = response(room, room.b, room.a);
  if (!(maxAbs(hab) > 1e-6)) throw new Error("no signal reached the probe");
  return maxAbsDiff(hab, hba) / maxAbs(hab);
}

const specArb = fc.record({
  nx: fc.integer({ min: 30, max: 48 }),
  ny: fc.integer({ min: 30, max: 48 }),
  seed: fc.integer({ min: 1, max: 2 ** 30 }),
});

describe("test 2: reciprocity", () => {
  for (const lossy of [false, true]) {
    it(
      lossy ? "L-shaped room with random L patches and traps" : "L-shaped room, lossless",
      () => {
        let worst = 0;
        fc.assert(
          fc.property(specArb, (spec) => {
            const e = recipErr(spec, lossy);
            worst = Math.max(worst, e);
            return e < (lossy ? TOL_LOSSY : TOL_LOSSLESS);
          }),
          { seed: SEED, numRuns: 8 },
        );
        console.log(`reciprocity ${lossy ? "with traps" : "lossless"}: worst max|hAB-hBA|/max|hAB| over 8 rooms = ${worst.toExponential(2)} (tol ${lossy ? TOL_LOSSY : TOL_LOSSLESS})`);
        expect(worst).toBeLessThan(lossy ? TOL_LOSSY : TOL_LOSSLESS);
      },
      120_000,
    );
  }
});
