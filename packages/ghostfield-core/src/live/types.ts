/**
 * FROZEN API (round 7). Live time-domain stepper. Apps build against this file.
 * Do not change signatures without a question report to the conductor.
 *
 * Units: cell indices are integers (x fastest, index = iy*nx + ix). Pressure/field values are the
 * solver's u. Pulses are Ricker wavelets added to u (soft source), peak frequency `pulseHz`.
 */
import type { CoefficientSet, Material } from "../coefficients";

/** Source slots shared by CPU and GPU. Same as gpu MAX_SOURCES. Pulses recycle slots (oldest first). */
export const MAX_PULSES = 8;

export interface LiveSimOptions {
  /** Grid, dx, dt and per-cell coefficients. The sim copies `coef`; later edits do not touch your object. */
  cs: CoefficientSet;
  /** Starting solid mask (1 = rigid solid), length nx*ny. Default: all air. Outer edge is always rigid. */
  solid?: Uint8Array;
  /** "cpu" (pure TS) or "gpu" (WebGPU, needs `device`). */
  backend: "cpu" | "gpu";
  device?: GPUDevice;
  /** Ricker peak frequency in Hz of pulses. Default 400 (content up to about 1 kHz). */
  pulseHz?: number;
  /** GPU only: copy the field back every N calls of advance(). Default 1. Never blocks. */
  readbackEvery?: number;
}

export interface LiveSim {
  readonly backend: "cpu" | "gpu";
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;
  /** Seconds of simulated time per step. */
  readonly dt: number;
  /** Steps done so far. */
  readonly step: number;
  /**
   * Run n steps. Synchronous and non-blocking: on GPU it only submits work.
   * Edits made before the call take effect from its first step.
   */
  advance(n: number): void;
  /**
   * The u field, nx*ny. CPU: the live array (do not write to it). GPU: the latest finished copy,
   * which lags 1-3 frames; the array identity is stable.
   */
  field(): Float32Array;
  /**
   * Add a pulse at cell (x, y) with amplitude `amp` (u units at the wavelet peak), starting at the next step.
   * At most MAX_PULSES are live: when full, the oldest pulse is dropped. Returns the slot (0..MAX_PULSES-1).
   */
  addPulse(x: number, y: number, amp: number): number;
  /** Make one cell rigid solid (true) or air (false). u in the cell is reset to 0. Out-of-range cells throw. */
  setSolid(ix: number, iy: number, solid: boolean): void;
  /**
   * Change one cell's material (e.g. porous: raise gammaQ). Throws RangeError if the cell would be
   * faster than cs.cMax (CFL). Takes effect from the next advance().
   */
  setMaterial(ix: number, iy: number, m: Material): void;
  /** Zero u, qx, qy and drop all pulses. Solid mask and materials stay. */
  reset(): void;
  destroy(): void;
}

/** Implemented in ./createLiveSim.ts and re-exported from live/index.ts. */
export type CreateLiveSim = (opts: LiveSimOptions) => LiveSim;
