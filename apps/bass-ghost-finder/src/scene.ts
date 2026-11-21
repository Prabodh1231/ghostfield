import { DEFAULT_COURANT, buildCoefficients, dtFromCourant, type Material } from "@core/coefficients";
import type { FieldJob } from "@core/runtime/cpuJob";
import type { ResponseJob } from "@core/runtime/responseJob";
import { makePlan } from "@core/runtime/sineSource";

export const RHO0 = 1.2; // kg/m^3
export const C0 = 343; // m/s
export const F_MIN = 20;
export const F_MAX = 300;
/** Grid cell on WebGPU. The CPU fallback uses 5 cm cells (half the cells per side), same room size. */
export const DX_GPU = 0.025;
export const MAX_ROOM_M = 6.4; // 256 cells at 2.5 cm
export const MIN_ROOM_M = 1.5;

/** The only two traps. Rf = flow resistivity, Pa s/m^2. gamma_q = Rf / rho_eff (rho_eff = rho0, no tortuosity). */
export const TRAPS = {
  foam: { label: "5 cm PU foam", rf: 5000, thickness: 0.05 },
  chunk: { label: "60 cm corner superchunk", rf: 10000, leg: 0.6 },
} as const;
export type TrapType = keyof typeof TRAPS;
export type TrapRf = Record<TrapType, number>;
export const DEFAULT_RF: TrapRf = { foam: TRAPS.foam.rf, chunk: TRAPS.chunk.rf };

export const gammaQ = (rf: number, rhoEff = RHO0): number => rf / rhoEff;

export interface Pt {
  x: number;
  y: number;
}
/** Foam: a strip along the segment (x1,y1)-(x2,y2), snapped to horizontal or vertical. Chunk: dropped near (x1,y1), snaps to the nearest room corner. */
export interface Trap {
  type: TrapType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface Scene {
  shape: "rect" | "L";
  w: number;
  h: number;
  /** L-shape: size of the rectangle cut from the top-right corner. */
  notchW: number;
  notchH: number;
  traps: Trap[];
  sub: Pt;
  seat: Pt;
}

export function defaultScene(): Scene {
  return { shape: "rect", w: 5, h: 4, notchW: 2, notchH: 1.6, traps: [], sub: { x: 0.8, y: 3.2 }, seat: { x: 3.6, y: 1.2 } };
}

export interface Room {
  nx: number;
  ny: number;
  dx: number;
  /** 1 = outside the room (rigid). */
  solid: Uint8Array;
  /** Flow resistivity per cell, 0 = air. */
  rf: Float32Array;
}

export interface Corner {
  ix: number;
  iy: number;
  /** Direction from the cell towards the two walls. */
  sx: number;
  sy: number;
}

/** Air cells that sit in a concave corner: wall on one side in x, one side in y, and on the diagonal. */
export function cornerCells(nx: number, ny: number, solid: Uint8Array): Corner[] {
  const sol = (i: number, j: number) => i < 0 || j < 0 || i >= nx || j >= ny || solid[j * nx + i] === 1;
  const out: Corner[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (solid[j * nx + i]) continue;
      for (const sx of [-1, 1])
        for (const sy of [-1, 1]) if (sol(i + sx, j) && sol(i, j + sy) && sol(i + sx, j + sy)) out.push({ ix: i, iy: j, sx, sy });
    }
  return out;
}

const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function buildRoom(scene: Scene, dx: number, rfOf: TrapRf = DEFAULT_RF): Room {
  const nx = Math.round(clampI(scene.w, MIN_ROOM_M, MAX_ROOM_M) / dx);
  const ny = Math.round(clampI(scene.h, MIN_ROOM_M, MAX_ROOM_M) / dx);
  const solid = new Uint8Array(nx * ny);
  if (scene.shape === "L") {
    const a = Math.min(nx - 2, Math.round(scene.notchW / dx));
    const b = Math.min(ny - 2, Math.round(scene.notchH / dx));
    for (let j = 0; j < b; j++) for (let i = nx - a; i < nx; i++) solid[j * nx + i] = 1;
  }
  const rf = new Float32Array(nx * ny);
  const put = (i: number, j: number, v: number) => {
    if (i >= 0 && j >= 0 && i < nx && j < ny && !solid[j * nx + i] && v > rf[j * nx + i]!) rf[j * nx + i] = v;
  };
  const corners = cornerCells(nx, ny, solid);
  for (const t of scene.traps) {
    if (t.type === "foam") {
      const T = Math.max(1, Math.round(TRAPS.foam.thickness / dx));
      const horizontal = Math.abs(t.x2 - t.x1) >= Math.abs(t.y2 - t.y1);
      const a = Math.floor(Math.min(horizontal ? t.x1 : t.y1, horizontal ? t.x2 : t.y2) / dx);
      const b = Math.floor(Math.max(horizontal ? t.x1 : t.y1, horizontal ? t.x2 : t.y2) / dx);
      const c0 = Math.round((horizontal ? t.y1 : t.x1) / dx - T / 2);
      for (let s = a; s <= b; s++) for (let k = 0; k < T; k++) horizontal ? put(s, c0 + k, rfOf.foam) : put(c0 + k, s, rfOf.foam);
    } else {
      if (!corners.length) continue;
      const px = t.x1 / dx;
      const py = t.y1 / dx;
      let best = corners[0]!;
      let bd = Infinity;
      for (const c of corners) {
        const d = (c.ix + 0.5 - px) ** 2 + (c.iy + 0.5 - py) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      const L = Math.max(2, Math.round(TRAPS.chunk.leg / dx));
      // Triangle with legs L along the two walls. Cells step away from the walls (opposite of sx, sy).
      for (let a = 0; a < L; a++) for (let b = 0; a + b < L; b++) put(best.ix - best.sx * a, best.iy - best.sy * b, rfOf.chunk);
    }
  }
  return { nx, ny, dx, solid, rf };
}

/** Nearest air cell to (x, y) metres. */
export function airCell(room: Room, x: number, y: number): { ix: number; iy: number } {
  const ix0 = clampI(Math.floor(x / room.dx), 0, room.nx - 1);
  const iy0 = clampI(Math.floor(y / room.dx), 0, room.ny - 1);
  let best = { ix: ix0, iy: iy0 };
  let bd = Infinity;
  for (let j = 0; j < room.ny; j++)
    for (let i = 0; i < room.nx; i++) {
      if (room.solid[j * room.nx + i]) continue;
      const d = (i - ix0) ** 2 + (j - iy0) ** 2;
      if (d < bd) {
        bd = d;
        best = { ix: i, iy: j };
      }
    }
  return best;
}

export function isAir(room: Room, x: number, y: number): boolean {
  const i = Math.floor(x / room.dx);
  const j = Math.floor(y / room.dx);
  return i >= 0 && j >= 0 && i < room.nx && j < room.ny && !room.solid[j * room.nx + i];
}

export function makeMaterialAt(room: Room): (ix: number, iy: number) => Material {
  const C = 1 / (RHO0 * C0 * C0);
  return (ix, iy) => ({ C, L: RHO0, gammaU: 0, gammaQ: gammaQ(room.rf[iy * room.nx + ix]!) });
}

export function buildResponseJob(scene: Scene, dx: number, seconds: number, rfOf: TrapRf = DEFAULT_RF): { room: Room; job: ResponseJob } {
  const room = buildRoom(scene, dx, rfOf);
  const dt = dtFromCourant(DEFAULT_COURANT, dx, C0);
  const cs = buildCoefficients(room.nx, room.ny, dx, dt, makeMaterialAt(room));
  const s = airCell(room, scene.sub.x, scene.sub.y);
  const p = airCell(room, scene.seat.x, scene.seat.y);
  return { room, job: { cs, solid: room.solid, source: s, probe: p, steps: Math.round(seconds / dt), f0: 120 } };
}

export function buildFieldJob(scene: Scene, dx: number, freq: number, rfOf: TrapRf = DEFAULT_RF): { room: Room; job: FieldJob } {
  const room = buildRoom(scene, dx, rfOf);
  const dt = dtFromCourant(DEFAULT_COURANT, dx, C0);
  const cs = buildCoefficients(room.nx, room.ny, dx, dt, makeMaterialAt(room));
  const s = airCell(room, scene.sub.x, scene.sub.y);
  const spp = 1 / (freq * dt);
  const sampleEvery = Math.max(1, Math.floor(spp / 8));
  const settle = Math.round(0.5 / dt);
  return {
    room,
    job: {
      cs,
      cpmlThickness: 0,
      solid: room.solid,
      sources: [{ ix: s.ix, iy: s.iy, freq, amplitude: 1, rampPeriods: 3 }],
      plan: makePlan(freq, dt, settle, 2, sampleEvery),
    },
  };
}

export const FREQS: number[] = Array.from({ length: Math.round((F_MAX - F_MIN) / 0.5) + 1 }, (_, i) => F_MIN + i * 0.5);
