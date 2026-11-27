import { PALETTE } from "./palette";

export interface Afterglow {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  frame(src: CanvasImageSource): void;
  clear(): void;
  resize(w: number, h: number): void;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Trail effect on its own offscreen canvas, so React state is not touched per frame.
 * Each frame: fade old pixels toward the background by (1 - decay), then add the new frame (lighter blend).
 */
export function createAfterglow(w: number, h: number, decay = 0.94): Afterglow {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof document !== "undefined" ? Object.assign(document.createElement("canvas"), { width: w, height: h }) : new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d") as Ctx;
  const clear = () => {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  clear();
  return {
    canvas,
    frame(src) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1 - decay;
      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(src as CanvasImageSource & Parameters<Ctx["drawImage"]>[0], 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
    },
    clear,
    resize(nw, nh) {
      canvas.width = nw;
      canvas.height = nh;
      clear();
    },
  };
}
