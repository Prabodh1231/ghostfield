import { describe, expect, it } from "vitest";
import { EPS0, FREQ_HZ, MU0, WALL_MATERIALS, ituEpsSigma, materialFor, toMaterial } from "../src/materials";

describe("ITU-R P.2040-3 material -> (C, L, gamma)", () => {
  it("maps every wall type at 2.4 GHz", () => {
    // epsr and sigma at 2.4 GHz computed by hand from Table 3 (a, b, c, d).
    const expected = {
      drywall: { epsr: 2.73, sigma: 0.0193 },
      glass: { epsr: 6.31, sigma: 0.0116 },
      wood: { epsr: 1.99, sigma: 0.012 },
      brick: { epsr: 3.91, sigma: 0.0274 },
      concrete: { epsr: 5.24, sigma: 0.0916 },
      metal: { epsr: 1, sigma: 1e7 },
    } as const;
    for (const w of WALL_MATERIALS) {
      const e = expected[w.id];
      const { epsr, sigma } = ituEpsSigma(w.itu, FREQ_HZ / 1e9);
      expect(epsr).toBeCloseTo(e.epsr, 2);
      expect(sigma / e.sigma).toBeCloseTo(1, 2);
      const m = materialFor(w.id);
      expect(m.C).toBeCloseTo(EPS0 * e.epsr, 22);
      expect(m.L).toBe(MU0);
      expect(m.gammaU).toBeCloseTo(sigma / (EPS0 * epsr), -3);
      expect(m.gammaQ).toBe(0);
    }
  });

  it("air has no loss and C = eps0", () => {
    expect(toMaterial(1, 0)).toEqual({ C: EPS0, L: MU0, gammaU: 0, gammaQ: 0 });
  });
});
