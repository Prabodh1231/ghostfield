import type { CoefficientSet } from "../coefficients";
import { CpuSolver, rigidWalls, type Source } from "../cpu";

/**
 * Impulse-response job: a Ricker pulse goes in at one cell, u is recorded at another cell.
 * Plain data, so it can be sent to a Web Worker. The spectrum |P(f)|/|S(f)| is the room's
 * frequency response between the two cells.
 */
export interface ResponseJob {
  cs: CoefficientSet;
  /** Solid-cell mask (1 = solid, rigid), optional. */
  solid?: Uint8Array;
  source: { ix: number; iy: number };
  probe: { ix: number; iy: number };
  steps: number;
  /** Ricker centre frequency, Hz. */
  f0: number;
}

export interface ResponseResult {
  dt: number;
  /** u at the probe after every step. */
  probe: Float32Array;
  /** Value added to u at the source cell on every step. */
  source: Float32Array;
}

/** Ricker pulse (no DC), delayed 1.5 periods of f0. */
export function rickerSource(ix: number, iy: number, f0: number): Source {
  const t0 = 1.5 / f0;
  return {
    ix,
    iy,
    value: (_n, t) => {
      const a = (Math.PI * f0 * (t - t0)) ** 2;
      return (1 - 2 * a) * Math.exp(-a);
    },
  };
}

export function runCpuResponse(job: ResponseJob, onProgress?: (fraction: number) => void, cancelled?: () => boolean): ResponseResult | null {
  const { cs } = job;
  const solver = new CpuSolver(cs, job.solid ? rigidWalls(cs.nx, cs.ny, job.solid) : {});
  const src = rickerSource(job.source.ix, job.source.iy, job.f0);
  solver.addSource(src);
  const probe = solver.addProbe(job.probe.ix, job.probe.iy);
  const source = new Float32Array(job.steps);
  for (let n = 0; n < job.steps; n++) {
    solver.advance();
    source[n] = src.value(n + 1, (n + 1) * cs.dt); // the solver evaluates a source at step n+1
    if (n % 200 === 0) {
      if (cancelled?.()) return null;
      onProgress?.(n / job.steps);
    }
  }
  onProgress?.(1);
  return { dt: cs.dt, probe: Float32Array.from(probe.samples), source };
}

/** |DFT| of x at frequency f (direct evaluation), x sampled every dt. */
function dftMag(x: Float32Array, dt: number, f: number): number {
  const w = 2 * Math.PI * f * dt;
  const cr = Math.cos(w);
  const ci = Math.sin(w);
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

/** Flat for the first half of the record, then a cosine fade to 0 (keeps the early response, tames the cut-off). */
function fade(x: Float32Array): Float32Array {
  const n = x.length;
  const h = n >> 1;
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = k < h ? x[k]! : x[k]! * (0.5 + 0.5 * Math.cos((Math.PI * (k - h)) / (n - h)));
  return out;
}

/** Room response |P(f)|/|S(f)| at each frequency in `freqs` (Hz). Linear amplitude, not dB. */
export function responseSpectrum(r: ResponseResult, freqs: ArrayLike<number>): Float64Array {
  const p = fade(r.probe);
  const s = fade(r.source);
  const out = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) out[i] = dftMag(p, r.dt, freqs[i]!) / Math.max(1e-30, dftMag(s, r.dt, freqs[i]!));
  return out;
}
