import { CPU_GRID_SCALE, detectBackend } from "@core/runtime/detectBackend";
import type { FieldJob, FieldResult } from "@core/runtime/cpuJob";
import { runGpuJob } from "@core/gpu/gpuJob";
import type { ProgressFn } from "@core/runtime/sineSource";
import CpuWorker from "./cpu.worker?worker";
import { CPU_GRID, GPU_GRID } from "./scene";

export type Backend =
  | { kind: "webgpu"; device: GPUDevice; n: number }
  | { kind: "cpu"; reason: string; n: number };

/** WebGPU if a real adapter exists, else the CPU solver in a Web Worker at the smaller grid. */
export async function pickBackend(): Promise<Backend> {
  // "?backend=cpu" forces the fallback, to try it on a machine that has WebGPU.
  if (new URLSearchParams(location.search).get("backend") === "cpu") return { kind: "cpu", reason: "forced by ?backend=cpu", n: Math.round(GPU_GRID * CPU_GRID_SCALE) };
  const b = await detectBackend();
  if (b.kind === "webgpu") return { kind: "webgpu", device: b.device, n: GPU_GRID };
  return { kind: "cpu", reason: b.reason, n: Math.min(CPU_GRID, Math.round(GPU_GRID * b.gridScale)) };
}

export interface SimHandle {
  cancel(): void;
  result: Promise<FieldResult | null>;
}

/** Start a run off the main thread (CPU worker) or as batched async GPU submits. Cancel resolves null. */
export function startSim(backend: Backend, job: FieldJob, onProgress: ProgressFn): SimHandle {
  if (backend.kind === "webgpu") {
    let stop = false;
    const result = runGpuJob(backend.device, job, onProgress, () => stop);
    return { cancel: () => (stop = true), result };
  }
  const worker = new CpuWorker();
  let finish: (r: FieldResult | null) => void = () => {};
  const result = new Promise<FieldResult | null>((resolve, reject) => {
    finish = resolve;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; fraction?: number; phase?: "settle" | "average"; result?: FieldResult; message?: string };
      if (m.type === "progress") onProgress(m.fraction!, m.phase!);
      else if (m.type === "done") {
        worker.terminate();
        resolve(m.result!);
      } else if (m.type === "error") {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
  });
  worker.postMessage({ type: "run", job });
  return {
    cancel() {
      worker.terminate();
      finish(null);
    },
    result,
  };
}
