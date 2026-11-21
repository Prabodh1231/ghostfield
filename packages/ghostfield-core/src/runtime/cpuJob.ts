import type { CoefficientSet } from "../coefficients";
import { Cpml, CpuSolver, composeBoundaries, rigidWalls, type Boundary } from "../cpu";
import { PowerAccumulator, makeSineSource, type ProgressFn, type RunPlan, type SineSourceSpec } from "./sineSource";

/** Everything a CW run needs, as plain data (structured-cloneable, so it can go to a Web Worker). */
export interface FieldJob {
  cs: CoefficientSet;
  /** CPML thickness in cells, 0 for none. */
  cpmlThickness: number;
  /** Solid-cell mask (1 = solid, rigid), optional. */
  solid?: Uint8Array;
  sources: SineSourceSpec[];
  plan: RunPlan;
}

export interface FieldResult {
  /** Time-averaged u^2 per cell, nx*ny. */
  power: Float32Array;
  steps: number;
}

/** Run a job on the CPU solver. Calls `onProgress` about every 25 steps; `cancelled()` stops it (returns null). */
export function runCpuJob(job: FieldJob, onProgress?: ProgressFn, cancelled?: () => boolean): FieldResult | null {
  const { cs, plan } = job;
  const bs: Boundary[] = [];
  if (job.cpmlThickness > 0) bs.push(new Cpml(cs, { thickness: job.cpmlThickness }));
  if (job.solid) bs.push(rigidWalls(cs.nx, cs.ny, job.solid));
  const solver = new CpuSolver(cs, bs.length ? composeBoundaries(...bs) : {});
  for (const s of job.sources) solver.addSource(makeSineSource(s, cs.dt));
  const acc = new PowerAccumulator(cs.nx * cs.ny);
  const total = plan.settleSteps + plan.windowSteps;
  for (let n = 0; n < total; n++) {
    solver.advance();
    if (n >= plan.settleSteps && (n - plan.settleSteps) % plan.sampleEvery === 0) acc.add(solver.u);
    if (n % 25 === 0) {
      if (cancelled?.()) return null;
      onProgress?.(n / total, n < plan.settleSteps ? "settle" : "average");
    }
  }
  onProgress?.(1, "average");
  return { power: acc.mean(), steps: total };
}
