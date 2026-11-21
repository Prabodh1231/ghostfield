import type { Material } from "@core/coefficients";

/** Free-space constants (CODATA 2018). */
export const EPS0 = 8.8541878128e-12;
export const MU0 = 1.25663706212e-6;
export const C0 = 1 / Math.sqrt(EPS0 * MU0);

/** Wi-Fi channel centre used by the app, 2.4 GHz. */
export const FREQ_HZ = 2.4e9;

/**
 * Wall materials from Recommendation ITU-R P.2040-3 (08/2023), "Effects of building materials and
 * structures on radiowave propagation above about 100 MHz", Section 3, Table 3 (values a, b, c, d),
 * Eqs. (57) and (58):
 *     real relative permittivity  epsr  = a * f^b      (f in GHz)
 *     conductivity (S/m)          sigma = c * f^d
 *
 *   Material               a      b     c        d        range (GHz)   epsr @2.4  sigma @2.4 (S/m)
 *   Plasterboard (drywall) 2.73   0     0.0085   0.9395   1-100         2.73       0.0193
 *   Glass                  6.31   0     0.0036   1.3394   0.1-100       6.31       0.0116
 *   Wood                   1.99   0     0.0047   1.0718   0.001-100     1.99       0.0120
 *   Brick                  3.91   0     0.0238   0.16     1-10          3.91       0.0274
 *   Concrete               5.24   0     0.0462   0.7822   1-100         5.24       0.0916
 *   Metal                  1      0     1e7      0        1-100         1          1e7
 *
 * Source check: these a, b, c, d were read from the table as reproduced in the MathWorks
 * `buildingMaterialPermittivity` documentation (which states it repeats Table 3 of P.2040-3), not from
 * the ITU PDF itself. The unit test recomputes the 2.4 GHz columns from a, b, c, d.
 * The wall THICKNESSES below are NOT from ITU; they are typical values chosen for this app.
 */
export interface ItuRow {
  a: number;
  b: number;
  c: number;
  d: number;
}

export type WallMaterialId = "drywall" | "glass" | "wood" | "brick" | "concrete" | "metal";

export interface WallMaterialInfo {
  id: WallMaterialId;
  label: string;
  itu: ItuRow;
  /** Wall thickness in metres (app choice, at least one cell when drawn). */
  thickness: number;
  /** Colour on the floor plan. */
  color: string;
}

export const WALL_MATERIALS: readonly WallMaterialInfo[] = [
  { id: "drywall", label: "Drywall (plasterboard)", itu: { a: 2.73, b: 0, c: 0.0085, d: 0.9395 }, thickness: 0.015, color: "#c9b99a" },
  { id: "glass", label: "Glass", itu: { a: 6.31, b: 0, c: 0.0036, d: 1.3394 }, thickness: 0.01, color: "#5ec8e5" },
  { id: "wood", label: "Wood", itu: { a: 1.99, b: 0, c: 0.0047, d: 1.0718 }, thickness: 0.04, color: "#a0693a" },
  { id: "brick", label: "Brick", itu: { a: 3.91, b: 0, c: 0.0238, d: 0.16 }, thickness: 0.1, color: "#b5483a" },
  { id: "concrete", label: "Concrete", itu: { a: 5.24, b: 0, c: 0.0462, d: 0.7822 }, thickness: 0.2, color: "#8a8a8a" },
  { id: "metal", label: "Metal", itu: { a: 1, b: 0, c: 1e7, d: 0 }, thickness: 0.01, color: "#2b2f6b" },
];

export function wallMaterial(id: WallMaterialId): WallMaterialInfo {
  return WALL_MATERIALS.find((m) => m.id === id)!;
}

/** ITU Eqs. (57), (58) at f GHz. */
export function ituEpsSigma(row: ItuRow, fGHz: number): { epsr: number; sigma: number } {
  return { epsr: row.a * fGHz ** row.b, sigma: row.c * fGHz ** row.d };
}

/** Canonical-system material: C = eps0*epsr, L = mu0, gammaU = sigma / (eps0*epsr), gammaQ = 0. */
export function toMaterial(epsr: number, sigma: number): Material {
  const C = EPS0 * epsr;
  return { C, L: MU0, gammaU: sigma / C, gammaQ: 0 };
}

export const AIR: Material = toMaterial(1, 0);

/** Material of a wall type at 2.4 GHz. */
export function materialFor(id: WallMaterialId, fHz = FREQ_HZ): Material {
  const { epsr, sigma } = ituEpsSigma(wallMaterial(id).itu, fHz / 1e9);
  return toMaterial(epsr, sigma);
}
