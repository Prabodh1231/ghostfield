import { PALETTE, ramp, createAfterglow, drawUnderlay, type Afterglow } from "@ui";
import { doorDone, doorIsVertical, drawDoor, drawMonster, drawPlayer, drawPrint, PRINT_GAP, stepDoor, turnToward } from "./sprites";
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
  /** Set by the page each frame: Shift is held. */
  sneaking = false;
  /** Door openness 0..1; it opens once the player reaches it. */
  doorOpen = 0;
  private doorHeld = 0;
  private doorVertical: boolean;
  private calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  private face: [number, number] = [1, 0];
  private lastP: [number, number];
  private walkPhase = 0;
  private walking = false;
  private walked = 0;
  private prints: { x: number; y: number; ang: number; left: boolean; age: number }[] = [];
  private alarm: number[] = [];
  private wasHunting: boolean[] = [];

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
    this.doorVertical = doorIsVertical((x, y) => w.solidAt(x, y), w.level.exit[0], w.level.exit[1]);
    this.lastP = [w.px, w.py];
  }

  /** True when the door has swung open and been held a moment: the page may show the win screen. */
  get doorFinished(): boolean {
    return doorDone(this.doorOpen, this.doorHeld);
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

    // 4. exit door: dark like the walls, lit by wave hits, with a faint teal glow at its foot
    const [ex, ey] = w.level.exit;
    this.doorOpen = stepDoor(this.doorOpen, dt, w.status === "won", this.calm);
    if (this.doorOpen >= 1) this.doorHeld += dt;
    const eu = Math.abs(u[Math.floor(ey / w.dx) * nx + Math.floor(ex / w.dx)] ?? 0);
    drawDoor(ctx, ex * PX, ey * PX, PX, { vertical: this.doorVertical, lit: Math.min(1, eu * 3), open: this.doorOpen, time: w.time, calm: this.calm });

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

    // 6. monsters: the body shows only when a wave passes over it; the eyes flare when it hunts
    w.monsters.forEach((m, i) => {
      const ix = Math.floor(m.x / w.dx);
      const iy = Math.floor(m.y / w.dx);
      const seen = Math.min(1, Math.abs(u[iy * nx + ix] ?? 0) * 3);
      if (m.hunting && !this.wasHunting[i]) this.alarm[i] = 1;
      this.wasHunting[i] = m.hunting;
      const al = this.alarm[i] ?? 0;
      this.alarm[i] = Math.max(0, al - dt * 1.4);
      if (al > 0) {
        // "it heard you": a red ring shrinks onto the monster
        ctx.globalAlpha = al * 0.8;
        ctx.strokeStyle = PALETTE.alert;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(m.x * PX, m.y * PX, (0.3 + 0.9 * al) * PX, 0, 6.283);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      drawMonster(ctx, m.x * PX, m.y * PX, PX, { hx: m.hx, hy: m.hy, time: w.time, hunting: m.hunting, seen: seen < 0.05 ? 0 : seen, alarm: al, calm: this.calm, seed: i * 1.9 });
    });

    // 7. you: a hooded figure with a lantern, turning to face where you walk
    const mvx = w.px - this.lastP[0];
    const mvy = w.py - this.lastP[1];
    const mv = Math.hypot(mvx, mvy);
    this.walking = mv > 1e-4;
    if (this.walking) {
      this.face = turnToward(this.face[0], this.face[1], mvx / mv, mvy / mv, 1 - Math.exp(-dt * 14));
      this.walkPhase += dt * (this.sneaking ? 0.5 : 1);
      this.walked += mv;
      if (this.walked >= PRINT_GAP) {
        this.walked -= PRINT_GAP;
        this.prints.push({ x: w.px, y: w.py, ang: Math.atan2(mvy, mvx), left: this.prints.length % 2 === 0, age: 0 });
      }
    }
    this.lastP = [w.px, w.py];
    for (const p of this.prints) p.age += dt;
    this.prints = this.prints.filter((p) => p.age < 3.5);
    for (const p of this.prints) drawPrint(ctx, p.x * PX, p.y * PX, PX, p.ang, p.left, 0.4 * (1 - p.age / 3.5));
    drawPlayer(ctx, w.px * PX, w.py * PX, PX, { hx: this.face[0], hy: this.face[1], walking: this.walking, sneaking: this.sneaking, phase: this.walkPhase, calm: this.calm });
  }
}
