import { describe, it, expect } from "vitest";
import { DEFAULT_COURANT, buildCoefficients, dtFromCourant, type Material } from "../src/coefficients";
import { CpuSolver } from "../src/cpu";

/**
 * Test 7: rectangular room modes, f = (c/2) sqrt((m/Lx)^2 + (n/Ly)^2), within 0.1%.
 *
 * Wall position: u lives at cell centres, qx/qy at cell faces. The outer faces
 * are never updated (q = 0 there, rigid wall). So the wall sits exactly on the
 * outer face and Lx = NX*dx, Ly = NY*dx EXACTLY (no half-cell offset).
 *
 * Single example (no fast-check). Env overrides exist only to try nearby inputs:
 * GF_NX, GF_NY, GF_SRC="ix,iy", GF_PROBE="ix,iy", GF_SECONDS, GF_FMAX.
 */
const env = process.env;
const pair = (s: string | undefined, d: [number, number]): [number, number] => {
  if (!s) return d;
  const [a, b] = s.split(",").map(Number);
  return [a!, b!];
};
const NX = Number(env.GF_NX ?? 256);
const NY = Number(env.GF_NY ?? 200);
const DX = 0.025;
const C0 = 343;
const RHO = 1.2;
const SECONDS = Number(env.GF_SECONDS ?? 6);
const FMAX = Number(env.GF_FMAX ?? 80);
const SRC = pair(env.GF_SRC, [Math.round(0.2 * NX), Math.round(0.27 * NY)]);
const PROBE = pair(env.GF_PROBE, [Math.round(0.8 * NX), Math.round(0.74 * NY)]);
// Tightened from 1 % to 0.1 % (measured max error 0.002 %): a one-cell wall error is 0.39-0.5 % and now fails.
const TOL_PCT = 0.1;

const LX = NX * DX; // break check: (NX + 1) * DX
const LY = NY * DX;
const modeHz = (m: number, n: number) => (C0 / 2) * Math.sqrt((m / LX) ** 2 + (n / LY) ** 2);

/** |DFT| at one frequency (direct evaluation = infinite zero padding). */
function dftMag(x: Float64Array, fs: number, f: number): number {
  const w = (2 * Math.PI * f) / fs;
  const cr = Math.cos(w);
  const ci = Math.sin(w);
  // Rotating phasor, re-anchored every 4096 samples to limit drift.
  let re = 0;
  let im = 0;
  let pr = 1;
  let pi = 0;
  for (let k = 0; k < x.length; k++) {
    if ((k & 4095) === 0) {
      pr = Math.cos(w * k);
      pi = Math.sin(w * k);
    }
    re += x[k]! * pr;
    im -= x[k]! * pi;
    const t = pr * cr - pi * ci;
    pi = pr * ci + pi * cr;
    pr = t;
  }
  return Math.hypot(re, im);
}

/** Peak near f0: coarse scan of +-2% in 0.02 Hz steps, then parabolic interpolation on the top 3 points. */
function findPeak(x: Float64Array, fs: number, f0: number): { f: number; mag: number } {
  const step = 0.02;
  const lo = f0 * 0.98;
  const n = Math.ceil((f0 * 0.04) / step);
  const mags: number[] = [];
  for (let i = 0; i <= n; i++) mags.push(dftMag(x, fs, lo + i * step));
  let k = 0;
  for (let i = 1; i < mags.length; i++) if (mags[i]! > mags[k]!) k = i;
  if (k === 0 || k === mags.length - 1) return { f: lo + k * step, mag: mags[k]! }; // edge: no mode in window
  const a = Math.log(mags[k - 1]!);
  const b = Math.log(mags[k]!);
  const c = Math.log(mags[k + 1]!);
  const d = a - 2 * b + c;
  const off = d === 0 ? 0 : (0.5 * (a - c)) / d;
  return { f: lo + (k + off) * step, mag: mags[k]! };
}

describe("test 7: rectangular room modes", () => {
  it(
    "lowest modes match (c/2)sqrt((m/Lx)^2+(n/Ly)^2) within 0.1%",
    () => {
      const air: Material = { C: 1 / (RHO * C0 * C0), L: RHO, gammaU: 0, gammaQ: 0 };
      const dt = dtFromCourant(DEFAULT_COURANT, DX, C0);
      const cs = buildCoefficients(NX, NY, DX, dt, () => air);
      const s = new CpuSolver(cs);
      // Ricker pulse, 60 Hz centre: broadband over 20..120 Hz, no DC.
      const f0 = 60;
      const t0 = 1.5 / f0;
      s.addSource({
        ix: SRC[0],
        iy: SRC[1],
        value: (_n, t) => {
          const a = (Math.PI * f0 * (t - t0)) ** 2;
          return (1 - 2 * a) * Math.exp(-a);
        },
      });
      const probe = s.addProbe(PROBE[0], PROBE[1]);
      const steps = Math.round(SECONDS / dt);
      const fs = 1 / dt;
      s.run(steps);

      // Hann window over the whole record, then zero-padded DFT near each mode.
      const N = probe.samples.length;
      const x = new Float64Array(N);
      for (let k = 0; k < N; k++) x[k] = probe.samples[k]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1)));

      const modes: { m: number; n: number; f: number }[] = [];
      for (let m = 0; m <= 8; m++)
        for (let n = 0; n <= 8; n++) if (m + n > 0 && modeHz(m, n) <= FMAX) modes.push({ m, n, f: modeHz(m, n) });
      modes.sort((a, b) => a.f - b.f);

      const lines: string[] = [];
      lines.push(`room ${NX}x${NY} @ ${DX} m: Lx=${LX} m Ly=${LY} m, c=${C0} m/s, S=${cs.courant}, dt=${dt} s`);
      lines.push(`steps=${steps} (${(steps * dt).toFixed(3)} s), source=(${SRC}) probe=(${PROBE}), f32 fields`);
      lines.push("m,n | formula Hz | measured Hz | % error");
      let maxErr = 0;
      for (const md of modes) {
        const p = findPeak(x, fs, md.f);
        const err = (100 * (p.f - md.f)) / md.f;
        maxErr = Math.max(maxErr, Math.abs(err));
        lines.push(`${md.m},${md.n} | ${md.f.toFixed(3)} | ${p.f.toFixed(3)} | ${err.toFixed(3)}`);
        expect(Math.abs(err), `mode (${md.m},${md.n})`).toBeLessThan(TOL_PCT);
      }
      lines.push(`max |error| = ${maxErr.toFixed(3)} %`);
      console.log(lines.join("\n"));
      expect(modes.length).toBeGreaterThanOrEqual(5);
    },
    300_000,
  );
});
