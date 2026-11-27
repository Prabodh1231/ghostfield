import { DEFAULT_COURANT, buildCoefficients, dtFromCourant, type CoefficientSet, type Material } from "../coefficients";

/** Air at room temperature. Shared by the bass app and acoustic games. */
export const RHO0 = 1.2; // kg/m^3
export const C0 = 343; // m/s

/** Loss rate of q for a porous cell. gamma_q = Rf / rho_eff (rho_eff = rho0, no tortuosity). Rf in Pa s/m^2. */
export const gammaQ = (rf: number, rhoEff = RHO0): number => rf / rhoEff;

/** Air material, optionally porous (flow resistivity rf, 0 = plain air). */
export function acousticMaterial(rf = 0): Material {
  return { C: 1 / (RHO0 * C0 * C0), L: RHO0, gammaU: 0, gammaQ: gammaQ(rf) };
}

/** Material lookup for a grid with a flow-resistivity map `room.rf` (row-major, nx wide). */
export function makeMaterialAt(room: { nx: number; rf: Float32Array }): (ix: number, iy: number) => Material {
  return (ix, iy) => acousticMaterial(room.rf[iy * room.nx + ix]!);
}

/** Coefficients for an acoustic room at the default Courant number. `rf` optional. */
export function acousticCoefficients(nx: number, ny: number, dx: number, rf?: Float32Array): CoefficientSet {
  const dt = dtFromCourant(DEFAULT_COURANT, dx, C0);
  return buildCoefficients(nx, ny, dx, dt, rf ? makeMaterialAt({ nx, rf }) : () => acousticMaterial());
}
