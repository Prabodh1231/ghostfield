import type { Source } from "../cpu/solver";

/** A continuous-wave point source, described as plain data so it can be sent to a Web Worker. */
export interface SineSourceSpec {
  ix: number;
  iy: number;
  /** Hz. */
  freq: number;
  /** Added to u each step, times the ramp. */
  amplitude: number;
  /** Turn-on length in periods (sin^2 ramp). */
  rampPeriods: number;
}

/** Time steps in one period of `freq`, as a real number. */
export function stepsPerPeriod(freq: number, dt: number): number {
  return 1 / (freq * dt);
}

/** Soft sine source with a sin^2 turn-on ramp. Same object for the CPU and GPU solvers. */
export function makeSineSource(spec: SineSourceSpec, dt: number): Source {
  const rampSteps = Math.max(1, spec.rampPeriods * stepsPerPeriod(spec.freq, dt));
  return {
    ix: spec.ix,
    iy: spec.iy,
    value(step, t) {
      const r = Math.min(1, step / rampSteps);
      const ramp = Math.sin((Math.PI / 2) * r) ** 2;
      return spec.amplitude * ramp * Math.sin(2 * Math.PI * spec.freq * t);
    },
  };
}

/** What to run and how to average, shared by both backends. */
export interface RunPlan {
  /** Steps before averaging starts (lets the field settle). */
  settleSteps: number;
  /** Steps of the averaging window (about `averagePeriods` periods). */
  windowSteps: number;
  /** Take a u snapshot every this many steps inside the window. */
  sampleEvery: number;
}

/**
 * Plan for a CW run. `sampleEvery` must give at least 3 snapshots per period, so the mean of u^2
 * over the window is the time-averaged |Ez|^2 of a sinusoid.
 */
export function makePlan(freq: number, dt: number, settleSteps: number, averagePeriods: number, sampleEvery: number): RunPlan {
  const spp = stepsPerPeriod(freq, dt);
  if (!(sampleEvery >= 1 && spp / sampleEvery >= 3)) throw new RangeError("need at least 3 snapshots per period");
  const windowSteps = Math.max(sampleEvery, Math.round(averagePeriods * spp));
  return { settleSteps, windowSteps, sampleEvery };
}

/** Running mean of u^2 over snapshots. */
export class PowerAccumulator {
  readonly sum: Float64Array;
  count = 0;
  constructor(cells: number) {
    this.sum = new Float64Array(cells);
  }
  add(u: Float32Array): void {
    const s = this.sum;
    for (let i = 0; i < s.length; i++) s[i]! += u[i]! * u[i]!;
    this.count++;
  }
  mean(): Float32Array {
    const out = new Float32Array(this.sum.length);
    const k = 1 / Math.max(1, this.count);
    for (let i = 0; i < out.length; i++) out[i] = this.sum[i]! * k;
    return out;
  }
}

/** Progress report: fraction 0..1 and a short phase label. */
export type ProgressFn = (fraction: number, phase: "settle" | "average") => void;
