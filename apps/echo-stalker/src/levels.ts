import { TILES_X, TILES_Y, TILE_M, type Profile } from "./config";

export interface MonsterSpec {
  /** Start, metres. */
  x: number;
  y: number;
  /** Speed when nothing is heard, m/s. */
  wander: number;
  /** Top speed when it hears you, m/s. */
  hunt: number;
}

/** A level at the resolution of one backend: masks have nx*ny cells; positions are in metres. */
export interface LevelData {
  name: string;
  hint: string;
  nx: number;
  ny: number;
  solid: Uint8Array;
  /** 1 where the stealth zone absorbs sound. */
  porous: Uint8Array;
  start: [number, number];
  exit: [number, number];
  monsters: MonsterSpec[];
}

/** A hand-made level on a 40 x 24 tile board (a tile is 0.4 m). */
export interface TileLevel {
  name: string;
  hint: string;
  tiles: string[];
  start: [number, number];
  exit: [number, number];
  monsters: { x: number; y: number; wander: number; hunt: number }[];
}

type Op = ["wall" | "zone", number, number, number, number];

/** Border + rectangles (inclusive tile coordinates). '#' wall, ':' stealth zone, '.' floor. */
function board(ops: Op[]): string[] {
  const g = Array.from({ length: TILES_Y }, () => Array<string>(TILES_X).fill("."));
  const fill = (x0: number, y0: number, x1: number, y1: number, ch: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y]![x] = ch;
  };
  fill(0, 0, TILES_X - 1, 0, "#");
  fill(0, TILES_Y - 1, TILES_X - 1, TILES_Y - 1, "#");
  fill(0, 0, 0, TILES_Y - 1, "#");
  fill(TILES_X - 1, 0, TILES_X - 1, TILES_Y - 1, "#");
  for (const [k, a, b, c, d] of ops) fill(a, b, c, d, k === "wall" ? "#" : ":");
  return g.map((r) => r.join(""));
}

const W = (a: number, b: number, c: number, d: number): Op => ["wall", a, b, c, d];
const Z = (a: number, b: number, c: number, d: number): Op => ["zone", a, b, c, d];
/** Tile centre in metres. */
const m = (t: number) => (t + 0.5) * TILE_M;

export const LEVELS: TileLevel[] = [
  {
    name: "1. First steps",
    hint: "Walk to the faint pulsing exit on the right. Hide in the grey dotted zones to stay quiet.",
    tiles: board([
      W(8, 1, 8, 9), W(8, 14, 8, 22), // wall with a door
      W(32, 1, 32, 15), W(32, 20, 32, 22), // wall with a door to the exit room
      W(18, 6, 19, 8), W(18, 15, 19, 17), W(26, 10, 27, 13), // pillars
      Z(3, 19, 6, 21), Z(11, 3, 14, 5), Z(22, 19, 25, 21),
    ]),
    start: [m(3), m(12)],
    exit: [m(36), m(17)],
    monsters: [{ x: m(22), y: m(12), wander: 1.0, hunt: 2.1 }],
  },
  {
    name: "2. The snake",
    hint: "One long winding path. The monster is faster here.",
    tiles: board([
      W(6, 1, 6, 17), W(12, 6, 12, 22), W(18, 1, 18, 17), W(24, 6, 24, 22), W(30, 1, 30, 17),
      Z(8, 3, 10, 5), Z(14, 19, 16, 21), Z(20, 3, 22, 5), Z(26, 19, 28, 21), Z(2, 14, 4, 16),
    ]),
    start: [m(3), m(3)],
    exit: [m(36), m(20)],
    monsters: [{ x: m(21), y: m(20), wander: 1.1, hunt: 2.4 }],
  },
  {
    name: "3. Two hunters",
    hint: "Two monsters. Throw a pebble (click) to pull them away.",
    tiles: board([
      W(4, 8, 14, 8), W(10, 15, 24, 15), W(26, 3, 26, 12), W(28, 18, 36, 18),
      W(16, 4, 17, 5), W(20, 19, 21, 20), W(32, 9, 33, 11), W(20, 9, 22, 11),
      Z(2, 20, 5, 22), Z(30, 13, 33, 15), Z(7, 3, 9, 5),
    ]),
    start: [m(2), m(20)],
    exit: [m(37), m(3)],
    monsters: [
      { x: m(20), y: m(12), wander: 1.1, hunt: 2.4 },
      { x: m(32), y: m(5), wander: 1.1, hunt: 2.4 },
    ],
  },
];

/** Blow a tile level up to the cell grid of one backend. */
export function rasterize(t: TileLevel, p: Profile): LevelData {
  const { nx, ny, k } = p;
  const solid = new Uint8Array(nx * ny);
  const porous = new Uint8Array(nx * ny);
  for (let ty = 0; ty < TILES_Y; ty++)
    for (let tx = 0; tx < TILES_X; tx++) {
      const ch = t.tiles[ty]![tx]!;
      if (ch === ".") continue;
      for (let y = ty * k; y < (ty + 1) * k; y++)
        for (let x = tx * k; x < (tx + 1) * k; x++) (ch === "#" ? solid : porous)[y * nx + x] = 1;
    }
  return { name: t.name, hint: t.hint, nx, ny, solid, porous, start: t.start, exit: t.exit, monsters: t.monsters };
}

/** Tiles reachable from `from` without crossing a wall (4-neighbour). Used by the tests. */
export function reachable(t: TileLevel, from: [number, number]): Set<number> {
  const seen = new Set<number>();
  const q = [[Math.floor(from[0] / TILE_M), Math.floor(from[1] / TILE_M)] as [number, number]];
  while (q.length) {
    const [x, y] = q.pop()!;
    if (x < 0 || y < 0 || x >= TILES_X || y >= TILES_Y || t.tiles[y]![x] === "#" || seen.has(y * TILES_X + x)) continue;
    seen.add(y * TILES_X + x);
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}
