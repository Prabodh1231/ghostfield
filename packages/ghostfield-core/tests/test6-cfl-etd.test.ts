import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  CFL_LIMIT,
  DEFAULT_COURANT,
  ETD_SMALL,
  buildCoefficients,
  dtFromCourant,
  etd,
  etd64,
  type Material,
} from "../src/coefficients";
import { CpuSolver } from "../src/cpu";

const SEED = 20261121;
const air: Material = { C: 1 / (1.2 * 343 * 343), L: 1.2, gammaU: 0, gammaQ: 0 };
const cAir = 343;

describe("test 6: CFL guard and ETD coefficients", () => {
  it("constants: limit 0.7071, default 0.693", () => {
    expect(CFL_LIMIT).toBe(0.7071);
    expect(DEFAULT_COURANT).toBe(0.693);
  });

  it("guard rejects every S > 0.7071", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.7071 + 1e-6, max: 10, noNaN: true }), (S) => {
        const dx = 0.025;
        const dt = dtFromCourant(S, dx, cAir);
        expect(() => buildCoefficients(8, 8, dx, dt, () => air)).toThrow(RangeError);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  it("guard accepts every S <= 0.7071, including the default", () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-3, max: 0.7071 - 1e-9, noNaN: true }), (S) => {
        const dx = 0.025;
        const dt = dtFromCourant(S, dx, cAir);
        expect(() => buildCoefficients(8, 8, dx, dt, () => air)).not.toThrow();
      }),
      { seed: SEED, numRuns: 200 },
    );
    const dt = dtFromCourant(DEFAULT_COURANT, 0.025, cAir);
    expect(() => buildCoefficients(8, 8, 0.025, dt, () => air)).not.toThrow();
  });

  it("guard uses the fastest material, not free air", () => {
    const fast: Material = { C: air.C / 4, L: air.L, gammaU: 0, gammaQ: 0 }; // 2x speed
    const dt = dtFromCourant(0.6, 0.025, cAir); // fine for air, S=1.2 for fast
    expect(() => buildCoefficients(8, 8, 0.025, dt, (i) => (i === 3 ? fast : air))).toThrow(RangeError);
  });

  const gammaArb = fc.oneof(
    fc.constant(0),
    fc.double({ min: 0, max: 1e6, noNaN: true }),
    fc.double({ min: 1e-14, max: 1e-6, noNaN: true }),
  );
  const dtArb = fc.double({ min: 1e-9, max: 1e-1, noNaN: true });
  const cArb = fc.double({ min: 1e-12, max: 1e3, noNaN: true });

  it("A in [0,1] and B finite and >= 0 (f32, any gamma >= 0)", () => {
    fc.assert(
      fc.property(gammaArb, dtArb, cArb, (g, dt, C) => {
        const { A, B } = etd(g, dt, C);
        expect(A).toBeGreaterThanOrEqual(0);
        expect(A).toBeLessThanOrEqual(1);
        expect(Number.isFinite(B)).toBe(true);
        expect(B).toBeGreaterThanOrEqual(0);
      }),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("gamma -> 0 limit: B matches dt/C and A -> 1", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.999e-8, noNaN: true }), dtArb, cArb, (x, dt, C) => {
        const g = x / dt; // g*dt < ETD_SMALL
        const { A, B } = etd64(g, dt, C);
        expect(B).toBe(dt / C);
        expect(Math.abs(1 - A)).toBeLessThan(ETD_SMALL * 1.01);
      }),
      { seed: SEED, numRuns: 300 },
    );
    // Just above the switch the expm1 branch must agree with dt/C to ~g*dt/2.
    fc.assert(
      fc.property(fc.double({ min: 1e-8, max: 1e-6, noNaN: true }), dtArb, cArb, (x, dt, C) => {
        const { B } = etd64(x / dt, dt, C);
        expect(Math.abs(B / (dt / C) - 1)).toBeLessThanOrEqual(x / 2 + 1e-12);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("no NaN/Inf after N steps on random grids and materials at S <= 0.7071", () => {
    const matArb = fc.record({
      C: fc.double({ min: 0.5, max: 2, noNaN: true }),
      L: fc.double({ min: 0.5, max: 2, noNaN: true }),
      gammaU: fc.double({ min: 0, max: 50, noNaN: true }),
      gammaQ: fc.double({ min: 0, max: 50, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 24 }),
        fc.integer({ min: 4, max: 24 }),
        fc.array(matArb, { minLength: 1, maxLength: 4 }),
        fc.double({ min: 0.05, max: 0.7071, noNaN: true }),
        (nx, ny, mats, S) => {
          const dx = 1;
          const cMax = 1 / Math.sqrt(Math.min(...mats.map((m) => m.C)) * Math.min(...mats.map((m) => m.L)));
          const dt = dtFromCourant(Math.min(S, 0.7071 - 1e-9), dx, cMax);
          const cs = buildCoefficients(nx, ny, dx, dt, (i, j) => mats[(i + j) % mats.length]!);
          const s = new CpuSolver(cs);
          s.addSource({ ix: 1, iy: 1, value: (n) => Math.sin(0.3 * n) });
          s.run(300);
          for (const a of [s.u, s.qx, s.qy]) for (let k = 0; k < a.length; k++) expect(Number.isFinite(a[k]!)).toBe(true);
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  });
});
