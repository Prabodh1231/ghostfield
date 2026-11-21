import type { Boundary, FieldState } from "./solver";

/**
 * Rigid interior walls from a solid-cell mask (1 = solid). Every q face that touches a
 * solid cell is set to 0 after the q update, so no flux enters or leaves a solid cell.
 * Solid cells start at u = 0 and stay there. Used for L-shaped rooms and inner walls.
 */
export function rigidWalls(nx: number, ny: number, solid: Uint8Array): Boundary {
  const qxIdx: number[] = [];
  const qyIdx: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 1; i < nx; i++) {
      if (solid[j * nx + i] || solid[j * nx + i - 1]) qxIdx.push(j * (nx + 1) + i);
    }
  }
  for (let j = 1; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (solid[j * nx + i] || solid[(j - 1) * nx + i]) qyIdx.push(j * nx + i);
    }
  }
  const qxs = Int32Array.from(qxIdx);
  const qys = Int32Array.from(qyIdx);
  return {
    afterQ(s: FieldState) {
      for (let k = 0; k < qxs.length; k++) s.qx[qxs[k]!] = 0;
      for (let k = 0; k < qys.length; k++) s.qy[qys[k]!] = 0;
    },
  };
}

/** Run several boundaries in order. */
export function composeBoundaries(...bs: Boundary[]): Boundary {
  return {
    afterQ: (s) => bs.forEach((b) => b.afterQ?.(s)),
    afterU: (s) => bs.forEach((b) => b.afterU?.(s)),
  };
}
