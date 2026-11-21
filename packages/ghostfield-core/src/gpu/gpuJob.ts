import { Cpml } from "../cpu/cpml";
import { PowerAccumulator, makeSineSource, type ProgressFn } from "../runtime/sineSource";
import type { FieldJob, FieldResult } from "../runtime/cpuJob";
import { GpuSolver } from "./gpuSolver";

/**
 * Same job as runCpuJob, on WebGPU. The shaders do not average, so the settle phase runs in big
 * batched submits and the averaging window reads u back every `sampleEvery` steps.
 * Returns null when `cancelled()` turns true between chunks.
 */
export async function runGpuJob(
  device: GPUDevice,
  job: FieldJob,
  onProgress?: ProgressFn,
  cancelled?: () => boolean,
  chunk = 64,
): Promise<FieldResult | null> {
  const { cs, plan } = job;
  const solver = new GpuSolver(device, cs, {
    cpml: job.cpmlThickness > 0 ? new Cpml(cs, { thickness: job.cpmlThickness }) : undefined,
    solid: job.solid,
  });
  try {
    for (const s of job.sources) solver.addSource(makeSineSource(s, cs.dt));
    const total = plan.settleSteps + plan.windowSteps;
    let done = 0;
    while (done < plan.settleSteps) {
      if (cancelled?.()) return null;
      const n = Math.min(chunk, plan.settleSteps - done);
      await solver.run(n);
      done += n;
      onProgress?.(done / total, "settle");
    }
    const acc = new PowerAccumulator(cs.nx * cs.ny);
    for (let n = 0; n < plan.windowSteps; n += plan.sampleEvery) {
      if (cancelled?.()) return null;
      await solver.run(n === 0 ? 1 : plan.sampleEvery); // snapshot k is after settle + 1 + k*sampleEvery steps, as in runCpuJob
      acc.add(await solver.readU());
      onProgress?.((plan.settleSteps + n) / total, "average");
    }
    onProgress?.(1, "average");
    return { power: acc.mean(), steps: solver.step };
  } finally {
    solver.destroy();
  }
}
