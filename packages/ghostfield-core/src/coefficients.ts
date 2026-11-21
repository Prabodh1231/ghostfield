/**
 * Shared coefficient module. cpu/ and (later) gpu/ both import this; neither
 * computes its own coefficients.
 *
 * Canonical system:  C du/dt + gu*u = -div q,   L dq/dt + gq*q = -grad u.
 *
 * Grid layout (staggered Yee, row-major, x fastest):
 *   u  : nx*ny      at cell centres,         index c = iy*nx + ix
 *   qx : (nx+1)*ny  at vertical cell faces,  index iy*(nx+1) + ix   (face ix is the left face of cell ix)
 *   qy : nx*(ny+1)  at horizontal faces,     index iy*nx + ix        (face iy is the bottom face of cell iy)
 *
 * Coefficient layout: ONE Float32Array with stride 4 per cell (a vec4 per cell,
 * so it can be uploaded as a single vec4 storage buffer):
 *   [Au, Bu, Aq, Bq]
 *   u update:  u  <- Au*u  - Bu * div(q)  , Bu = (1-Au)/(gu*dt) * dt/C
 *   q update:  q  <- Aq*q  - Bq * grad(u) , Bq = (1-Aq)/(gq*dt) * dt/L
 * The 1/dx of div and grad is NOT folded in; the solver multiplies by 1/dx.
 * Face ix of qx (and face iy of qy) uses the Aq, Bq of cell ix (iy), the cell on its high side.
 */

/** Hard 2D Yee limit is 1/sqrt(2) = 0.70710678. We reject anything above 0.7071. */
export const CFL_LIMIT = 0.7071;
/** Default Courant number: a safety margin (~98% of the limit), not the limit. */
export const DEFAULT_COURANT = 0.693;
/** Below this g*dt the limit B = dt/C is used (avoids 0/0). */
export const ETD_SMALL = 1e-8;

export interface Material {
  /** u-capacity C (Wi-Fi: eps0*epsr; bass: 1/(rho0*c^2)). */
  C: number;
  /** q-inductance L (Wi-Fi: mu0; bass: rho_eff). */
  L: number;
  /** Loss rate of u, 1/s. */
  gammaU: number;
  /** Loss rate of q, 1/s. */
  gammaQ: number;
}

/** ETD pair in f64. A = exp(-g dt), B = (1-A)/(g dt) * dt/C. */
export function etd64(gamma: number, dt: number, C: number): { A: number; B: number } {
  const x = gamma * dt;
  if (x < ETD_SMALL) return { A: Math.exp(-x), B: dt / C };
  const oneMinusA = -Math.expm1(-x);
  return { A: 1 - oneMinusA, B: (oneMinusA / gamma) / C };
}

/** Same as etd64 but cast to f32 at the very end. */
export function etd(gamma: number, dt: number, C: number): { A: number; B: number } {
  const r = etd64(gamma, dt, C);
  return { A: Math.fround(r.A), B: Math.fround(r.B) };
}

/** Wave speed 1/sqrt(C L) of a material. */
export function waveSpeed(m: Material): number {
  return 1 / Math.sqrt(m.C * m.L);
}

export function courantNumber(c: number, dt: number, dx: number): number {
  return (c * dt) / dx;
}

/** dt for a wanted Courant number, using the fastest speed in the grid. */
export function dtFromCourant(S: number, dx: number, cMax: number): number {
  return (S * dx) / cMax;
}

/** Throws when S = cMax*dt/dx exceeds the hard 2D limit. Use the FASTEST speed. */
export function assertCfl(cMax: number, dt: number, dx: number): number {
  const S = courantNumber(cMax, dt, dx);
  if (!(S <= CFL_LIMIT)) {
    throw new RangeError(`CFL violated: S = ${S} > ${CFL_LIMIT} (hard 2D limit 1/sqrt(2))`);
  }
  return S;
}

export interface CoefficientSet {
  nx: number;
  ny: number;
  dx: number;
  dt: number;
  /** Fastest effective wave speed, 1/sqrt(min C * min L) over the grid. */
  cMax: number;
  /** Courant number S = cMax*dt/dx. */
  courant: number;
  /** vec4 per cell: [Au, Bu, Aq, Bq]. Length 4*nx*ny. */
  coef: Float32Array;
}

/**
 * Build the per-cell ETD coefficients. Throws if the CFL guard fails.
 * `materialAt(ix, iy)` gives the material of each cell.
 */
export function buildCoefficients(
  nx: number,
  ny: number,
  dx: number,
  dt: number,
  materialAt: (ix: number, iy: number) => Material,
): CoefficientSet {
  if (!(Number.isInteger(nx) && Number.isInteger(ny) && nx >= 2 && ny >= 2)) {
    throw new RangeError("nx and ny must be integers >= 2");
  }
  if (!(dx > 0 && dt > 0)) throw new RangeError("dx and dt must be > 0");
  const coef = new Float32Array(4 * nx * ny);
  let minC = Infinity;
  let minL = Infinity;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const m = materialAt(ix, iy);
      if (!(m.C > 0 && m.L > 0 && m.gammaU >= 0 && m.gammaQ >= 0)) {
        throw new RangeError(`bad material at (${ix},${iy})`);
      }
      if (m.C < minC) minC = m.C;
      if (m.L < minL) minL = m.L;
      const u = etd(m.gammaU, dt, m.C);
      const q = etd(m.gammaQ, dt, m.L);
      const k = 4 * (iy * nx + ix);
      coef[k] = u.A;
      coef[k + 1] = u.B;
      coef[k + 2] = q.A;
      coef[k + 3] = q.B;
    }
  }
  // A face pairs the C of one cell with the L of its neighbour, so the fastest effective
  // speed is bounded by 1/sqrt(minC*minL), which can exceed every single cell's speed.
  const cMax = 1 / Math.sqrt(minC * minL);
  const courant = assertCfl(cMax, dt, dx);
  return { nx, ny, dx, dt, cMax, courant, coef };
}
