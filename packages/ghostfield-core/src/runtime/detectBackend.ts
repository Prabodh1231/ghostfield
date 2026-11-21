/** Grid scale the apps should use on the CPU fallback (0.5 = half the cells per side). */
export const CPU_GRID_SCALE = 0.5;

export type BackendChoice =
  | { kind: "webgpu"; device: GPUDevice; adapter: GPUAdapter }
  | { kind: "cpu"; reason: string; gridScale: number };

/** Minimal shape of `navigator.gpu`, so a test can pass a fake. */
export interface GpuLike {
  requestAdapter(): Promise<GPUAdapter | null>;
}

/**
 * Pick the backend. WebGPU, unless there is no adapter or the adapter is a software fallback
 * (`isFallbackAdapter`); then the pure-TS solver, to be run in a Web Worker at `gridScale`.
 * No optional features and no raised limits are requested, so the default limits apply
 * (8 storage buffers per stage, which the shaders respect).
 * shortcut: the Web Worker host for the CPU solver is not in this module; the app starts it
 * when this returns kind "cpu".
 */
export async function detectBackend(gpu: GpuLike | undefined = (globalThis as { navigator?: { gpu?: GpuLike } }).navigator?.gpu): Promise<BackendChoice> {
  const cpu = (reason: string): BackendChoice => ({ kind: "cpu", reason, gridScale: CPU_GRID_SCALE });
  if (!gpu) return cpu("WebGPU not available");
  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (e) {
    return cpu(`requestAdapter failed: ${String(e)}`);
  }
  if (!adapter) return cpu("no WebGPU adapter");
  if (adapter.info?.isFallbackAdapter) return cpu("software fallback adapter");
  try {
    const device = await adapter.requestDevice();
    return { kind: "webgpu", device, adapter };
  } catch (e) {
    return cpu(`requestDevice failed: ${String(e)}`);
  }
}
