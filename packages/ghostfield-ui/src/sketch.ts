export class SketchError extends Error {}

export interface SketchResult {
  solid: Uint8Array;
  cols: number;
  rows: number;
  metresPerCell: number;
}
export interface SketchOptions {
  maxCols: number;
  maxRows: number;
  scale: { x1: number; y1: number; x2: number; y2: number; metres: number };
  minWallCells?: number;
  /**
   * Additive to the frozen API. Wanted cell size in metres (the sim's dx). If set, a room that needs
   * more than maxCols x maxRows cells is refused. If not set, the sketch is fitted to the grid.
   */
  cellMetres?: number;
}

const MAX_SIDE = 1024;
const MAX_DARK = 0.6;

/** Box-average gray image, capped at MAX_SIDE. Returns gray 0..255 and the shrink factor (<= 1). */
function toGray(img: ImageData): { g: Float32Array; w: number; h: number; k: number } {
  const { width: W, height: H, data } = img;
  const k = Math.min(1, MAX_SIDE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  const g = new Float32Array(w * h);
  const n = new Float32Array(w * h);
  for (let y = 0; y < H; y++) {
    const oy = Math.min(h - 1, Math.floor(y * k));
    for (let x = 0; x < W; x++) {
      const p = 4 * (y * W + x);
      const a = data[p + 3]! / 255;
      const lum = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
      const o = oy * w + Math.min(w - 1, Math.floor(x * k));
      g[o] = g[o]! + lum * a + 255 * (1 - a);
      n[o] = n[o]! + 1;
    }
  }
  for (let i = 0; i < g.length; i++) g[i] = n[i]! > 0 ? g[i]! / n[i]! : 255;
  return { g, w, h, k };
}

/** 1 where a pixel is darker than 85% of its local mean (window about 1/16 of the image). */
function adaptiveDark(g: Float32Array, w: number, h: number): Uint8Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x]!;
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1]! + row;
    }
  }
  const r = Math.max(4, Math.round(Math.min(w, h) / 32));
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * (w + 1) + x1]! - I[y0 * (w + 1) + x1]! - I[y1 * (w + 1) + x0]! + I[y0 * (w + 1) + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      // The extra 8 levels keep flat paper noise from turning into walls.
      if (g[y * w + x]! < mean * 0.85 - 8) dark[y * w + x] = 1;
    }
  }
  return dark;
}

/** Photo or scan of a paper sketch to a wall mask. Throws SketchError with a plain message. */
export function importSketch(img: ImageData, opts: SketchOptions): SketchResult {
  const { x1, y1, x2, y2, metres } = opts.scale;
  const distPx = Math.hypot(x2 - x1, y2 - y1);
  if (!(distPx >= 2) || !(metres > 0)) throw new SketchError("Click two different points and type the real distance between them.");
  const { g, w, h, k } = toGray(img);
  const dark = adaptiveDark(g, w, h);
  let nDark = 0;
  for (let i = 0; i < dark.length; i++) nDark += dark[i]!;
  if (nDark / dark.length > MAX_DARK) throw new SketchError("The picture is too dark to find walls. Try more light or a white page.");
  if (nDark === 0) throw new SketchError("No lines found. Draw the walls with a dark pen.");

  const mPerPx = metres / (distPx * k); // metres per processed pixel
  let cellPx: number;
  if (opts.cellMetres) {
    cellPx = opts.cellMetres / mPerPx;
    const needC = Math.ceil(w / cellPx);
    const needR = Math.ceil(h / cellPx);
    if (needC > opts.maxCols || needR > opts.maxRows) {
      throw new SketchError(
        `The room is too big: it needs ${needC} x ${needR} cells but the limit is ${opts.maxCols} x ${opts.maxRows}. Draw a smaller room or crop the picture.`,
      );
    }
  } else {
    cellPx = Math.max(w / opts.maxCols, h / opts.maxRows);
  }
  const cols = Math.max(1, Math.ceil(w / cellPx));
  const rows = Math.max(1, Math.ceil(h / cellPx));
  // Max-pool, so a 2-4 px pen line is never lost when cells are bigger than it.
  const solid = new Uint8Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(rows - 1, Math.floor(y / cellPx));
    for (let x = 0; x < w; x++) if (dark[y * w + x]) solid[cy * cols + Math.min(cols - 1, Math.floor(x / cellPx))] = 1;
  }
  // Thicken: grow every wall down and right so thin lines become at least minWallCells wide.
  const grow = Math.max(1, opts.minWallCells ?? 2) - 1;
  const out = Uint8Array.from(solid);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      if (solid[j * cols + i])
        for (let b = 0; b <= grow; b++) for (let a = 0; a <= grow; a++) if (i + a < cols && j + b < rows) out[(j + b) * cols + i + a] = 1;
  return { solid: out, cols, rows, metresPerCell: cellPx * mPerPx };
}

/** Draw the original photo under the map at 15% opacity by default. */
export function drawUnderlay(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, alpha = 0.15): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, 0, 0, w, h);
  ctx.restore();
}
