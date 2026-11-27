import { buildCoefficients, DEFAULT_COURANT, type Material } from "@core/coefficients";
import type { FieldJob } from "@core/runtime/cpuJob";
import { makePlan } from "@core/runtime/sineSource";
import { AIR, C0, FREQ_HZ, materialFor, wallMaterial, type WallMaterialId } from "./materials";

/** Cell size, 1.0 cm, on every backend (12.5 cells per 2.4 GHz wavelength in air). */
export const CELL_M = 0.01;
/** Grid side in cells. The CPU fallback is half of that, so its room is 3.84 m instead of 7.68 m. */
export const GPU_GRID = 768;
export const CPU_GRID = 384;
/** Where the 16-cell CPML sits (inside the grid, along its outer edge). */
export const CPML_CELLS = 16;

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  material: WallMaterialId;
}

export interface Router {
  x: number;
  y: number;
}

/** Walls found in a photo of a paper plan (@ui importSketch). cols x rows cells, top-left of the grid, 1 = wall. */
export interface ImportedWalls {
  mask: Uint8Array;
  cols: number;
  rows: number;
}

export interface Scene {
  walls: Wall[];
  router: Router;
  imported?: ImportedWalls;
}

export interface BuiltJob {
  job: FieldJob;
  n: number;
  dx: number;
  /** Per-cell wall material index (0 = air, k+1 = WALL_ORDER[k]). */
  matIdx: Uint8Array;
}

export const WALL_ORDER: WallMaterialId[] = ["drywall", "glass", "wood", "brick", "concrete", "metal"];

function distToSegment(px: number, py: number, w: Wall): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / len2));
  return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy));
}

/**
 * Mark every cell whose centre is within half the wall thickness of the wall line. The thickness is
 * rounded to whole cells (at least 1), so a wall is 1 cell thick at the drawn thickness or less.
 * Cell centres are nudged by a hair so a wall lying exactly on a cell edge gets the same cell count as
 * any other. Later walls win. shortcut: staircase edges, and the cell count can be off by one for a
 * wall that is not on a cell edge or centre; fine for a relative map.
 */
export function rasterizeWalls(walls: Wall[], n: number, dx: number): Uint8Array {
  const idx = new Uint8Array(n * n);
  const eps = 1e-6 * dx;
  for (const w of walls) {
    const half = (Math.max(1, Math.round(wallMaterial(w.material).thickness / dx)) * dx) / 2;
    const code = WALL_ORDER.indexOf(w.material) + 1;
    const i0 = Math.max(0, Math.floor((Math.min(w.x1, w.x2) - half) / dx));
    const i1 = Math.min(n - 1, Math.ceil((Math.max(w.x1, w.x2) + half) / dx));
    const j0 = Math.max(0, Math.floor((Math.min(w.y1, w.y2) - half) / dx));
    const j1 = Math.min(n - 1, Math.ceil((Math.max(w.y1, w.y2) + half) / dx));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (distToSegment((i + 0.5) * dx + eps, (j + 0.5) * dx + eps, w) <= half) idx[j * n + i] = code;
      }
    }
  }
  return idx;
}
export interface BuildOptions {
  /** Replace the material of a wall type (used by the headless break check). */
  materialOf?: (id: WallMaterialId) => Material;
  /** Settle steps; default lets a wave cross the room about twice. */
  settleSteps?: number;
  averagePeriods?: number;
}

/** Turn a floor plan into a solver job on an n x n grid of CELL_M cells (room side n * CELL_M). */
export function buildJob(scene: Scene, n: number, opts: BuildOptions = {}): BuiltJob {
  const dx = CELL_M;
  const matIdx = rasterizeWalls(scene.walls, n, dx);
  // Imported plan walls count as brick. Cells outside the grid are dropped.
  if (scene.imported) {
    const { mask, cols, rows } = scene.imported;
    const brick = WALL_ORDER.indexOf("brick") + 1;
    for (let j = 0; j < Math.min(rows, n); j++) for (let i = 0; i < Math.min(cols, n); i++) if (mask[j * cols + i]) matIdx[j * n + i] = brick;
  }
  const table: Material[] = [AIR, ...WALL_ORDER.map((id) => (opts.materialOf ? opts.materialOf(id) : materialFor(id)))];
  // Fastest speed: free air (every material has C >= eps0 and L = mu0).
  const dt = (DEFAULT_COURANT * dx) / C0;
  const cs = buildCoefficients(n, n, dx, dt, (ix, iy) => table[matIdx[iy * n + ix]!]!);
  // sample at least 6 times per period, so the mean of u^2 is exact for a sine
  const spp = 1 / (FREQ_HZ * dt);
  const sampleEvery = Math.max(1, Math.floor(spp / 6));
  const plan = makePlan(FREQ_HZ, dt, opts.settleSteps ?? Math.round((2 * n) / DEFAULT_COURANT), opts.averagePeriods ?? 2, sampleEvery);
  const ix = Math.min(n - 1, Math.max(0, Math.floor(scene.router.x / dx)));
  const iy = Math.min(n - 1, Math.max(0, Math.floor(scene.router.y / dx)));
  const job: FieldJob = {
    cs,
    cpmlThickness: CPML_CELLS,
    sources: [{ ix, iy, freq: FREQ_HZ, amplitude: 1, rampPeriods: 6 }],
    plan,
  };
  return { job, n, dx, matIdx };
}

/** Mean power on a ring of radius 0.5 m around the router, wall cells skipped. Used as the 0 dB level. */
export function referencePower(power: Float32Array, built: BuiltJob, router: Router, radius = 0.5): number {
  const { n, dx, matIdx } = built;
  let sum = 0;
  let count = 0;
  const lo = radius - 1.5 * dx;
  const hi = radius + 1.5 * dx;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const r = Math.hypot((i + 0.5) * dx - router.x, (j + 0.5) * dx - router.y);
      if (r >= lo && r <= hi && matIdx[j * n + i] === 0) {
        sum += power[j * n + i]!;
        count++;
      }
    }
  }
  return count ? sum / count : 1;
}

/** Relative signal in dB: 10 log10(P / Pref), floored. */
export function toDb(power: Float32Array, ref: number, floorDb = -90): Float32Array {
  const out = new Float32Array(power.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(floorDb, 10 * Math.log10(Math.max(power[i]!, 1e-30) / ref));
  return out;
}

/** Example flat, in fractions of the room side so it fits both room sizes. */
export function defaultScene(roomM: number): Scene {
  const f = (v: number) => Math.round(v * roomM * 100) / 100;
  const w = (x1: number, y1: number, x2: number, y2: number, material: WallMaterialId): Wall => ({ x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2), material });
  return {
    router: { x: f(0.2), y: f(0.5) },
    walls: [
      w(0.42, 0.1, 0.42, 0.4, "brick"),
      w(0.42, 0.4, 0.42, 0.6, "glass"),
      w(0.42, 0.6, 0.42, 0.9, "brick"),
      w(0.65, 0.1, 0.65, 0.52, "drywall"),
      w(0.65, 0.68, 0.9, 0.68, "concrete"),
      w(0.75, 0.82, 0.88, 0.82, "metal"),
    ],
  };
}

/** Room names for the example flat, in fractions of the room side (text centre). Shown only while the plan is the example flat. */
export const EXAMPLE_LABELS: readonly { text: string; fx: number; fy: number }[] = [
  { text: "Living room", fx: 0.21, fy: 0.12 },
  { text: "Hall", fx: 0.535, fy: 0.05 },
  { text: "Bedroom", fx: 0.78, fy: 0.12 },
  { text: "Study", fx: 0.78, fy: 0.92 },
];

export type DeviceKind = "tv" | "phone" | "laptop";
export interface Device {
  kind: DeviceKind;
  /** Metres. Devices are visual only: the solver does not see them. */
  x: number;
  y: number;
}
/** Start spots in fractions of the room side. On the example flat the laptop sits in the red zone. */
export const DEFAULT_DEVICES: readonly { kind: DeviceKind; fx: number; fy: number }[] = [
  { kind: "tv", fx: 0.12, fy: 0.2 },
  { kind: "phone", fx: 0.53, fy: 0.5 },
  { kind: "laptop", fx: 0.9, fy: 0.86 },
];
export function defaultDevices(roomM: number): Device[] {
  return DEFAULT_DEVICES.map((d) => ({ kind: d.kind, x: d.fx * roomM, y: d.fy * roomM }));
}
