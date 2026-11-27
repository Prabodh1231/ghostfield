import { PALETTE, ramp, createAfterglow, drawUnderlay, type Afterglow } from "@ui";
import type { GameEvent, World } from "./world";

export const VIEW_W = 1280;
export const VIEW_H = 768;
/** Pixels per metre (the world is 16 x 9.6 m). */
export const PX = VIEW_W / 16;

const BG: [number, number, number] = [5, 7, 11];
/** Colour table: t in 0..255 to RGB, ramp minus the background so "nothing" adds nothing. */
const LUT = Array.from({ length: 256 }, (_, i) => {
  const c = ramp(i / 255);
  return [Math.max(0, c[0] - BG[0]), Math.max(0, c[1] - BG[1]), Math.max(0, c[2] - BG[2])] as const;
});

interface Ring {
  x: number;
  y: number;
  age: number;
  life: number;
  maxR: number;
  danger: boolean;
}

const mk = (w: number, h: number) => Object.assign(document.createElement("canvas"), { width: w, height: h });

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private waveCv: HTMLCanvasElement;
  private wallCv: HTMLCanvasElement;
  private waveImg: ImageData;
  private wallImg: ImageData;
  private glowAfter: Afterglow;
  private zoneLayer: HTMLCanvasElement;
  private rings: Ring[] = [];
  /** Optional picture of the user's sketch, drawn at 15%. */
  underlay: { img: CanvasImageSource; w: number; h: number } | null = null;
  showUnderlay = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private w: World,
  ) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    this.ctx = canvas.getContext("2d")!;
    const { nx, ny } = w;
    this.waveCv = mk(nx, ny);
    this.wallCv = mk(nx, ny);
    this.waveImg = this.waveCv.getContext("2d")!.createImageData(nx, ny);
    this.wallImg = this.wallCv.getContext("2d")!.createImageData(nx, ny);
    this.glowAfter = createAfterglow(nx, ny, 0.94);
    this.zoneLayer = this.buildZones();
  }

  /** Faint grey dots over the stealth zones. */
  private buildZones(): HTMLCanvasElement {
    const cv = mk(VIEW_W, VIEW_H);
    const c = cv.getContext("2d")!;
    const { nx, ny, level } = this.w;
    const sx = VIEW_W / nx;
    const sy = VIEW_H / ny;
    c.fillStyle = "#8a93a0";
    const step = 0.2 * PX; // a dot every 20 cm
    for (let y = 0; y < VIEW_H; y += step)
      for (let x = 0; x < VIEW_W; x += step) {
        const ix = Math.floor((x + step / 2) / sx);
        const iy = Math.floor((y + step / 2) / sy);
        if (level.porous[iy * nx + ix]) {
          c.beginPath();
          c.arc(x + step / 2, y + step / 2, 1.6, 0, 6.283);
          c.fill();
        }
      }
    return cv;
  }

  addEvents(evs: GameEvent[]) {
    for (const e of evs) {
      if (e.kind === "mstep") this.rings.push({ x: e.x, y: e.y, age: 0, life: 1.1, maxR: 1.6, danger: true });
      else if (e.kind === "clap") this.rings.push({ x: e.x, y: e.y, age: 0, life: 1.0, maxR: 4, danger: false });
      else if (e.kind === "pebble") this.rings.push({ x: e.x, y: e.y, age: 0, life: 0.8, maxR: 2.2, danger: false });
      else this.rings.push({ x: e.x, y: e.y, age: 0, life: 0.6, maxR: 0.9, danger: false });
    }
  }

  clearRings() {
    this.rings = [];
    this.glowAfter.clear();
  }

  draw(dt: number) {
    const w = this.w;
    const { nx, ny } = w;
    const ctx = this.ctx;

    // 1. waves (afterglow 0.94)
    const u = w.sim.field();
    const d = this.waveImg.data;
    for (let i = 0; i < nx * ny; i++) {
      const a = Math.min(1, Math.abs(u[i]!) * 0.8) ** 1.5 * 0.6;
      const c = LUT[(a * 255) | 0]!;
      d[4 * i] = c[0];
      d[4 * i + 1] = c[1];
      d[4 * i + 2] = c[2];
      d[4 * i + 3] = 255;
    }
    this.waveCv.getContext("2d")!.putImageData(this.waveImg, 0, 0);
    this.glowAfter.frame(this.waveCv);

    // 2. walls: only glowing cells are painted
    const wd = this.wallImg.data;
    wd.fill(0);
    const { cells } = w.surface;
    for (let i = 0; i < cells.length; i++) {
      const t = Math.min(1, Math.sqrt(w.glow[i]!) * 2.2);
      if (t < 0.02) continue;
      const c = LUT[(t * 255) | 0]!;
      const o = 4 * cells[i]!;
      wd[o] = c[0];
      wd[o + 1] = c[1];
      wd[o + 2] = c[2];
      wd[o + 3] = 255;
    }
    this.wallCv.getContext("2d")!.putImageData(this.wallImg, 0, 0);

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (this.showUnderlay && this.underlay) drawUnderlay(ctx, this.underlay.img, VIEW_W, VIEW_H, 0.15);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(this.glowAfter.canvas as CanvasImageSource, 0, 0, VIEW_W, VIEW_H);
    ctx.drawImage(this.wallCv, 0, 0, VIEW_W, VIEW_H);
    ctx.globalCompositeOperation = "source-over";

    // 3. stealth zones, faint
    ctx.globalAlpha = 0.35;
    ctx.drawImage(this.zoneLayer, 0, 0);
    ctx.globalAlpha = 1;

    // 4. exit: a slow faint pulse
    const [ex, ey] = w.level.exit;
    const pulse = 0.5 + 0.5 * Math.sin(w.time * 2.4);
    ctx.strokeStyle = PALETTE.teal;
    ctx.globalAlpha = 0.12 + 0.18 * pulse;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ex * PX, ey * PX, (0.35 + 0.35 * pulse) * PX, 0, 6.283);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(ex * PX, ey * PX, 0.12 * PX, 0, 6.283);
    ctx.fillStyle = PALETTE.teal;
    ctx.fill();
    ctx.globalAlpha = 1;

    // 5. rings (also show on a muted video): teal thin = you, red thick dashed = the monster
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);
    for (const r of this.rings) {
      const k = r.age / r.life;
      ctx.globalAlpha = (1 - k) * (r.danger ? 0.9 : 0.5);
      ctx.strokeStyle = r.danger ? PALETTE.alert : PALETTE.teal;
      ctx.lineWidth = r.danger ? 4 : 2;
      ctx.setLineDash(r.danger ? [10, 7] : []);
      ctx.beginPath();
      ctx.arc(r.x * PX, r.y * PX, (0.15 + k * r.maxR) * PX, 0, 6.283);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // 6. monsters: seen only as a flash when a wave passes over them
    for (const m of w.monsters) {
      const ix = Math.floor(m.x / w.dx);
      const iy = Math.floor(m.y / w.dx);
      const a = Math.min(1, Math.abs(u[iy * nx + ix] ?? 0) * 3);
      if (a < 0.05) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = PALETTE.alert;
      ctx.beginPath();
      ctx.arc(m.x * PX, m.y * PX, 0.28 * PX, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 7. you: a small dim dot
    ctx.fillStyle = PALETTE.teal;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(w.px * PX, w.py * PX, 0.14 * PX, 0, 6.283);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
