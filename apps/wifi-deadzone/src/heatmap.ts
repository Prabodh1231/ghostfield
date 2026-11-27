import { ramp } from "@ui/index";
import { CPML_CELLS } from "./scene";

/** Colour scale for the relative signal in dB: dark = weak, bright teal = strong. Alert red stripes = dead. */
export const DB_MIN = -60;
export const DB_MAX = 0;
/** Below this the spot counts as dead (same limit as the "dead" word under the cursor). */
export const DEAD_DB = -30;

const ALERT = [0xff, 0x3b, 0x5c] as const;

export function dbToRgb(db: number): [number, number, number] {
  // Cubed, so the middle of the range is not all bright teal.
  const t = Math.min(1, Math.max(0, (db - DB_MIN) / (DB_MAX - DB_MIN)));
  return ramp(t * t * t);
}

/** Paint an n x n dB field into a canvas of n x n pixels. Dead spots get diagonal red stripes (a shape, not only a colour). */
export function paintHeatmap(canvas: HTMLCanvasElement, db: Float32Array, n: number): void {
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const v = db[k]!;
      // The absorbing edge layer is always quiet; it is not a dead zone.
      const inside = i >= CPML_CELLS && j >= CPML_CELLS && i < n - CPML_CELLS && j < n - CPML_CELLS;
      const stripe = inside && v < DEAD_DB && ((i + j) >> 2) % 2 === 0;
      const [r, g, b] = stripe ? ALERT : dbToRgb(v);
      img.data[4 * k] = r;
      img.data[4 * k + 1] = g;
      img.data[4 * k + 2] = b;
      img.data[4 * k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** CSS gradient for the legend bar: the same ramp the map uses. */
export function legendGradient(): string {
  const parts: string[] = [];
  for (let k = 0; k <= 10; k++) {
    const [r, g, b] = dbToRgb(DB_MIN + ((DB_MAX - DB_MIN) * k) / 10);
    parts.push(`rgb(${r},${g},${b}) ${k * 10}%`);
  }
  return `linear-gradient(to right, ${parts.join(",")})`;
}
