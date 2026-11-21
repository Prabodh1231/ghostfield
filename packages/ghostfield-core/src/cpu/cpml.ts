import type { CoefficientSet } from "../coefficients";
import type { Boundary, FieldState } from "./solver";

export interface CpmlOptions {
  /** Layer thickness in cells. Default 16. */
  thickness?: number;
  /** Polynomial order of sigma, kappa and alpha grading. Default 3. */
  order?: number;
  /** Target theoretical normal-incidence reflection R0 (sets sigmaMax). Default 1e-8. */
  r0?: number;
  /** kappa at the outer edge (1 at the inner edge). Default 2. */
  kappaMax?: number;
  /** alpha at the inner edge, 1/s, falling to 0 at the outer edge. Default 0.02. */
  alphaMax?: number;
}

/**
 * Convolutional PML (Roden-Gedney, 1-D stretched coordinates per axis) as a Boundary.
 *
 * The solver already did q <- Aq q - Bq g (g = du/dx / dx etc.). The hook then adds
 *   dq = -Bq * ((1/kappa - 1) g + psi),   psi <- b psi + a g
 * and the same for u with div(q). The u and q fields are recomputed from the arrays the
 * hook sees, so the solver needs no change. Sigma, kappa and alpha are graded
 * s(d) = s_max (d/T)^order, d = depth into the layer; alpha is graded the other way.
 *
 * The constructor captures dt, dx and the coefficients, as the hook only receives FieldState.
 * The outer wall faces are left at 0 (rigid), so the layer is backed by a rigid wall.
 *
 * shortcut: psi arrays are full-grid f32 (4 arrays), not border strips. Fine for the CPU
 * reference; the GPU port should keep psi only in the strips.
 */
export class Cpml implements Boundary {
  private readonly nx: number;
  private readonly ny: number;
  private readonly invDx: number;
  private readonly coef: Float32Array;
  readonly thickness: number;
  // Per-axis profiles. "f" = at faces (index 0..n), "c" = at cell centres (0..n-1).
  private readonly bFx: Float64Array;
  private readonly aFx: Float64Array;
  private readonly kFx: Float64Array;
  private readonly bCx: Float64Array;
  private readonly aCx: Float64Array;
  private readonly kCx: Float64Array;
  private readonly bFy: Float64Array;
  private readonly aFy: Float64Array;
  private readonly kFy: Float64Array;
  private readonly bCy: Float64Array;
  private readonly aCy: Float64Array;
  private readonly kCy: Float64Array;
  private readonly psiQx: Float32Array; // (nx+1)*ny, from du/dx
  private readonly psiQy: Float32Array; // nx*(ny+1), from du/dy
  private readonly psiUx: Float32Array; // nx*ny, from dqx/dx
  private readonly psiUy: Float32Array; // nx*ny, from dqy/dy

  constructor(cs: CoefficientSet, opts: CpmlOptions = {}) {
    const T = opts.thickness ?? 16;
    const m = opts.order ?? 3;
    const r0 = opts.r0 ?? 1e-8;
    const kMax = opts.kappaMax ?? 2;
    const aMax = opts.alphaMax ?? 0.02;
    if (!(Number.isInteger(T) && T >= 1 && 2 * T < Math.min(cs.nx, cs.ny))) throw new RangeError("bad CPML thickness");
    if (!(r0 > 0 && r0 < 1 && kMax >= 1 && aMax >= 0 && m >= 1)) throw new RangeError("bad CPML options");
    this.nx = cs.nx;
    this.ny = cs.ny;
    this.invDx = 1 / cs.dx;
    this.coef = cs.coef;
    this.thickness = T;
    const L = T * cs.dx;
    // sigma has units 1/s here (it is divided by C or L already).
    const sMax = ((m + 1) * cs.cMax * -Math.log(r0)) / (2 * L);
    const dt = cs.dt;
    // x = position in cells from the low edge of an axis with n cells (faces at i, centres at i+0.5).
    const profile = (n: number, centred: boolean) => {
      const count = centred ? n : n + 1;
      const b = new Float64Array(count);
      const a = new Float64Array(count);
      const k = new Float64Array(count);
      for (let i = 0; i < count; i++) {
        const x = centred ? i + 0.5 : i;
        const r = Math.min(Math.max(T - x, x - (n - T), 0) / T, 1);
        const sg = sMax * r ** m;
        const kp = 1 + (kMax - 1) * r ** m;
        const al = aMax * (1 - r);
        b[i] = Math.exp(-(sg / kp + al) * dt);
        const den = sg * kp + kp * kp * al;
        a[i] = den === 0 ? 0 : (sg / den) * (b[i]! - 1);
        k[i] = kp;
      }
      return { b, a, k };
    };
    const fx = profile(cs.nx, false);
    const cx = profile(cs.nx, true);
    const fy = profile(cs.ny, false);
    const cy = profile(cs.ny, true);    this.bFx = fx.b;
    this.aFx = fx.a;
    this.kFx = fx.k;
    this.bCx = cx.b;
    this.aCx = cx.a;
    this.kCx = cx.k;
    this.bFy = fy.b;
    this.aFy = fy.a;
    this.kFy = fy.k;
    this.bCy = cy.b;
    this.aCy = cy.a;
    this.kCy = cy.k;
    this.psiQx = new Float32Array((cs.nx + 1) * cs.ny);
    this.psiQy = new Float32Array(cs.nx * (cs.ny + 1));
    this.psiUx = new Float32Array(cs.nx * cs.ny);
    this.psiUy = new Float32Array(cs.nx * cs.ny);
  }

  afterQ(s: FieldState): void {
    const { nx, ny, invDx, coef, thickness: T } = this;
    const { u, qx, qy } = s;
    // qx faces 1..nx-1; only the layers near x = 0 and x = nx matter for the x term.
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        if (i >= T && i <= nx - T) continue;
        const c = j * nx + i;
        const g = (u[c]! - u[c - 1]!) * invDx;
        const p = j * (nx + 1) + i;
        const psi = this.bFx[i]! * this.psiQx[p]! + this.aFx[i]! * g;
        this.psiQx[p] = psi;
        qx[p] = qx[p]! - coef[4 * c + 3]! * ((1 / this.kFx[i]! - 1) * g + psi);
      }
    }
    for (let j = 1; j < ny; j++) {
      const inY = j < T || j > ny - T;
      for (let i = 0; i < nx; i++) {
        if (!inY) continue;
        const c = j * nx + i;
        const g = (u[c]! - u[c - nx]!) * invDx;
        const psi = this.bFy[j]! * this.psiQy[c]! + this.aFy[j]! * g;
        this.psiQy[c] = psi;
        qy[c] = qy[c]! - coef[4 * c + 3]! * ((1 / this.kFy[j]! - 1) * g + psi);
      }
    }
  }

  afterU(s: FieldState): void {
    const { nx, ny, invDx, coef, thickness: T } = this;
    const { u, qx, qy } = s;
    for (let j = 0; j < ny; j++) {
      const rowQx = j * (nx + 1);
      for (let i = 0; i < nx; i++) {
        if (i >= T && i < nx - T) continue;
        const c = j * nx + i;
        const d = (qx[rowQx + i + 1]! - qx[rowQx + i]!) * invDx;
        const psi = this.bCx[i]! * this.psiUx[c]! + this.aCx[i]! * d;
        this.psiUx[c] = psi;
        u[c] = u[c]! - coef[4 * c + 1]! * ((1 / this.kCx[i]! - 1) * d + psi);
      }
    }
    for (let j = 0; j < ny; j++) {
      if (j >= T && j < ny - T) continue;
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        const d = (qy[c + nx]! - qy[c]!) * invDx;
        const psi = this.bCy[j]! * this.psiUy[c]! + this.aCy[j]! * d;
        this.psiUy[c] = psi;
        u[c] = u[c]! - coef[4 * c + 1]! * ((1 / this.kCy[j]! - 1) * d + psi);
      }
    }
  }
}
