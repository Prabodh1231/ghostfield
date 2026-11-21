import { describe, it, expect } from "vitest";
import { Cpml, type CpmlOptions } from "../src/cpu";
import { UNIT_AIR, makeSolver, maxAbs, ricker } from "./helpers";

/**
 * Test 5: CPML reflection < -60 dB, measured on a SMALL domain against a LARGE reference.
 *
 * Units: C = L = 1, dx = 1, so c = 1 and one wavelength at the pulse centre
 * (f0 = 0.08 cycles per cell-time) is 12.5 cells, like 2.4 GHz on 1 cm cells.
 *
 * Small domain: 200x200 cells, 16-cell CPML on all four sides (rigid wall behind it).
 * Reference: the same pulse in a 584x584 rigid-wall domain, big enough that no wall
 * reflection reaches any probe before the run ends. Both runs see the same source and
 * probes (same cell, same time). Anything the small domain adds is reflection from its layer:
 *   R_dB = 20 log10( max_t |u_small - u_ref| / max_t |u_ref| ),  per probe, worst probe reported.
 * The pulse is broadband (about 0.02..0.2 cycles/cell, 50..5 cells per wavelength).
 *
 * Angles: a pulse from a point source meets a wall at every angle from 0 up to the
 * angle subtended by the wall edge. Two source positions are used and the largest
 * incidence angle seen on any wall (corner zones excluded) is printed and stated:
 *   centre (100,100): up to ~ 50 deg, source 84 cells from each CPML interface
 *   offset (100, 40): up to ~ 74 deg on the bottom wall (24 cells from its interface)
 * Normal incidence is covered too (the wave front that meets the wall head on).
 */
const env = process.env;
const N = 200;
const T = 16;
const NREF = 584;
const OFF = (NREF - N) / 2;
const STEPS = Number(env.GF_STEPS ?? 450);
const LIMIT_DB = -60;
const opts: CpmlOptions = {
  r0: Number(env.GF_R0 ?? 1e-8),
  kappaMax: Number(env.GF_KMAX ?? 2),
  alphaMax: Number(env.GF_AMAX ?? 0.02),
};
const NO_CPML = env.GF_BREAK === "none"; // break check: no absorbing layer at all

function incidenceDeg(sx: number, sy: number): number {
  // Largest angle from the wall normal to the far edge of the wall (corner zones of width T excluded).
  const walls = [
    { dist: sx - T, lat: Math.max(sy - T, N - T - sy) },
    { dist: N - T - sx, lat: Math.max(sy - T, N - T - sy) },
    { dist: sy - T, lat: Math.max(sx - T, N - T - sx) },
    { dist: N - T - sy, lat: Math.max(sx - T, N - T - sx) },
  ];
  return Math.max(...walls.map((w) => (Math.atan2(w.lat, w.dist) * 180) / Math.PI));
}

function run(sx: number, sy: number, probes: [number, number][], big: boolean): number[][] {
  const n = big ? NREF : N;
  const o = big ? OFF : 0;
  const { solver } = makeSolver(n, n, 1, () => UNIT_AIR, big || NO_CPML ? () => ({}) : (cs) => new Cpml(cs, opts));
  solver.addSource({ ix: sx + o, iy: sy + o, value: ricker(0.08) });
  const ps = probes.map(([x, y]) => solver.addProbe(x + o, y + o));
  solver.run(STEPS);
  return ps.map((p) => p.samples);
}

describe("test 5: CPML reflection", () => {
  for (const [sx, sy] of [
    [100, 100],
    [100, 40],
  ] as const) {
    it(
      `source (${sx},${sy}): worst probe reflection < ${LIMIT_DB} dB`,
      () => {
        // 8 probes on a ring of radius 20 (all angles), 4 near the CPML interfaces.
        const probes: [number, number][] = [];
        for (let k = 0; k < 8; k++)
          probes.push([Math.round(sx + 20 * Math.cos((k * Math.PI) / 4)), Math.round(sy + 20 * Math.sin((k * Math.PI) / 4))]);
        probes.push([T + 2, sy], [N - T - 2, sy], [sx, T + 2], [sx, N - T - 2]);
        const small = run(sx, sy, probes, false);
        const ref = run(sx, sy, probes, true);
        const lines = [`source (${sx},${sy}), max incidence angle on a wall = ${incidenceDeg(sx, sy).toFixed(1)} deg, ${STEPS} steps`];
        lines.push(`CPML: ${T} cells, order 3, r0=${opts.r0}, kappaMax=${opts.kappaMax}, alphaMax=${opts.alphaMax}`);
        let worst = -Infinity;
        probes.forEach((p, k) => {
          const err = small[k]!.map((v, i) => v - ref[k]![i]!);
          const db = 20 * Math.log10(Math.max(maxAbs(err), 1e-30) / maxAbs(ref[k]!));
          worst = Math.max(worst, db);
          lines.push(`probe (${p}) reflection ${db.toFixed(1)} dB`);
        });
        lines.push(`WORST ${worst.toFixed(1)} dB (limit ${LIMIT_DB} dB)`);
        console.log(lines.join("\n"));
        expect(worst).toBeLessThan(LIMIT_DB);
      },
      300_000,
    );
  }
});
