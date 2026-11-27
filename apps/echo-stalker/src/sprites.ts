/**
 * Small hand-drawn sprites for Echo Stalker: the player, the monster and the exit door.
 * Pure Canvas 2D paths, no images. All sizes are in pixels; the caller passes `px` (pixels per metre).
 * Every moving part takes `calm`: true when the user asked for reduced motion (no bob, twitch or swing).
 */

const TEAL = "#38F2D6";
const ALERT = "#FF3B5C";

/** Seconds the door takes to swing open. */
export const DOOR_OPEN_S = 0.7;
/** Pause after the door is fully open, before the win screen. */
export const DOOR_HOLD_S = 0.35;

/** Door openness 0 (closed) .. 1 (open). Opens while `opening`; with `calm` it jumps straight to open. */
export function stepDoor(open: number, dt: number, opening: boolean, calm: boolean): number {
  if (!opening) return 0;
  if (calm) return 1;
  return Math.min(1, open + dt / DOOR_OPEN_S);
}

/** Smooth-step of openness, so the swing starts and ends gently. */
export const doorEase = (open: number): number => open * open * (3 - 2 * open);

/** Angle of the door leaf in radians: 0 closed, about 85 degrees open. */
export const doorAngle = (open: number): number => doorEase(open) * 1.48;

/** True once the door is open and has been held long enough for the win screen. */
export const doorDone = (open: number, held: number): boolean => open >= 1 && held >= DOOR_HOLD_S;

/** Footprint spacing in metres. */
export const PRINT_GAP = 0.45;

export interface DoorLook {
  /** Door runs up and down (a wall on its left or right), else side to side. */
  vertical: boolean;
  /** 0..1 how brightly the frame is lit (wave hits). */
  lit: number;
  open: number;
  time: number;
  calm: boolean;
}

/** Which way the door faces: it lies along the nearest wall. `solid(x, y)` takes metres. */
export function doorIsVertical(solid: (x: number, y: number) => boolean, x: number, y: number): boolean {
  for (let d = 0.2; d <= 2.5; d += 0.1) {
    const side = solid(x - d, y) || solid(x + d, y);
    const upDown = solid(x, y - d) || solid(x, y + d);
    if (side !== upDown) return side;
    if (side && upDown) return true;
  }
  return true;
}

export function drawDoor(ctx: CanvasRenderingContext2D, cx: number, cy: number, px: number, k: DoorLook) {
  const half = 0.45 * px; // half of the doorway width
  const post = 0.09 * px;
  const pulse = 0.5 + 0.5 * Math.sin(k.time * 2.4);
  ctx.save();
  ctx.translate(cx, cy);
  if (!k.vertical) ctx.rotate(-Math.PI / 2);
  // Local frame: the door lies along y, the player comes from the left (-x).

  // faint teal light under the door, found even in the dark
  const spill = 0.5 + 0.5 * doorEase(k.open);
  const g = ctx.createLinearGradient(0, 0, 0.9 * px * spill, 0);
  g.addColorStop(0, "rgba(56,242,214,0.55)");
  g.addColorStop(1, "rgba(56,242,214,0)");
  ctx.globalAlpha = (0.22 + (k.calm ? 0.1 : 0.12 * pulse)) + 0.6 * doorEase(k.open);
  ctx.fillStyle = g;
  ctx.fillRect(0, -half, 0.9 * px * spill, half * 2);
  ctx.globalAlpha = 1;

  // frame posts and lintel, lit by wave hits
  const a = Math.min(1, 0.28 + k.lit * 0.9 + 0.4 * doorEase(k.open));
  ctx.globalAlpha = a;
  ctx.fillStyle = "#0d1f24";
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = 2;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.rect(-post, s * half - (s > 0 ? 0 : post), post * 2, post);
    ctx.fill();
    ctx.stroke();
  }
  // the dark opening behind a swung door
  ctx.globalAlpha = a * 0.9;
  ctx.fillStyle = "#06141a";
  ctx.fillRect(-post * 0.5, -half, post, half * 2);

  // the leaf: hinged on the top post, swings toward the player
  ctx.translate(0, -half);
  ctx.rotate(-doorAngle(k.open));
  ctx.globalAlpha = a;
  ctx.fillStyle = "#12343a";
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(-post * 0.45, 0, post * 0.9, half * 2);
  ctx.fill();
  ctx.stroke();
  // handle
  ctx.fillStyle = TEAL;
  ctx.beginPath();
  ctx.arc(0, half * 1.7, 2.2, 0, 6.283);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

export interface PlayerLook {
  /** Facing, unit vector. */
  hx: number;
  hy: number;
  walking: boolean;
  sneaking: boolean;
  /** Seconds of walking, drives the bob. */
  phase: number;
  calm: boolean;
}

/** Facing a heading `h` turns toward the wanted one by `rate` * dt, as a unit vector. */
export function turnToward(hx: number, hy: number, wx: number, wy: number, k: number): [number, number] {
  const x = hx + (wx - hx) * k;
  const y = hy + (wy - hy) * k;
  const l = Math.hypot(x, y);
  return l < 1e-6 ? [hx, hy] : [x / l, y / l];
}

/** A hooded figure seen from above with a small lantern held ahead. Faces (hx, hy). */
export function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, k: PlayerLook) {
  const crouch = k.sneaking ? 0.82 : 1;
  const bob = k.walking && !k.calm ? Math.sin(k.phase * 9) : 0;
  const r = 0.2 * px * crouch;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(k.hy, k.hx));
  // Local frame: facing is +x.

  // lantern glow in front of the figure
  const lx = r * 1.55;
  const lr = (k.sneaking ? 0.32 : 0.55) * px;
  const g = ctx.createRadialGradient(lx, 0, 0, lx, 0, lr);
  g.addColorStop(0, "rgba(56,242,214,0.38)");
  g.addColorStop(1, "rgba(56,242,214,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(lx, 0, lr, 0, 6.283);
  ctx.fill();

  ctx.globalAlpha = k.sneaking ? 0.7 : 0.95;
  // shoulders (wide oval across the facing) with the arms swinging a little
  ctx.fillStyle = "#0f2a30";
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, 0, r * 0.8, r * (1.15 + 0.07 * bob), 0, 0, 6.283);
  ctx.fill();
  ctx.stroke();
  // cloak tail behind
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, -r * 0.7);
  ctx.lineTo(-r * 1.9, 0);
  ctx.lineTo(-r * 0.6, r * 0.7);
  ctx.closePath();
  ctx.fillStyle = "#0a1b20";
  ctx.fill();
  ctx.stroke();
  // hood, a pointed teardrop toward the facing
  ctx.fillStyle = "#17434a";
  ctx.beginPath();
  ctx.moveTo(r * 0.95, 0);
  ctx.quadraticCurveTo(r * 0.3, -r * 0.75, -r * 0.45, -r * 0.5);
  ctx.quadraticCurveTo(-r * 0.7, 0, -r * 0.45, r * 0.5);
  ctx.quadraticCurveTo(r * 0.3, r * 0.75, r * 0.95, 0);
  ctx.fill();
  ctx.stroke();
  // lantern: a small bright bulb on a short arm
  ctx.beginPath();
  ctx.moveTo(r * 0.3, r * 0.55);
  ctx.lineTo(lx, r * 0.35);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = TEAL;
  ctx.beginPath();
  ctx.arc(lx, r * 0.35, r * (k.sneaking ? 0.2 : 0.3), 0, 6.283);
  ctx.fill();
  ctx.restore();
}

/** A small footprint, drawn at its own heading. `alpha` fades it out. */
export function drawPrint(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, ang: number, left: boolean, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = TEAL;
  ctx.beginPath();
  ctx.ellipse(0, (left ? -1 : 1) * 0.08 * px, 0.07 * px, 0.04 * px, 0, 0, 6.283);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

export interface MonsterLook {
  hx: number;
  hy: number;
  time: number;
  /** It heard something and is hunting. */
  hunting: boolean;
  /** 0..1 how strongly a wave lights its body. */
  seen: number;
  /** 0..1 spike for a moment after it starts hunting. */
  alarm: number;
  calm: boolean;
  /** Per-monster time offset so two monsters do not move in step. */
  seed: number;
}

/** A long thin creature with six jointed limbs, a narrow head and two red eyes. Faces (hx, hy). */
export function drawMonster(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, k: MonsterLook) {
  const t = k.time + k.seed;
  const breath = k.calm ? 0 : Math.sin(t * 2.6);
  const twitch = k.calm ? 0 : Math.sin(t * 23) * Math.sin(t * 1.7) ** 8; // rare short shiver
  const L = 0.5 * px * (1 + 0.04 * breath);
  const W = 0.15 * px * (1 + 0.06 * breath);
  const body = Math.min(1, k.seen);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(k.hy, k.hx) + twitch * 0.12);
  // Local frame: facing is +x.

  // limbs: three pairs of two-joint legs that sway
  ctx.strokeStyle = ALERT;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = Math.max(body, k.hunting ? 0.5 : 0) * 0.95;
  for (let i = 0; i < 3; i++) {
    const bx = L * (0.35 - i * 0.38);
    for (const s of [-1, 1]) {
      const sway = k.calm ? 0 : Math.sin(t * 5 + i * 1.7 + (s > 0 ? 0 : 2)) * 0.25;
      const kx = bx + (i - 1) * 0.12 * px;
      const ky = s * (W * 0.9 + 0.2 * px);
      const fx = kx + (0.05 + sway * 0.4) * px * (i === 0 ? 1 : -1);
      const fy = s * (W + 0.42 * px + sway * 0.08 * px);
      ctx.beginPath();
      ctx.moveTo(bx, s * W * 0.5);
      ctx.lineTo(kx, ky);
      ctx.lineTo(fx, fy);
      ctx.stroke();
    }
  }
  // tail: a thin tendril that wags
  const wag = k.calm ? 0 : Math.sin(t * 3.1) * 0.35 * px;
  ctx.beginPath();
  ctx.moveTo(-L * 0.9, 0);
  ctx.quadraticCurveTo(-L * 1.4, wag, -L * 1.9, -wag * 0.6);
  ctx.stroke();

  // body: long thin ellipse with a narrow head
  ctx.globalAlpha = Math.max(body, k.hunting ? 0.45 : 0) * 0.95;
  ctx.fillStyle = "#3a0f1a";
  ctx.beginPath();
  ctx.ellipse(-L * 0.2, 0, L * 0.85, W, 0, 0, 6.283);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(L * 0.55, -W * 0.7);
  ctx.quadraticCurveTo(L * 1.1, 0, L * 0.55, W * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // eyes: two red points. Faint while it wanders, bright and wide when it has heard you.
  const eye = Math.max(body, k.hunting ? 0.85 : 0.0);
  if (eye > 0) {
    const big = (k.hunting ? 2.8 : 1.8) + 2 * k.alarm;
    ctx.globalAlpha = eye;
    ctx.fillStyle = "#ffd0d8";
    ctx.shadowColor = ALERT;
    ctx.shadowBlur = k.hunting ? 14 : 6;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(L * 0.78, s * W * 0.32, big * 1.5, big, 0, 0, 6.283);
      ctx.fillStyle = ALERT;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(L * 0.8, s * W * 0.32, big * 0.45, 0, 6.283);
      ctx.fillStyle = "#ffd0d8";
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
