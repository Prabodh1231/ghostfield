import { describe, expect, it } from "vitest";
import { DEFAULT_COURANT, buildCoefficients, dtFromCourant, type Material } from "../src/coefficients";
import { runGpuResponse } from "../src/gpu/responseGpuJob";
import { responseSpectrum, runCpuResponse, type ResponseJob } from "../src/runtime/responseJob";

/** Small closed room: the response peaks at the (1,0) mode, and the GPU job matches the CPU job (skipped without WebGPU). */
const keepAlive: unknown[] = [];
async function getDevice(): Promise<GPUDevice | null> {
  try {
    const { create, globals } = await import("webgpu");
    Object.assign(globalThis, globals);
    const gpu = create([]);
    const adapter = await gpu.requestAdapter();
    keepAlive.push(gpu, adapter);
    return adapter ? await adapter.requestDevice() : null;
  } catch {
    return null;
  }
}

const NX = 64;
const NY = 40;
const DX = 0.05;
const air: Material = { C: 1 / (1.2 * 343 * 343), L: 1.2, gammaU: 0, gammaQ: 0 };
const dt = dtFromCourant(DEFAULT_COURANT, DX, 343);
const job: ResponseJob = {
  cs: buildCoefficients(NX, NY, DX, dt, () => air),
  source: { ix: 10, iy: 12 },
  probe: { ix: 50, iy: 30 },
  steps: Math.round(1.5 / dt),
  f0: 120,
};

describe("response job", () => {
  it("CPU response peaks at the (1,0) mode within 1%", () => {
    const r = runCpuResponse(job)!;
    const f10 = 343 / (2 * NX * DX);
    const freqs: number[] = [];
    for (let f = f10 * 0.9; f <= f10 * 1.1; f += 0.05) freqs.push(f);
    const h = responseSpectrum(r, freqs);
    let k = 0;
    for (let i = 1; i < h.length; i++) if (h[i]! > h[k]!) k = i;
    expect(Math.abs(freqs[k]! - f10) / f10).toBeLessThan(0.01);
  });

  it("GPU matches CPU", async (ctx) => {
    const device = await getDevice();
    if (!device) return ctx.skip();
    const cpu = runCpuResponse(job)!;
    const gpu = (await runGpuResponse(device, job, undefined, undefined, 100))!;
    let peak = 0;
    let diff = 0;
    for (let i = 0; i < cpu.probe.length; i++) {
      peak = Math.max(peak, Math.abs(cpu.probe[i]!));
      diff = Math.max(diff, Math.abs(cpu.probe[i]! - gpu.probe[i]!));
    }
    console.log(`response parity: max diff / peak = ${(diff / peak).toExponential(2)}`);
    expect(diff / peak).toBeLessThan(1e-3);
  }, 120000);
});
