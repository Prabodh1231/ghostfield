/**
 * What the monster hears: a leaky-integrated energy field E (about 1.5 s memory) that is built
 * from the wave field u. The monster's own steps are never put into the sim, so it cannot hear itself.
 */
export function integrateEnergy(E: Float32Array, u: Float32Array, decay: number): void {
  for (let i = 0; i < E.length; i++) E[i] = E[i]! * decay + u[i]! * u[i]!;
}

export interface Heading {
  /** Unit direction of the loudest side. */
  dx: number;
  dy: number;
  /** Size of the gradient, in E units. */
  strength: number;
}

const DIRS = 16;
const SIN = Array.from({ length: DIRS }, (_, i) => Math.sin((i / DIRS) * 2 * Math.PI));
const COS = Array.from({ length: DIRS }, (_, i) => Math.cos((i / DIRS) * 2 * Math.PI));

/**
 * One gradient step: look `reach` metres around (x, y) in 16 directions and sum (E there - E here) * direction.
 * Cells inside walls hold no energy, so the sum also pushes away from walls.
 * Returns null when the pull is below `floor` (quiet), so the caller can wander instead.
 */
export function gradientHeading(E: Float32Array, nx: number, ny: number, dxm: number, x: number, y: number, reach: number, floor: number): Heading | null {
  const at = (px: number, py: number) => {
    const ix = Math.floor(px / dxm);
    const iy = Math.floor(py / dxm);
    return ix < 0 || iy < 0 || ix >= nx || iy >= ny ? 0 : E[iy * nx + ix]!;
  };
  const here = at(x, y);
  let gx = 0;
  let gy = 0;
  for (let i = 0; i < DIRS; i++) {
    // two radii so a narrow door is still noticed
    const d = (at(x + COS[i]! * reach, y + SIN[i]! * reach) + at(x + COS[i]! * reach * 0.5, y + SIN[i]! * reach * 0.5)) / 2 - here;
    gx += d * COS[i]!;
    gy += d * SIN[i]!;
  }
  gx /= DIRS / 2;
  gy /= DIRS / 2;
  const strength = Math.hypot(gx, gy);
  return strength < floor ? null : { dx: gx / strength, dy: gy / strength, strength };
}
