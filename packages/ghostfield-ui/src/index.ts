/**
 * @ui: shared by Vite alias like @core. No package.json. Signatures were frozen in round 7;
 * the only addition is the optional SketchOptions.cellMetres.
 */
export { PALETTE, ramp } from "./palette";
export { createAfterglow, type Afterglow } from "./afterglow";
export { thump } from "./thump";
export { importSketch, drawUnderlay, SketchError, type SketchOptions, type SketchResult } from "./sketch";
