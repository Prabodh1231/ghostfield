import { SketchError } from "@ui";
import type { Profile } from "./config";
import type { LevelData } from "./levels";

/** Breadth-first distances (in cells, 4-neighbour) from the given start cells, only through cells where `pass` is true. -1 = not reached. */
function bfs(nx: number, ny: number, starts: number[], pass: (i: number) => boolean): Int32Array {
  const dist = new Int32Array(nx * ny).fill(-1);
  const q = starts.slice();
  for (const s of q) dist[s] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    const x = i % nx;
    const y = (i / nx) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, y > 0 ? i - nx : -1, y < ny - 1 ? i + nx : -1]) {
      if (j >= 0 && dist[j] === -1 && pass(j)) {
        dist[j] = dist[i]! + 1;
        q.push(j);
      }
    }
  }
  return dist;
}

/**
 * Turn an imported wall mask (cols x rows cells of about dx metres) into a level for this backend:
 * copy it into the grid, close the border, then pick a start, an exit far away, and a monster in between,
 * all on open floor with room for the player to stand (0.3 m from any wall).
 */
export function sketchToLevel(solidIn: Uint8Array, cols: number, rows: number, p: Profile): LevelData {
  const { nx, ny } = p;
  if (cols > nx || rows > ny) throw new SketchError("The sketch is bigger than the game room. Draw a smaller room or crop the picture.");
  const solid = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) solid[y * nx + x] = x >= cols || y >= rows || x === 0 || y === 0 || x === cols - 1 || y === rows - 1 ? 1 : solidIn[y * cols + x]!;
  const need = Math.max(2, Math.ceil(0.3 / p.dx));
  // distance to the nearest wall
  const walls: number[] = [];
  for (let i = 0; i < nx * ny; i++) if (solid[i]) walls.push(i);
  const clear = bfs(nx, ny, walls, () => true);
  const roomy = (i: number) => !solid[i] && clear[i]! >= need;
  // start: in the biggest open area (so a margin round the drawing is ignored), nearest its top-left corner
  const comp = new Int32Array(nx * ny).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < nx * ny; i++) {
    if (!roomy(i) || comp[i]! >= 0) continue;
    const dd = bfs(nx, ny, [i], roomy);
    let n = 0;
    for (let j = 0; j < dd.length; j++) if (dd[j]! >= 0) { comp[j] = sizes.length; n++; }
    sizes.push(n);
  }
  if (sizes.length === 0) throw new SketchError("No open floor found. Draw wider rooms and corridors, at least 0.6 m across.");
  const big = sizes.indexOf(Math.max(...sizes));
  let start = -1;
  let best = Infinity;
  for (let i = 0; i < nx * ny; i++) {
    if (comp[i] !== big) continue;
    const s = (i % nx) + ((i / nx) | 0);
    if (s < best) {
      best = s;
      start = i;
    }
  }
  const d = bfs(nx, ny, [start], roomy);
  let far = start;
  for (let i = 0; i < nx * ny; i++) if (d[i]! > d[far]!) far = i;
  if (d[far]! * p.dx < 4) throw new SketchError("The open floor is too small for a game. Draw a bigger room or a longer path.");
  // monster: about 60% of the way along the longest path, never closer than 3 m to the start
  let mon = start;
  let gap = Infinity;
  for (let i = 0; i < nx * ny; i++) {
    if (d[i]! < 0 || d[i]! * p.dx < 3) continue;
    const g = Math.abs(d[i]! - 0.6 * d[far]!);
    if (g < gap) {
      gap = g;
      mon = i;
    }
  }
  const at = (i: number): [number, number] => [((i % nx) + 0.5) * p.dx, (((i / nx) | 0) + 0.5) * p.dx];
  return {
    name: "Your sketch",
    hint: "This is the floor plan you drew. Find the faint pulsing exit.",
    nx,
    ny,
    solid,
    porous: new Uint8Array(nx * ny),
    start: at(start),
    exit: at(far),
    monsters: [{ x: at(mon)[0], y: at(mon)[1], wander: 1.1, hunt: 2.2 }],
  };
}
