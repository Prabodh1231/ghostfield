import { MAX_PULSES } from "./types";

/** Ricker wavelet at time t (s) for peak frequency f0, centred at 1.5/f0. */
export function rickerAt(f0: number, t: number): number {
  const a = (Math.PI * f0 * (t - 1.5 / f0)) ** 2;
  return (1 - 2 * a) * Math.exp(-a);
}

/** Fixed pool of MAX_PULSES pulse slots shared by the CPU and GPU live sims. Oldest slot is recycled. */
export class PulseBank {
  readonly ix = new Int32Array(MAX_PULSES);
  readonly iy = new Int32Array(MAX_PULSES);
  readonly amp = new Float32Array(MAX_PULSES);
  /** Step count when the pulse was added. The wavelet starts on the next step. */
  readonly n0 = new Float64Array(MAX_PULSES);
  readonly alive = new Uint8Array(MAX_PULSES);
  private readonly order: number[] = [];
  /** Wavelet length in seconds; after this a pulse is dead and its slot is free. */
  readonly length: number;

  constructor(
    readonly f0: number,
    readonly dt: number,
  ) {
    this.length = 3 / f0;
  }

  add(ix: number, iy: number, amp: number, step: number): number {
    let k = -1;
    for (let i = 0; i < MAX_PULSES; i++) if (!this.alive[i]) { k = i; break; }
    if (k < 0) k = this.order[0]!; // full: drop the oldest
    const at = this.order.indexOf(k);
    if (at >= 0) this.order.splice(at, 1);
    this.order.push(k);
    this.ix[k] = ix;
    this.iy[k] = iy;
    this.amp[k] = amp;
    this.n0[k] = step;
    this.alive[k] = 1;
    return k;
  }

  /** Value of slot k when the solver reaches `step` (the step just completed). */
  value(k: number, step: number): number {
    const t = (step - this.n0[k]! - 1) * this.dt;
    if (t > this.length) {
      this.alive[k] = 0;
      return 0;
    }
    return this.amp[k]! * rickerAt(this.f0, t);
  }

  clear(): void {
    this.alive.fill(0);
    this.order.length = 0;
  }
}
