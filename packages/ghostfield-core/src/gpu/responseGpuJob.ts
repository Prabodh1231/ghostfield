import { rickerSource, type ResponseJob, type ResponseResult } from "../runtime/responseJob";
import { GpuSolver } from "./gpuSolver";

/** Same job as runCpuResponse, on WebGPU, in chunks (probe samples are read back once per chunk). Null when cancelled. */
export async function runGpuResponse(
  device: GPUDevice,
  job: ResponseJob,
  onProgress?: (fraction: number) => void,
  cancelled?: () => boolean,
  chunk = 512,
): Promise<ResponseResult | null> {
  const { cs } = job;
  const solver = new GpuSolver(device, cs, { solid: job.solid });
  try {
    const src = rickerSource(job.source.ix, job.source.iy, job.f0);
    solver.addSource(src);
    const probe = solver.addProbe(job.probe.ix, job.probe.iy);
    const source = new Float32Array(job.steps);
    for (let n = 0; n < job.steps; n++) source[n] = src.value(n + 1, (n + 1) * cs.dt);
    for (let done = 0; done < job.steps; ) {
      if (cancelled?.()) return null;
      const m = Math.min(chunk, job.steps - done);
      await solver.run(m);
      done += m;
      onProgress?.(done / job.steps);
    }
    return { dt: cs.dt, probe: Float32Array.from(probe.samples), source };
  } finally {
    solver.destroy();
  }
}
