/**
 * FROZEN API (round 7): type stubs for @ui. Apps import from "@ui". Implementations land in this
 * package later with the SAME signatures. No package.json; shared by Vite alias like @core.
 */

/** Palette tokens. `ramp(t)` maps t in 0..1 to [r,g,b] 0..255, from #05070B (0) to #38F2D6 (1). */
export declare const PALETTE: {
  readonly bg: "#05070B";
  readonly teal: "#38F2D6";
  readonly alert: "#FF3B5C";
};
export declare function ramp(t: number): [number, number, number];

/** Afterglow: draws `src` into an offscreen canvas that fades by `decay` (default 0.94) each call. */
export interface Afterglow {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Fade the old trail, then draw the new frame over it (lighter blend). */
  frame(src: CanvasImageSource): void;
  clear(): void;
  resize(w: number, h: number): void;
}
export declare function createAfterglow(w: number, h: number, decay?: number): Afterglow;

/** Click-to-ping thump. First call must come from a user gesture (click/key) so audio can start. */
export declare function thump(opts?: { volume?: number; pitchHz?: number }): void;

/** Paper-sketch importer. */
export interface SketchResult {
  /** 1 = wall. Length cols*rows. */
  solid: Uint8Array;
  cols: number;
  rows: number;
  /** Metres per grid cell, from the 2-click scale bar. */
  metresPerCell: number;
}
export interface SketchOptions {
  /** Target grid size in cells (the sketch is resampled to fit; larger is refused). */
  maxCols: number;
  maxRows: number;
  /** Two clicks on the picture in image pixels, and the real distance between them in metres. */
  scale: { x1: number; y1: number; x2: number; y2: number; metres: number };
  /** Cells per wall minimum. Default 2. */
  minWallCells?: number;
}
/** Throws SketchError with a plain message (too dark, room too big for the grid, bad scale). */
export declare class SketchError extends Error {}
export declare function importSketch(img: ImageData, opts: SketchOptions): SketchResult;
/** Draw the original photo under the map at 15% opacity (default). */
export declare function drawUnderlay(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, alpha?: number): void;
