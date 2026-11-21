import { CPU_GRID_SCALE, detectBackend } from "@core/runtime/detectBackend";
import type { FieldJob, FieldResult } from "@core/runtime/cpuJob";
import type { ResponseJob, ResponseResult } from "@core/runtime/responseJob";
import { runGpuJob } from "@core/gpu/gpuJob";
import { runGpuResponse } from "@core/gpu/responseGpuJob";
import CpuWorker from "./cpu.worker?worker";
import { DX_GPU } from "./scene";

export type Backend =
  | { kind: "webgpu"; device: GPUDevice; dx: number }
  | { kind: "cpu"; reason: string; dx: number };

/** WebGPU if a real adapter exists, else the CPU solver in a Web Worker with cells twice as big (same room size). */
export async function pickBackend(): Promise<Backend> {
  const cpuDx = DX_GPU / CPU_GRID_SCALE;
  // "?backend=cpu" forces the fallback, to try it on a machine that has WebGPU.
  if (new URLSearchParams(location.search).get("backend") === "cpu") return { kind: "cpu", reason: "forced by ?backend=cpu", dx: cpuDx };
  const b = await detectBackend();
  return b.kind === "webgpu" ? { kind: "webgpu", device: b.device, dx: DX_GPU } : { kind: "cpu", reason: b.reason, dx: cpuDx };
}

export interface SimHandle<T> {
  cancel(): void;
  result: Promise<T | null>;
}
type Progress = (fraction: number) => void;

function viaGpu<T>(run: (cancelled: () => boolean) => Promise<T | null>): SimHandle<T> {
  let stop = false;
  return { cancel: () => (stop = true), result: run(() => stop) };
}

function viaWorker<T>(msg: { type: "field"; job: FieldJob } | { type: "response"; job: ResponseJob }, onProgress: Progress): SimHandle<T> {
  const worker = new CpuWorker();
  let finish: (r: T | null) => void = () => {};
  const result = new Promise<T | null>((resolve, reject) => {
    finish = resolve;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; fraction?: number; result?: T; message?: string };
      if (m.type === "progress") onProgress(m.fraction!);
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
  worker.postMessage(msg);
  return {
    cancel() {
      worker.terminate();
      finish(null);
    },
    result,
  };
}

export function startResponse(b: Backend, job: ResponseJob, onProgress: Progress): SimHandle<ResponseResult> {
  return b.kind === "webgpu" ? viaGpu((c) => runGpuResponse(b.device, job, onProgress, c)) : viaWorker({ type: "response", job }, onProgress);
}

export function startField(b: Backend, job: FieldJob, onProgress: Progress): SimHandle<FieldResult> {
  return b.kind === "webgpu" ? viaGpu((c) => runGpuJob(b.device, job, (f) => onProgress(f), c)) : viaWorker({ type: "field", job }, onProgress);
}
