import { describe, it, expect } from "vitest";
import { Cpml } from "../src/cpu";
import { UNIT_AIR, makeSolver, ricker } from "./helpers";

/**
 * Test 4: 2D spreading. A line (point-in-2D) source gives amplitude ~ r^-0.5 in the far field.
 *
 * Units: C = L = 1, dx = 1 (c = 1). Pulse: Ricker at f0 = 0.08 (12.5 cells per wavelength).
 * Domain 300x300 with the 16-cell CPML (test 5 checks the CPML), source at the centre,
 * 450 steps (long enough for the pulse and its 2D tail to pass every probe).
 * Probes on the +x axis at r = 25, 30, ..., 100 cells. kr at r = 25 is 2*pi*25/12.5 = 12.6,
 * so all probes are in the far field (kr >> 1).
 * Amplitude at each probe = |DFT of the probe record at f0|. The exponent is the least
 * squares slope of ln(amplitude) against ln(r). Expected -0.5; tolerance +-0.01.
 * Probes are on the axis: the grid is anisotropic, but the exponent of the decay is not.
 */
const env = process.env;
const N = 300;
const STEPS = 450;
const F0 = 0.08;
const TOL = 0.01;
const NO_CPML = env.GF_BREAK === "none"; // break check: rigid walls, reflections return

function amp(samples: number[], dt: number, f: number): number {
  let re = 0;
  let im = 0;
  for (let k = 0; k < samples.length; k++) {
    const ph = 2 * Math.PI * f * dt * (k + 1);
    re += samples[k]! * Math.cos(ph);
    im -= samples[k]! * Math.sin(ph);
  }
  return Math.hypot(re, im);
}

describe("test 4: 2D spreading", () => {
  it(
    "amplitude falls as r^-0.5 in the far field",
    () => {
      const c = N / 2;
      const { cs, solver } = makeSolver(N, N, 1, () => UNIT_AIR, NO_CPML ? () => ({}) : (cs) => new Cpml(cs));
      solver.addSource({ ix: c, iy: c, value: ricker(F0) });
      const radii: number[] = [];
      for (let r = 25; r <= 100; r += 5) radii.push(r);
      const probes = radii.map((r) => solver.addProbe(c + r, c));
      solver.run(STEPS);
      const xs = radii.map((r) => Math.log(r));
      const ys = probes.map((p) => Math.log(amp(p.samples, cs.dt, F0)));
      const n = xs.length;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < n; i++) {
        sxy += (xs[i]! - mx) * (ys[i]! - my);
        sxx += (xs[i]! - mx) ** 2;
      }
      const slope = sxy / sxx;
      const lines = [`2D spreading: ${N}x${N}, ${STEPS} steps, f0=${F0}, r = ${radii[0]}..${radii[n - 1]} cells`];
      radii.forEach((r, i) => lines.push(`r=${r} amplitude=${Math.exp(ys[i]!).toExponential(4)} amp*sqrt(r)=${(Math.exp(ys[i]!) * Math.sqrt(r)).toExponential(4)}`));
      lines.push(`fitted exponent = ${slope.toFixed(4)} (expected -0.5, tolerance ${TOL})`);
      console.log(lines.join("\n"));
      expect(Math.abs(slope + 0.5)).toBeLessThan(TOL);
    },
    300_000,
  );
});
