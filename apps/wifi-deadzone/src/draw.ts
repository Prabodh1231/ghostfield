/** Canvas drawing for the floor plan: outer wall, room names, router, devices. Pictures only, no solver. */
import { LEVEL_WORDS } from "./heatmap";
import type { DeviceKind } from "./scene";

const WHITE = "#EAF2F1";
const GREY = "#9FB7B3";
const TEAL = "#38f2d6";
const ALERT = "#ff3b5c";
const DARK = "#05070b";

/** Grey 3 px outer wall just inside the soft edge layer. Visual only. */
export function drawOuterWall(g: CanvasRenderingContext2D, size: number, inset: number, u: number): void {
  g.strokeStyle = GREY;
  g.lineWidth = 3 * u;
  g.strokeRect(inset, inset, size - 2 * inset, size - 2 * inset);
}

/** A wall with a thin dark outline so it reads on the bright map. */
export function drawWallLine(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number, alpha = 1): void {
  g.globalAlpha = alpha;
  g.lineCap = "butt";
  g.strokeStyle = DARK;
  g.lineWidth = width + 2;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
  g.globalAlpha = 1;
}

export function drawRoomLabel(g: CanvasRenderingContext2D, text: string, x: number, y: number, u: number): void {
  g.font = `600 ${12 * u}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(234,242,241,0.7)";
  g.fillText(text.toUpperCase(), x, y);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Router: white box, two antennas, three teal signal arcs, the word "Router". `ring` adds the "drag me" ring. */
export function drawRouter(g: CanvasRenderingContext2D, x: number, y: number, u: number, ring: boolean): void {
  const w = 64 * u;
  const h = 28 * u;
  if (ring) {
    g.strokeStyle = TEAL;
    g.lineWidth = 2 * u;
    g.beginPath();
    g.arc(x, y, 30 * u, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = WHITE;
  g.lineWidth = 3 * u;
  g.beginPath();
  g.moveTo(x - w * 0.3, y - h / 2);
  g.lineTo(x - w * 0.38, y - h / 2 - 10 * u);
  g.moveTo(x + w * 0.3, y - h / 2);
  g.lineTo(x + w * 0.38, y - h / 2 - 10 * u);
  g.stroke();
  g.fillStyle = WHITE;
  g.strokeStyle = DARK;
  g.lineWidth = 2 * u;
  roundRect(g, x - w / 2, y - h / 2, w, h, 6 * u);
  g.fill();
  g.stroke();
  g.fillStyle = TEAL;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.arc(x - w * 0.25 + i * 8 * u, y + 1 * u, 2.2 * u, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = TEAL;
  g.lineWidth = 2.5 * u;
  g.lineCap = "round";
  for (let i = 1; i <= 3; i++) {
    g.beginPath();
    g.arc(x, y - h / 2 - 4 * u, 8 * u * i + 6 * u, -Math.PI * 0.8, -Math.PI * 0.2);
    g.stroke();
  }
  g.lineCap = "butt";
  labelBelow(g, "Router", x, y + h / 2 + 4 * u, u);
}

function labelBelow(g: CanvasRenderingContext2D, text: string, x: number, y: number, u: number): void {
  g.font = `700 ${12 * u}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "top";
  g.lineWidth = 3 * u;
  g.strokeStyle = DARK;
  g.strokeText(text, x, y);
  g.fillStyle = WHITE;
  g.fillText(text, x, y);
}

function drawIcon(g: CanvasRenderingContext2D, kind: DeviceKind, x: number, y: number, u: number): void {
  g.fillStyle = WHITE;
  g.strokeStyle = DARK;
  g.lineWidth = 2 * u;
  if (kind === "laptop") {
    roundRect(g, x - 20 * u, y - 14 * u, 40 * u, 24 * u, 3 * u);
    g.fill();
    g.stroke();
    g.fillStyle = DARK;
    g.fillRect(x - 16 * u, y - 10 * u, 32 * u, 16 * u);
    g.fillStyle = WHITE;
    roundRect(g, x - 26 * u, y + 10 * u, 52 * u, 5 * u, 2 * u);
    g.fill();
    g.stroke();
  } else if (kind === "phone") {
    roundRect(g, x - 9 * u, y - 16 * u, 18 * u, 32 * u, 4 * u);
    g.fill();
    g.stroke();
    g.fillStyle = DARK;
    g.fillRect(x - 6 * u, y - 11 * u, 12 * u, 20 * u);
  } else {
    roundRect(g, x - 24 * u, y - 15 * u, 48 * u, 28 * u, 3 * u);
    g.fill();
    g.stroke();
    g.fillStyle = DARK;
    g.fillRect(x - 21 * u, y - 12 * u, 42 * u, 22 * u);
    g.fillStyle = WHITE;
    g.fillRect(x - 10 * u, y + 13 * u, 20 * u, 4 * u);
  }
}

/** Device icon with its name above and a badge under it: bars and a word (Great / OK / Weak / None). level null = still working. */
export function drawDevice(g: CanvasRenderingContext2D, kind: DeviceKind, x: number, y: number, level: 0 | 1 | 2 | 3 | null, u: number): void {
  drawIcon(g, kind, x, y, u);
  const name = kind === "tv" ? "TV" : kind === "phone" ? "Phone" : "Laptop";
  g.font = `600 ${10 * u}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "bottom";
  g.lineWidth = 3 * u;
  g.strokeStyle = DARK;
  g.strokeText(name, x, y - 18 * u);
  g.fillStyle = GREY;
  g.fillText(name, x, y - 18 * u);
  // badge
  const word = level === null ? "..." : LEVEL_WORDS[level]!;
  g.font = `700 ${13 * u}px system-ui, sans-serif`;
  const tw = g.measureText(word).width;
  const bw = tw + 38 * u;
  const bh = 22 * u;
  const bx = x - bw / 2;
  const by = y + 20 * u;
  g.fillStyle = "rgba(5,7,11,0.85)";
  g.strokeStyle = level === 0 ? ALERT : TEAL;
  g.lineWidth = 1.5 * u;
  roundRect(g, bx, by, bw, bh, 7 * u);
  g.fill();
  g.stroke();
  const stale = level === null;
  if (level === 0) {
    g.strokeStyle = ALERT;
    g.lineWidth = 3 * u;
    g.beginPath();
    g.moveTo(bx + 6 * u, by + 6 * u);
    g.lineTo(bx + 18 * u, by + bh - 6 * u);
    g.moveTo(bx + 18 * u, by + 6 * u);
    g.lineTo(bx + 6 * u, by + bh - 6 * u);
    g.stroke();
  } else {
    for (let i = 0; i < 3; i++) {
      const bhgt = (6 + i * 4) * u;
      g.fillStyle = !stale && level !== null && i < level ? TEAL : "rgba(159,183,179,0.35)";
      g.fillRect(bx + (6 + i * 5) * u, by + bh - 5 * u - bhgt, 3.5 * u, bhgt);
    }
  }
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillStyle = level === 0 ? ALERT : stale ? GREY : WHITE;
  g.fillText(word, bx + 26 * u, by + bh / 2 + 1);
}

/** "No signal" tag at the centre of a dead patch. */
export function drawNoSignal(g: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  g.font = `700 ${13 * u}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const tw = g.measureText("No signal").width;
  g.fillStyle = "rgba(5,7,11,0.8)";
  roundRect(g, x - tw / 2 - 6 * u, y - 10 * u, tw + 12 * u, 20 * u, 6 * u);
  g.fill();
  g.fillStyle = ALERT;
  g.fillText("No signal", x, y + 1);
}
