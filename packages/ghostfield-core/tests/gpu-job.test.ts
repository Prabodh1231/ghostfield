import { describe, expect, it } from "vitest";
import { buildCoefficients } from "../src/coefficients";
import { runGpuJob } from "../src/gpu/gpuJob";
import { runCpuJob, type FieldJob } from "../src/runtime/cpuJob";
import { makePlan } from "../src/runtime/sineSource";
import type { Material } from "../src/coefficients";

/**
 * runGpuJob (batched submits, u read back for averaging) vs runCpuJob on a small CW scene with CPML,
 * a lossy block and a dense block. Skipped when there is no WebGPU adapter.
 */
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

describe("GPU job vs CPU job (time-averaged u^2)", () => {
  it("matches within 1e-3 of the peak", async (ctx) => {
    const device = await getDevice();
    if (!device) return ctx.skip();
    // Normalised units: dx = 1, c = 1 in air, f chosen for 20 steps per period.
    const n = 96;
    const air: Material = { C: 1, L: 1, gammaU: 0, gammaQ: 0 };
    const mat = (i: number, j: number): Material =>
      i >= 55 && i < 60 && j >= 30 && j < 60 ? { C: 1, L: 1, gammaU: 0.5, gammaQ: 0 } : i >= 30 && i < 40 && j >= 60 && j < 70 ? { C: 3, L: 1, gammaU: 0, gammaQ: 0 } : air;
    const dt = 0.693;
    const cs = buildCoefficients(n, n, 1, dt, mat);
    const freq = 1 / (20 * dt);
    const job: FieldJob = {
      cs,
      cpmlThickness: 12,
      sources: [{ ix: 25, iy: 45, freq, amplitude: 1, rampPeriods: 3 }],
      plan: makePlan(freq, dt, 200, 2, 3),
    };
    const cpu = runCpuJob(job)!;
    const gpu = (await runGpuJob(device, job, undefined, undefined, 40))!;
    let peak = 0;
    let diff = 0;
    for (let i = 0; i < cpu.power.length; i++) {
      peak = Math.max(peak, cpu.power[i]!);
      diff = Math.max(diff, Math.abs(cpu.power[i]! - gpu.power[i]!));
    }
    console.log(`job parity: max |P_gpu - P_cpu| = ${diff.toExponential(3)}, peak = ${peak.toExponential(3)}, rel = ${(diff / peak).toExponential(3)}`);
    expect(peak).toBeGreaterThan(1e-4);
    expect(diff / peak).toBeLessThan(1e-3);
  }, 120000);
});
