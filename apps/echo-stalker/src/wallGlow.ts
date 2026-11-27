/**
 * wallGlow: the only way a wall becomes visible. Each wall cell that touches air keeps the
 * leaky maximum of the wave energy (u^2) in its air neighbours: it jumps up when a wave hits and
 * fades by `decay` per update. Game-only code (the engine does not know about it).
 */
export interface WallSurface {
  /** Index of each wall-surface cell in the nx*ny grid. */
  cells: Int32Array;
  /** 4 air-neighbour indices per surface cell, -1 where that neighbour is a wall or off-grid. */
  nb: Int32Array;
}

export function buildSurface(solid: Uint8Array, nx: number, ny: number): WallSurface {
  const cells: number[] = [];
  const nb: number[] = [];
  const air = (x: number, y: number) => (x >= 0 && y >= 0 && x < nx && y < ny && !solid[y * nx + x] ? y * nx + x : -1);
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      if (!solid[y * nx + x]) continue;
      const n = [air(x - 1, y), air(x + 1, y), air(x, y - 1), air(x, y + 1)];
      if (n.every((v) => v < 0)) continue;
      cells.push(y * nx + x);
      nb.push(...n);
    }
  return { cells: Int32Array.from(cells), nb: Int32Array.from(nb) };
}

/** glow[i] = max(glow[i] * decay, max over air neighbours of u^2). Returns nothing; edits glow. */
export function updateGlow(glow: Float32Array, s: WallSurface, u: Float32Array, decay: number): void {
  for (let i = 0; i < glow.length; i++) {
    let e = 0;
    for (let j = 4 * i; j < 4 * i + 4; j++) {
      const c = s.nb[j]!;
      if (c >= 0) {
        const v = u[c]! * u[c]!;
        if (v > e) e = v;
      }
    }
    const old = glow[i]! * decay;
    glow[i] = e > old ? e : old;
  }
}
