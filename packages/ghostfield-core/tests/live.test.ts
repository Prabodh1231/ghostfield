import { describe, expect, it } from "vitest";
import { CpuSolver } from "../src/cpu";
import { acousticCoefficients, acousticMaterial, createLiveSim, MAX_PULSES, rickerAt } from "../src/live";

const energy = (u: Float32Array) => u.reduce((a, v) => a + v * v, 0);
const keep: unknown[] = [];
async function getDevice(): Promise<GPUDevice | null> {
  try {
    const { create, globals } = await import("webgpu");
    Object.assign(globalThis, globals);
    const gpu = create([]);
    const adapter = await gpu.requestAdapter();
    keep.push(gpu, adapter);
    return adapter ? await adapter.requestDevice() : null;
  } catch {
    return null;
  }
}

const cs = () => acousticCoefficients(60, 40, 0.04);

describe("live sim", () => {
  it("CPU live equals a batch CpuSolver with the same pulse", () => {
    const c = cs();
    const live = createLiveSim({ cs: c, backend: "cpu" });
    live.addPulse(20, 20, 1);
    live.advance(150);
    const batch = new CpuSolver(c);
    batch.addSource({ ix: 20, iy: 20, value: (n, t) => (n === 0 ? 0 : rickerAt(400, (n - 1) * c.dt)) });
    batch.run(150);
    expect(energy(live.field())).toBeGreaterThan(0);
    expect(Math.abs(energy(live.field()) - energy(batch.u)) / energy(batch.u)).toBeLessThan(1e-6);
  });

  it("recycles pulse slots when more than MAX_PULSES are added", () => {
    const live = createLiveSim({ cs: cs(), backend: "cpu" });
    const slots = Array.from({ length: MAX_PULSES + 1 }, () => live.addPulse(10, 10, 1));
    expect(new Set(slots.slice(0, MAX_PULSES)).size).toBe(MAX_PULSES);
    expect(slots[MAX_PULSES]).toBe(slots[0]);
  });

  it("a solid wall edit blocks the wave; a porous edit removes energy", () => {
    const run = (edit: (s: ReturnType<typeof createLiveSim>) => void) => {
      const live = createLiveSim({ cs: cs(), backend: "cpu" });
      edit(live);
      live.addPulse(10, 20, 1);
      live.advance(120);
      return live.field();
    };
    const open = run(() => {});
    const walled = run((s) => { for (let j = 0; j < 40; j++) s.setSolid(30, j, true); });
    let right = 0;
    for (let j = 0; j < 40; j++) for (let i = 31; i < 60; i++) right += walled[j * 60 + i]! ** 2;
    expect(right).toBe(0);
    const porous = run((s) => { for (let j = 0; j < 40; j++) for (let i = 25; i < 30; i++) s.setMaterial(i, j, acousticMaterial(20000)); });
    expect(energy(porous)).toBeLessThan(energy(open));
  });

  it("GPU live matches CPU live", async (ctx) => {
    const device = await getDevice();
    if (!device) return ctx.skip();
    const c = cs();
    const cpu = createLiveSim({ cs: c, backend: "cpu" });
    const gpu = createLiveSim({ cs: c, backend: "gpu", device });
    for (const s of [cpu, gpu]) {
      s.setSolid(30, 10, true);
      s.addPulse(15, 20, 1);
      s.advance(100);
    }
    await new Promise((r) => setTimeout(r, 300));
    const a = cpu.field();
    const b = gpu.field();
    let peak = 0;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      peak = Math.max(peak, Math.abs(a[i]!));
      diff = Math.max(diff, Math.abs(a[i]! - b[i]!));
    }
    expect(peak).toBeGreaterThan(1e-4);
    expect(diff / peak).toBeLessThan(1e-3);
    gpu.destroy();
  }, 60000);
});
