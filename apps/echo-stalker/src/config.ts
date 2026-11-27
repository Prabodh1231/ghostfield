import { acousticMaterial, C0 } from "@core/live/acoustics";
import type { Material } from "@core/coefficients";

/** The world is always 16 x 9.6 m = 40 x 24 tiles of 0.4 m. Only the cell size changes with the backend. */
export const TILE_M = 0.4;
export const TILES_X = 40;
export const TILES_Y = 24;

export type Profile = {
  name: "gpu" | "cpu";
  /** Cell size in metres. */
  dx: number;
  /** Cells per tile side. */
  k: number;
  nx: number;
  ny: number;
  /** Simulated seconds per real second. */
  timeScale: number;
  /** Ricker peak frequency, Hz. */
  pulseHz: number;
  /** Pulse amplitude that gives a clap about 1.0 at 2 m (see tests/calibrate.test.ts). */
  clapAmp: number;
  /** Loss rate (1/s of simulated time) for u and q everywhere, so echoes die out. */
  airLoss: number;
  /** Flow resistivity of a stealth (porous) zone, Pa s/m^2. */
  zoneRf: number;
};

// GPU: 400 x 240 cells at 4 cm. CPU fallback: same room, 160 x 96 cells at 10 cm and a lower pitch,
// so the same levels fit (r7-core.md measured 160x100 at 4 cm, which would only cover 6.4 x 4 m).
export const GPU_PROFILE: Profile = { name: "gpu", dx: 0.04, k: 10, nx: 400, ny: 240, timeScale: 0.2, pulseHz: 400, clapAmp: 33, airLoss: 22, zoneRf: 3000 };
export const CPU_PROFILE: Profile = { name: "cpu", dx: 0.1, k: 4, nx: 160, ny: 96, timeScale: 0.25, pulseHz: 160, clapAmp: 22, airLoss: 22, zoneRf: 3000 };

/** Air with a little loss (so the room is not an endless echo chamber), optionally porous. */
export function airMaterial(p: Profile, rf = 0): Material {
  const m = acousticMaterial(rf);
  return { ...m, gammaU: p.airLoss, gammaQ: m.gammaQ + p.airLoss };
}

export const SOUND_SPEED = C0;
