import { buildCoefficients, DEFAULT_COURANT, dtFromCourant, type Material } from "../coefficients";
import { Cpml, CpuSolver, composeBoundaries, rigidWalls, type Boundary } from "../cpu";
import { GpuSolver } from "./gpuSolver";

/** Shared by the Vitest parity test and the browser page (parity/index.html). */

export interface ParityCase {
  name: string;
  steps: number;
  /** max |u_gpu - u_cpu| over the final field and all probe samples. */
  maxAbsDiff: number;
  /** max |u_cpu| over the same samples. */
  peak: number;
  /** maxAbsDiff / peak. */
  rel: number;
}

export const PARITY_TOLERANCE = 1e-4;

const AIR: Material = { C: 1, L: 1, gammaU: 0, gammaQ: 0 };

function ricker(f0: number) {
  const t0 = 1.5 / f0;
  return (_n: number, t: number) => {
    const a = (Math.PI * f0 * (t - t0)) ** 2;
    return (1 - 2 * a) * Math.exp(-a);
  };
}

interface Scene {
  name: string;
  cpml: boolean;
  walls: boolean;
}

/** 64x64 scenes, unit-normalised (dx = 1, c = 1 in air). Mixed C and loss so A, B differ per cell. */
const SCENES: Scene[] = [
  { name: "rigid room + inner wall + lossy patch", cpml: false, walls: true },
  { name: "CPML (T=8) + dense lossy patch", cpml: true, walls: false },
  { name: "CPML + inner wall", cpml: true, walls: true },
];

export async function runParity(device: GPUDevice, steps = 300, n = 64): Promise<ParityCase[]> {
  const out: ParityCase[] = [];
  for (const sc of SCENES) {
    const material = (i: number, j: number): Material => {
      if (i >= 40 && i < 52 && j >= 36 && j < 52) return { C: 2, L: 1, gammaU: 0.02, gammaQ: 0.03 };
      if (i < 20 && j < 20) return { C: 1, L: 1.5, gammaU: 0, gammaQ: 0.01 };
      return AIR;
    };
    let minC = Infinity;
    let minL = Infinity;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const m = material(i, j);
        minC = Math.min(minC, m.C);
        minL = Math.min(minL, m.L);
      }
    const dt = dtFromCourant(DEFAULT_COURANT, 1, 1 / Math.sqrt(minC * minL));
    const cs = buildCoefficients(n, n, 1, dt, material);
    const solid = new Uint8Array(n * n);
    if (sc.walls) for (let j = 0; j < 40; j++) solid[j * n + 32] = 1;
    const cpml = sc.cpml ? new Cpml(cs, { thickness: 8 }) : undefined;
    const parts: Boundary[] = [];
    if (cpml) parts.push(cpml);
    if (sc.walls) parts.push(rigidWalls(n, n, solid));
    const cpu = new CpuSolver(cs, composeBoundaries(...parts));
    const gpu = new GpuSolver(device, cs, { cpml, solid: sc.walls ? solid : undefined });
    const src = { ix: 12, iy: 28, value: ricker(0.1) };
    for (const s of [cpu, gpu]) {
      s.addSource({ ...src });
      s.addSource({ ix: 50, iy: 10, value: (k, t) => -0.5 * src.value(k, t) });
    }
    const probeCells: Array<[number, number]> = [[24, 28], [45, 44], [5, 5], [60, 60]];
    const cp = probeCells.map(([x, y]) => cpu.addProbe(x, y));
    const gp = probeCells.map(([x, y]) => gpu.addProbe(x, y));
    cpu.run(steps);
    await gpu.run(steps);
    const gu = await gpu.readU();
    gpu.destroy();
    let diff = 0;
    let peak = 0;
    const acc = (a: number, b: number) => {
      diff = Math.max(diff, Math.abs(a - b));
      peak = Math.max(peak, Math.abs(a));
    };
    for (let k = 0; k < gu.length; k++) acc(cpu.u[k]!, gu[k]!);
    for (let p = 0; p < cp.length; p++) for (let s = 0; s < steps; s++) acc(cp[p]!.samples[s]!, gp[p]!.samples[s]!);
    out.push({ name: sc.name, steps, maxAbsDiff: diff, peak, rel: peak > 0 ? diff / peak : Infinity });
  }
  return out;
}
