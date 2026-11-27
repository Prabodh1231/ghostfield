import { ramp } from "@ui/index";
import { CPML_CELLS } from "./scene";

/** Colour scale for the relative signal in dB: dark = weak, bright teal = strong. Alert red stripes = no signal. */
export const DB_MIN = -60;
export const DB_MAX = 0;
/** At or below this the spot counts as "None" (same limit as the word under a device). */
export const DEAD_DB = -30;
/** Smoothing radius in cells (half a Wi-Fi wavelength is about 6 cells), so ripples average out. */
export const SMOOTH_R = 6;
/** A no-signal patch smaller than this (cells, about 0.04 m^2) or thinner than MIN_BLOB_SIDE is noise, not a dead zone. */
const MIN_BLOB_CELLS = 400;
const MIN_BLOB_SIDE = 15;

const ALERT = [0xff, 0x3b, 0x5c] as const;

export function dbToRgb(db: number): [number, number, number] {
  // Cubed, so the middle of the range is not all bright teal.
  const t = Math.min(1, Math.max(0, (db - DB_MIN) / (DB_MAX - DB_MIN)));
  return ramp(t * t * t);
}

/** Level of a device: 3 Great, 2 OK, 1 Weak, 0 None. */
export function levelOf(db: number): 0 | 1 | 2 | 3 {
  return db > -10 ? 3 : db > -20 ? 2 : db > DEAD_DB ? 1 : 0;
}
export const LEVEL_WORDS = ["None", "Weak", "OK", "Great"] as const;
export function levelWord(db: number): string {
  return LEVEL_WORDS[levelOf(db)]!;
}

/** Box average of an n x n field over a (2r+1) square (clipped at the edges), via an integral image. O(n^2). */
export function smoothPower(power: Float32Array, n: number, r: number = SMOOTH_R): Float32Array {
  const w = n + 1;
  const sat = new Float64Array(w * w);
  for (let j = 0; j < n; j++) {
    let row = 0;
    for (let i = 0; i < n; i++) {
      row += power[j * n + i]!;
      sat[(j + 1) * w + i + 1] = sat[j * w + i + 1]! + row;
    }
  }
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const j0 = Math.max(0, j - r);
    const j1 = Math.min(n, j + r + 1);
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - r);
      const i1 = Math.min(n, i + r + 1);
      const sum = sat[j1 * w + i1]! - sat[j0 * w + i1]! - sat[j1 * w + i0]! + sat[j0 * w + i0]!;
      out[j * n + i] = sum / ((i1 - i0) * (j1 - j0));
    }
  }
  return out;
}

export interface DeadBlob {
  /** Centre in cells. */
  cx: number;
  cy: number;
  area: number;
}
export interface DeadZones {
  /** 1 for cells that belong to a real no-signal patch. */
  mask: Uint8Array;
  /** Largest first. */
  blobs: DeadBlob[];
}

/** One flood-fill pass over the cells at or below DEAD_DB, inside the edge layer. Small and thin patches are dropped. */
export function findDeadZones(db: Float32Array, n: number): DeadZones {
  const mask = new Uint8Array(n * n);
  const seen = new Uint8Array(n * n);
  const blobs: DeadBlob[] = [];
  const lo = CPML_CELLS;
  const hi = n - CPML_CELLS;
  const stack: number[] = [];
  for (let j0 = lo; j0 < hi; j0++) {
    for (let i0 = lo; i0 < hi; i0++) {
      const s = j0 * n + i0;
      if (seen[s] || db[s]! > DEAD_DB) continue;
      const cells: number[] = [];
      let sx = 0;
      let sy = 0;
      let minI = i0;
      let maxI = i0;
      let minJ = j0;
      let maxJ = j0;
      seen[s] = 1;
      stack.push(s);
      while (stack.length) {
        const k = stack.pop()!;
        const i = k % n;
        const j = (k - i) / n;
        cells.push(k);
        sx += i;
        sy += j;
        if (i < minI) minI = i;
        if (i > maxI) maxI = i;
        if (j < minJ) minJ = j;
        if (j > maxJ) maxJ = j;
        for (const q of [k - 1, k + 1, k - n, k + n]) {
          const qi = q % n;
          const qj = (q - qi) / n;
          if (qi < lo || qj < lo || qi >= hi || qj >= hi || seen[q] || db[q]! > DEAD_DB) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
      if (cells.length >= MIN_BLOB_CELLS && Math.min(maxI - minI, maxJ - minJ) + 1 >= MIN_BLOB_SIDE) {
        for (const k of cells) mask[k] = 1;
        blobs.push({ cx: sx / cells.length, cy: sy / cells.length, area: cells.length });
      }
    }
  }
  blobs.sort((a, b) => b.area - a.area);
  return { mask, blobs };
}

/**
 * Paint an n x n dB field into a canvas of n x n pixels. Real no-signal patches get diagonal red stripes
 * (55%, a shape and not only a colour). Thin white lines mark the Great / OK / Weak / None borders.
 */
export function paintHeatmap(canvas: HTMLCanvasElement, db: Float32Array, n: number, dead?: Uint8Array): void {
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const v = db[k]!;
      let [r, g, b] = dbToRgb(v);
      if (dead && dead[k] && ((i + j) >> 2) % 2 === 0) {
        r = r * 0.45 + ALERT[0] * 0.55;
        g = g * 0.45 + ALERT[1] * 0.55;
        b = b * 0.45 + ALERT[2] * 0.55;
      }
      // The absorbing edge layer is always quiet; draw no border lines there.
      const inside = i >= CPML_CELLS && j >= CPML_CELLS && i < n - CPML_CELLS - 1 && j < n - CPML_CELLS - 1;
      if (inside) {
        const l = levelOf(v);
        if (l !== levelOf(db[k + 1]!) || l !== levelOf(db[k + n]!)) {
          r = r * 0.75 + 255 * 0.25;
          g = g * 0.75 + 255 * 0.25;
          b = b * 0.75 + 255 * 0.25;
        }
      }
      img.data[4 * k] = r;
      img.data[4 * k + 1] = g;
      img.data[4 * k + 2] = b;
      img.data[4 * k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** First-paint "rough guess": a plain teal glow around the router (35%), no solver. */
export function paintGuess(canvas: HTMLCanvasElement, fx: number, fy: number): void {
  const s = 256;
  canvas.width = s;
  canvas.height = s;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#05070b";
  g.fillRect(0, 0, s, s);
  const grad = g.createRadialGradient(fx * s, fy * s, 0, fx * s, fy * s, s * 0.7);
  grad.addColorStop(0, "rgba(56,242,214,0.35)");
  grad.addColorStop(1, "rgba(56,242,214,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
}
