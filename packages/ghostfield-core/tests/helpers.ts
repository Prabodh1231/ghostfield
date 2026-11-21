import { buildCoefficients, dtFromCourant, DEFAULT_COURANT, type Material } from "../src/coefficients";
import { CpuSolver, type Boundary } from "../src/cpu";

/** Normalised free space for CPML and spreading tests: C = L = 1, dx = 1, so c = 1 and dt = S. */
export const UNIT_AIR: Material = { C: 1, L: 1, gammaU: 0, gammaQ: 0 };

/** Ricker wavelet. f0 in cycles per unit time; zero mean. */
export function ricker(f0: number, t0 = 1.5 / f0) {
  return (_n: number, t: number) => {
    const a = (Math.PI * f0 * (t - t0)) ** 2;
    return (1 - 2 * a) * Math.exp(-a);
  };
}

/** Build a solver for a material grid at the default Courant number. */
export function makeSolver(
  nx: number,
  ny: number,
  dx: number,
  materialAt: (ix: number, iy: number) => Material,
  boundary: (cs: ReturnType<typeof buildCoefficients>) => Boundary = () => ({}),
) {
  // dt from the fastest speed 1/sqrt(minC*minL).
  let minC = Infinity;
  let minL = Infinity;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const m = materialAt(i, j);
      minC = Math.min(minC, m.C);
      minL = Math.min(minL, m.L);
    }
  const dt = dtFromCourant(DEFAULT_COURANT, dx, 1 / Math.sqrt(minC * minL));
  const cs = buildCoefficients(nx, ny, dx, dt, materialAt);
  return { cs, solver: new CpuSolver(cs, boundary(cs)) };
}

/** Max |a-b| over equal-length arrays. */
export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

export function maxAbs(a: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
}
