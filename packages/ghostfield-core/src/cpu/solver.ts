import type { CoefficientSet } from "../coefficients";

/** Field arrays, exposed to boundary hooks, sources and probes. */
export interface FieldState {
  nx: number;
  ny: number;
  u: Float32Array;
  /** (nx+1)*ny. Faces ix=0 and ix=nx are the side walls. */
  qx: Float32Array;
  /** nx*(ny+1). Faces iy=0 and iy=ny are the bottom/top walls. */
  qy: Float32Array;
  /** Number of completed steps. */
  step: number;
}

/**
 * Boundary hook. The solver updates only interior q faces, so with no hook the
 * outer faces stay 0: rigid walls, with the wall exactly on the outer face, so
 * Lx = nx*dx. A later CPML plugs in here.
 */
export interface Boundary {
  /** After the q update, before the u update. */
  afterQ?(s: FieldState): void;
  /** After the u update. */
  afterU?(s: FieldState): void;
}

/** Soft source: value(step) is added to u in cell (ix, iy) after each u update. */
export interface Source {
  ix: number;
  iy: number;
  value(step: number, t: number): number;
}

/** Probe: records u at a cell after every step. */
export interface Probe {
  ix: number;
  iy: number;
  samples: number[];
}

export class CpuSolver implements FieldState {
  readonly nx: number;
  readonly ny: number;
  readonly dt: number;
  readonly u: Float32Array;
  readonly qx: Float32Array;
  readonly qy: Float32Array;
  step = 0;
  readonly sources: Source[] = [];
  readonly probes: Probe[] = [];
  private readonly coef: Float32Array;
  private readonly invDx: number;

  constructor(
    cs: CoefficientSet,
    private readonly boundary: Boundary = {},
  ) {
    this.nx = cs.nx;
    this.ny = cs.ny;
    this.dt = cs.dt;
    this.coef = cs.coef;
    this.invDx = 1 / cs.dx;
    this.u = new Float32Array(cs.nx * cs.ny);
    this.qx = new Float32Array((cs.nx + 1) * cs.ny);
    this.qy = new Float32Array(cs.nx * (cs.ny + 1));
  }

  addSource(s: Source): void {
    this.check(s.ix, s.iy);
    this.sources.push(s);
  }

  addProbe(ix: number, iy: number): Probe {
    this.check(ix, iy);
    const p: Probe = { ix, iy, samples: [] };
    this.probes.push(p);
    return p;
  }

  private check(ix: number, iy: number): void {
    if (!(Number.isInteger(ix) && Number.isInteger(iy) && ix >= 0 && iy >= 0 && ix < this.nx && iy < this.ny)) {
      throw new RangeError(`cell (${ix},${iy}) outside grid`);
    }
  }

  run(steps: number): void {
    for (let n = 0; n < steps; n++) this.advance();
  }

  advance(): void {
    const { nx, ny, u, qx, qy, coef, invDx } = this;
    // q update (interior faces only).
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      const rowQx = j * (nx + 1);
      for (let i = 1; i < nx; i++) {
        const c = row + i;
        const k = 4 * c;
        qx[rowQx + i] = coef[k + 2]! * qx[rowQx + i]! - coef[k + 3]! * (u[c]! - u[c - 1]!) * invDx;
      }
    }
    for (let j = 1; j < ny; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        const c = row + i;
        const k = 4 * c;
        qy[c] = coef[k + 2]! * qy[c]! - coef[k + 3]! * (u[c]! - u[c - nx]!) * invDx;
      }
    }
    this.boundary.afterQ?.(this);
    // u update.
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      const rowQx = j * (nx + 1);
      for (let i = 0; i < nx; i++) {
        const c = row + i;
        const k = 4 * c;
        const div = qx[rowQx + i + 1]! - qx[rowQx + i]! + qy[c + nx]! - qy[c]!;
        u[c] = coef[k]! * u[c]! - coef[k + 1]! * div * invDx;
      }
    }
    this.step++;
    const t = this.step * this.dt;
    for (const s of this.sources) u[s.iy * nx + s.ix] = u[s.iy * nx + s.ix]! + s.value(this.step, t);
    this.boundary.afterU?.(this);
    for (const p of this.probes) p.samples.push(u[p.iy * nx + p.ix]!);
  }
}
