import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Material } from "../src/coefficients";
import { makeSolver } from "./helpers";

/**
 * Test 1: energy.
 *
 * The solver is leapfrog: u at integer steps, q at half steps. The naive energy
 * sum(C u^2 + L q^2)/2 oscillates even in a lossless room. The conserved form uses q at
 * two time levels:
 *   E = 1/2 sum C u^2  +  1/2 sum L q_old q_new        (weights dx^2 dropped)
 * where L of a q face is the L of the cell on its high side (the solver's face rule).
 *
 * advance() does q update then u update. The test copies u and q before each advance, so
 * after it: u_old = u_n, q_old = q_{n-1/2}, q_new = q_{n+1/2}. E pairs u_n with those two q levels.
 *   (a) lossless closed room, random C and L, random initial u: E constant to REL_TOL.
 *   (b) lossy room (gammaU, gammaQ > 0): E never rises by more than REL_TOL per step,
 *       and ends well below its start.
 * Seeds are fixed. Fields are f32, so a tolerance is stated, not exact equality.
 */
const SEED = 20261121;
const STEPS = 1500;
const REL_TOL = 5e-6;

interface Room {
  nx: number;
  ny: number;
  mats: Material[];
}

const roomArb = (lossy: boolean) =>
  fc
    .record({
      nx: fc.integer({ min: 12, max: 32 }),
      ny: fc.integer({ min: 12, max: 32 }),
      seed: fc.integer({ min: 1, max: 2 ** 30 }),
    })
    .map(({ nx, ny, seed }) => ({ nx, ny, seed, lossy }));

function makeRoom({ nx, ny, seed, lossy }: { nx: number; ny: number; seed: number; lossy: boolean }): Room {
      let s = seed;
      const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      const mats: Material[] = [];
      for (let i = 0; i < nx * ny; i++)
        mats.push({
          C: 0.5 + 1.5 * rnd(),
          L: 0.5 + 1.5 * rnd(),
          gammaU: lossy ? 0.2 * rnd() : 0,
          gammaQ: lossy ? 0.2 * rnd() : 0,
        });
      return { nx, ny, mats };
}

function energyTracker(spec: Parameters<typeof makeRoom>[0], steps: number) {
  const room = makeRoom(spec);
  const { solver } = makeSolver(room.nx, room.ny, 1, (i, j) => room.mats[j * room.nx + i]!);
  const { nx, ny, u, qx, qy } = solver;
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < u.length; i++) u[i] = rnd() - 0.5;
  const prevU = new Float32Array(u.length);
  const prevQx = new Float32Array(qx.length);
  const prevQy = new Float32Array(qy.length);
  const energy = (naive: boolean) => {
    let e = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) e += 0.5 * room.mats[j * nx + i]!.C * (naive ? u : prevU)[j * nx + i]! ** 2;
    for (let j = 0; j < ny; j++)
      for (let i = 1; i < nx; i++) {
        const k = j * (nx + 1) + i;
        e += 0.5 * room.mats[j * nx + i]!.L * (naive ? qx[k]! ** 2 : prevQx[k]! * qx[k]!);
      }
    for (let j = 1; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        e += 0.5 * room.mats[k]!.L * (naive ? qy[k]! ** 2 : prevQy[k]! * qy[k]!);
      }
    return e;
  };
  const E: number[] = [];
  const En: number[] = [];
  for (let n = 0; n < steps; n++) {
    prevU.set(u);
    prevQx.set(qx);
    prevQy.set(qy);
    solver.advance();
    E.push(energy(false));
    En.push(energy(true));
  }
  return { E, En };
}

describe("test 1: energy", () => {
  it("lossless closed room conserves the two-time-level energy", () => {
    let worst = 0;
    let worstNaive = 0;
    fc.assert(
      fc.property(roomArb(false), (spec) => {
        const { E, En } = energyTracker(spec, STEPS);
        const e0 = E[0]!; // E[0] = 1/2 C u0^2 + 0 (q_{-1/2} = 0), exact start energy
        let drift = 0;
        for (let n = 0; n < E.length; n++) drift = Math.max(drift, Math.abs(E[n]! - e0) / e0);
        const mean = En.reduce((a, b) => a + b, 0) / En.length;
        const naive = Math.max(...En.slice(1).map((v) => Math.abs(v - mean) / mean));
        worst = Math.max(worst, drift);
        worstNaive = Math.max(worstNaive, naive);
        return drift < REL_TOL;
      }),
      { seed: SEED, numRuns: 6 },
    );
    console.log(
      `lossless: worst relative drift of conserved energy over ${STEPS} steps = ${worst.toExponential(2)} (tol ${REL_TOL}); naive energy swings by ${worstNaive.toExponential(2)}`,
    );
    expect(worst).toBeLessThan(REL_TOL);
  }, 120_000);

  it("lossy room: energy never increases", () => {
    let worstRise = -Infinity;
    let finalRatio = 0;
    fc.assert(
      fc.property(roomArb(true), (spec) => {
        const { E } = energyTracker(spec, STEPS);
        let rise = -Infinity;
        for (let n = 2; n < E.length; n++) rise = Math.max(rise, (E[n]! - E[n - 1]!) / E[1]!);
        worstRise = Math.max(worstRise, rise);
        finalRatio = E[E.length - 1]! / E[1]!;
        return rise <= REL_TOL && E[E.length - 1]! < 0.5 * E[1]!;
      }),
      { seed: SEED, numRuns: 6 },
    );
    console.log(
      `lossy: worst single-step relative rise = ${worstRise.toExponential(2)} (limit ${REL_TOL}); last room E_end/E_start = ${finalRatio.toExponential(2)}`,
    );
    expect(worstRise).toBeLessThanOrEqual(REL_TOL);
  }, 120_000);
});
