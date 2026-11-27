import { buildRoom, type Pt, type Room, type Scene } from "./scene";

/** Canvas drawing and small pure helpers for the room picture. Nothing here touches the solver. */

const SOUND_SPEED = 343;

/** The standing-wave pair (m, n) whose note is closest to f in a W x H room (walls rigid). */
export function pickMode(w: number, h: number, f: number): { m: number; n: number } {
  let best = { m: 0, n: 1 };
  let bd = Infinity;
  for (let m = 0; m <= 8; m++)
    for (let n = 0; n <= 8; n++) {
      if (m === 0 && n === 0) continue;
      const d = Math.abs((SOUND_SPEED / 2) * Math.hypot(m / w, n / h) - f);
      if (d < bd) {
        bd = d;
        best = { m, n };
      }
    }
  return best;
}

export interface Sketch {
  nx: number;
  ny: number;
  cell: number;
  /** 0..1 loudness, 0 on walls. */
  power: Float32Array;
  solid: Uint8Array;
}

/**
 * A rough picture of the room before the real map is ready (no solver, a few ms).
 * shortcut: a rectangle gets one standing-wave pattern, other rooms get a plain fade from the speaker; replace by the real map once it arrives.
 */
export function sketchPower(scene: Scene, f: number, cell = 0.1): Sketch {
  const room: Room = buildRoom(scene, cell);
  const { nx, ny, solid } = room;
  const power = new Float32Array(nx * ny);
  const rect = scene.shape === "rect" && !scene.imported;
  const { m, n } = pickMode(scene.w, scene.h, f);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (solid[j * nx + i]) continue;
      const x = (i + 0.5) * cell;
      const y = (j + 0.5) * cell;
      power[j * nx + i] = rect ? Math.abs(Math.cos((m * Math.PI * x) / scene.w) * Math.cos((n * Math.PI * y) / scene.h)) : Math.exp(-Math.hypot(x - scene.sub.x, y - scene.sub.y) / 1.5);
    }
  return { nx, ny, cell, power, solid };
}

/** The 2 loudest and 2 quietest spots (0.5 m blocks of air, at least 1 m apart), in metres. */
export function findSpots(power: ArrayLike<number>, solid: ArrayLike<number>, nx: number, ny: number, cell: number, blockM = 0.5, sepM = 1): { loud: Pt[]; quiet: Pt[] } {
  const bs = Math.max(1, Math.round(blockM / cell));
  const bw = Math.ceil(nx / bs);
  const bh = Math.ceil(ny / bs);
  const blocks: { x: number; y: number; v: number }[] = [];
  for (let bj = 0; bj < bh; bj++)
    for (let bi = 0; bi < bw; bi++) {
      let sum = 0;
      let air = 0;
      let cnt = 0;
      for (let j = bj * bs; j < Math.min(ny, (bj + 1) * bs); j++)
        for (let i = bi * bs; i < Math.min(nx, (bi + 1) * bs); i++) {
          cnt++;
          if (!solid[j * nx + i]) {
            air++;
            sum += power[j * nx + i]!;
          }
        }
      if (air * 2 >= cnt && air > 0) blocks.push({ x: Math.min(nx * cell, (bi + 0.5) * bs * cell), y: Math.min(ny * cell, (bj + 0.5) * bs * cell), v: sum / air });
    }
  const pick = (sorted: typeof blocks): Pt[] => {
    const out: Pt[] = [];
    for (const b of sorted) {
      if (out.length >= 2) break;
      if (out.every((p) => Math.hypot(p.x - b.x, p.y - b.y) >= sepM)) out.push({ x: b.x, y: b.y });
    }
    return out;
  };
  return { loud: pick([...blocks].sort((a, b) => b.v - a.v)), quiet: pick([...blocks].sort((a, b) => a.v - b.v)) };
}

/** Seat word from the level at the chosen note minus the median of all notes. Words only, no numbers. */
export function seatWord(relDb: number): "Boomy" | "OK" | "Thin" {
  return relDb >= 6 ? "Boomy" : relDb <= -6 ? "Thin" : "OK";
}

const WALL = "#9fb7b3";
const YELLOW = "#ffd24a";
const RED = "#ff3b5c";
const TEAL = "#38f2d6";

/** Lighter floor and a 4 px wall line around the air (works for rectangle, L and imported rooms). */
export function drawFloor(g: CanvasRenderingContext2D, room: Room, k: number): void {
  const cell = room.dx * k;
  g.fillStyle = "#0b1118";
  for (let j = 0; j < room.ny; j++) for (let i = 0; i < room.nx; i++) if (!room.solid[j * room.nx + i]) g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
}

export function drawOutline(g: CanvasRenderingContext2D, room: Room, k: number): void {
  const cell = room.dx * k;
  const air = (i: number, j: number) => i >= 0 && j >= 0 && i < room.nx && j < room.ny && !room.solid[j * room.nx + i];
  g.strokeStyle = WALL;
  g.lineWidth = 4;
  g.lineCap = "square";
  g.beginPath();
  for (let j = 0; j < room.ny; j++)
    for (let i = 0; i < room.nx; i++) {
      if (!air(i, j)) continue;
      const x = i * cell;
      const y = j * cell;
      if (!air(i - 1, j)) (g.moveTo(x, y), g.lineTo(x, y + cell));
      if (!air(i + 1, j)) (g.moveTo(x + cell, y), g.lineTo(x + cell, y + cell));
      if (!air(i, j - 1)) (g.moveTo(x, y), g.lineTo(x + cell, y));
      if (!air(i, j + 1)) (g.moveTo(x, y + cell), g.lineTo(x + cell, y + cell));
    }
  g.stroke();
}

/** Label with a dark outline so it reads on both the map and the floor. `px` is the font size in canvas pixels. */
export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color = "#eaf2f1"): void {
  g.font = `bold ${px}px system-ui`;
  g.textAlign = "center";
  g.lineWidth = Math.max(2, px / 4);
  g.strokeStyle = "#05070b";
  g.lineJoin = "round";
  g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
}

export function drawRoomSize(g: CanvasRenderingContext2D, scene: Scene, k: number, px: number): void {
  const w = `${+scene.w.toFixed(1)} m`;
  const h = `${+scene.h.toFixed(1)} m`;
  label(g, w, (scene.w * k) / 2, px * 1.3, px, WALL);
  g.save();
  g.translate(scene.w * k - px * 0.6, (scene.h * k) / 2);
  g.rotate(-Math.PI / 2);
  label(g, h, 0, 0, px, WALL);
  g.restore();
}

/** Yellow speaker box with two cones and three sound arcs. (x, y) is the centre in canvas px. */
export function drawSpeaker(g: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  const w = 48 * u;
  const h = 56 * u;
  g.fillStyle = YELLOW;
  g.strokeStyle = "#05070b";
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(x - w / 2, y - h / 2, w, h, 8 * u);
  g.fill();
  g.stroke();
  g.fillStyle = "#05070b";
  for (const [dy, r] of [[-h * 0.2, 9 * u], [h * 0.2, 13 * u]] as const) {
    g.beginPath();
    g.arc(x, y + dy, r, 0, 2 * Math.PI);
    g.fill();
  }
  g.strokeStyle = YELLOW;
  g.lineWidth = 2;
  for (let a = 1; a <= 3; a++) {
    g.beginPath();
    g.arc(x + w / 2, y, 6 * u + a * 6 * u, -0.7, 0.7);
    g.stroke();
  }
}

/** White couch seen from above: back bar, seat and two arms. */
export function drawCouch(g: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  const w = 60 * u;
  const h = 44 * u;
  g.fillStyle = "#eaf2f1";
  g.strokeStyle = "#05070b";
  g.lineWidth = 2;
  const box = (bx: number, by: number, bw: number, bh: number, r: number) => {
    g.beginPath();
    g.roundRect(bx, by, bw, bh, r);
    g.fill();
    g.stroke();
  };
  box(x - w / 2, y - h / 2, w, 12 * u, 5 * u);
  box(x - w / 2, y - h / 2 + 8 * u, 12 * u, h - 8 * u, 5 * u);
  box(x + w / 2 - 12 * u, y - h / 2 + 8 * u, 12 * u, h - 8 * u, 5 * u);
  box(x - w / 2 + 12 * u, y - h / 2 + 14 * u, w - 24 * u, h - 14 * u, 4 * u);
}

/** Red BOOM ring or dashed teal Quiet ring. `r` and `px` are in canvas px. */
export function drawSpot(g: CanvasRenderingContext2D, p: Pt, k: number, kind: "boom" | "quiet", px: number, strong = false): void {
  const x = p.x * k;
  const y = p.y * k;
  const r = 0.4 * k;
  g.save();
  g.lineWidth = strong ? 5 : 3;
  g.strokeStyle = kind === "boom" ? RED : TEAL;
  g.setLineDash(kind === "boom" ? [] : [8, 6]);
  g.beginPath();
  g.arc(x, y, r, 0, 2 * Math.PI);
  g.stroke();
  g.restore();
  label(g, kind === "boom" ? "BOOM" : "Quiet", x, y + px * 0.35, px, kind === "boom" ? "#ff8aa0" : TEAL);
}

export function drawHighlight(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.save();
  g.strokeStyle = "#ffffff";
  g.lineWidth = 4;
  g.setLineDash([10, 6]);
  g.beginPath();
  g.arc(x, y, r, 0, 2 * Math.PI);
  g.stroke();
  g.restore();
}
