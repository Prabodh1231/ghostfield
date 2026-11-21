import { describe, expect, it } from "vitest";
import { PARITY_TOLERANCE, runParity } from "../src/gpu/parity";

/**
 * CPU vs WebGPU parity. Headless WebGPU comes from the `webgpu` npm package (Dawn).
 * Skipped when no adapter exists (for example CI runners without a GPU or software Vulkan).
 * Browser version of the same check: parity/index.html.
 */
// Keep the Dawn instance and adapter referenced: if they are garbage collected, the process crashes.
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

describe("GPU vs CPU parity", () => {
  it("u matches within 1e-4 of peak in every scene", async (ctx) => {
    const device = await getDevice();
    if (!device) return ctx.skip();
    const results = await runParity(device);
    for (const r of results) console.log(`${r.name}: maxAbsDiff=${r.maxAbsDiff.toExponential(3)} peak=${r.peak.toExponential(3)} rel=${r.rel.toExponential(3)}`);
    for (const r of results) {
      expect(r.peak, r.name).toBeGreaterThan(1e-3);
      expect(r.rel, r.name).toBeLessThan(PARITY_TOLERANCE);
    }
  }, 120000);
});
