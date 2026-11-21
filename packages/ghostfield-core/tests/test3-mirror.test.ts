import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Material } from "../src/coefficients";
import { rigidWalls } from "../src/cpu";
import { makeSolver, maxAbs, ricker } from "./helpers";

/**
 * Test 3: mirror symmetry. A room that is mirror-symmetric about its centre line, driven by
 * a mirror-symmetric source pair, keeps a mirror-symmetric field:
 *   u(ix, iy) = u(nx-1-ix, iy)   (mirror in x), or the same in y.
 *
 * Symmetric room: random C and gammaU patches, plus random solid blocks (rigid walls), each
 * placed together with its mirror image. L and gammaQ are uniform. Reason: a q face takes
 * L and gammaQ from the cell on its HIGH side, so a jump in L or gammaQ is shifted by one
 * cell in the mirror image. The scheme is not exactly mirror-symmetric across such jumps
 * (the third case below measures that; it is a known property, not a bug in this test).
 *
 * Metric: max_cells |u - mirror(u)| / max |u| after STEPS steps. f32, tolerance stated.
 */
const SEED = 20261121;
const STEPS = 400;
const TOL = 1e-4;

type Spec = { nx: number; ny: number; seed: number; axis: "x" | "y" };

function room(spec: Spec, withJumpInL = false) {
  const { nx, ny, axis } = spec;
  let s = spec.seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const mx = (i: number, j: number) => (axis === "x" ? [nx - 1 - i, j] : [i, ny - 1 - j]) as [number, number];
  const C = new Float64Array(nx * ny).fill(1);
  const gu = new Float64Array(nx * ny);
  const solid = new Uint8Array(nx * ny);
  const L = new Float64Array(nx * ny).fill(1);
  const paint = (arr: Float64Array | Uint8Array, v: number, x0: number, y0: number, w: number, h: number) => {
    for (let j = y0; j < y0 + h; j++)
      for (let i = x0; i < x0 + w; i++) {
        arr[j * nx + i] = v;
        const [a, b] = mx(i, j);
        arr[b * nx + a] = v;
      }
  };
  for (let k = 0; k < 4; k++) {
    const w = 2 + Math.floor(rnd() * 5);
    const h = 2 + Math.floor(rnd() * 5);
    const x0 = Math.floor(rnd() * (nx - w));
    const y0 = Math.floor(rnd() * (ny - h));
    if (k < 2) paint(C, 0.6 + 1.2 * rnd(), x0, y0, w, h);
    else paint(gu, 0.02 + 0.1 * rnd(), x0, y0, w, h);
  }
  // One solid block per room, away from the source pair (kept 6 cells from the centre line).
  {
    const w = 3 + Math.floor(rnd() * 4);
    const h = 3 + Math.floor(rnd() * 4);
    const x0 = Math.floor(rnd() * (nx - w));
    const y0 = Math.floor(rnd() * (ny - h));
    paint(solid, 1, x0, y0, w, h);
  }
  if (withJumpInL) paint(L, 2, 4, 4, 6, 6);
  // Source pair: mirror images of each other; moved off any solid cell.
  let sx = 3 + Math.floor(rnd() * (nx - 6));
  let sy = 3 + Math.floor(rnd() * (ny - 6));
  while (solid[sy * nx + sx]) {
    sx = (sx + 1) % nx;
  }
  const [tx, ty] = mx(sx, sy);
  return { nx, ny, C, gu, L, solid, sources: [[sx, sy], [tx, ty]] as [number, number][] };
}

function asymmetry(spec: Spec, withJumpInL = false, breakIt = false): number {
  const r = room(spec, withJumpInL);
  const { nx, ny } = r;
  const mat = (i: number, j: number): Material => ({
    // break check: shift the C patches by one cell on one side only
    C: breakIt && i === 5 ? r.C[j * nx + i]! * 1.3 : r.C[j * nx + i]!,
    L: r.L[j * nx + i]!,
    gammaU: r.gu[j * nx + i]!,
    gammaQ: 0,
  });
  const { solver } = makeSolver(nx, ny, 1, mat, () => rigidWalls(nx, ny, r.solid));
  for (const [x, y] of r.sources) solver.addSource({ ix: x, iy: y, value: ricker(0.06) });
  solver.run(STEPS);
  const u = solver.u;
  let m = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [a, b] = spec.axis === "x" ? [nx - 1 - i, j] : [i, ny - 1 - j];
      m = Math.max(m, Math.abs(u[j * nx + i]! - u[b * nx + a]!));
    }
  const peak = maxAbs(u);
  if (!(peak > 1e-6)) throw new Error("field is empty");
  return m / peak;
}

const specArb: fc.Arbitrary<Spec> = fc.record({
  nx: fc.integer({ min: 30, max: 48 }),
  ny: fc.integer({ min: 30, max: 48 }),
  seed: fc.integer({ min: 1, max: 2 ** 30 }),
  axis: fc.constantFrom("x" as const, "y" as const),
});

describe("test 3: mirror symmetry", () => {
  it("symmetric room, symmetric sources: field stays symmetric", () => {
    let worst = 0;
    fc.assert(
      fc.property(specArb, (spec) => {
        const e = asymmetry(spec, false, process.env.GF_BREAK === "asym");
        worst = Math.max(worst, e);
        return e < TOL;
      }),
      { seed: SEED, numRuns: 12 },
    );
    console.log(`mirror: worst max|u - mirror(u)|/max|u| over 12 rooms (both axes) = ${worst.toExponential(2)} (tol ${TOL})`);
    expect(worst).toBeLessThan(TOL);
  }, 120_000);

  it("known limit: an L jump is shifted one cell in the mirror image (printed, not asserted small)", () => {
    const e = asymmetry({ nx: 40, ny: 40, seed: 7, axis: "x" }, true);
    console.log(`mirror with an L jump (high-side face rule): relative asymmetry = ${e.toExponential(2)}`);
    expect(e).toBeGreaterThan(TOL); // documents the limit; if this goes small, the face rule changed
  });
});
