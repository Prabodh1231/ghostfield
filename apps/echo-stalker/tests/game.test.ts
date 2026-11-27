import { describe, expect, it } from "vitest";
import { buildCoefficients, dtFromCourant, DEFAULT_COURANT } from "@core/coefficients";
import { createLiveSim } from "@core/live";
import { C0 } from "@core/live/acoustics";
import { CPU_PROFILE, TILES_X, TILES_Y, TILE_M, airMaterial } from "../src/config";
import { LEVELS, rasterize, reachable } from "../src/levels";
import { gradientHeading } from "../src/monster";
import { buildSurface, updateGlow } from "../src/wallGlow";
import { World, type Input } from "../src/world";

const still: Input = { mx: 0, my: 0, sneak: false, clap: false, throwAt: null };

describe("levels", () => {
  for (const l of LEVELS) {
    it(`${l.name}: shape, start, exit and monsters are valid and reachable`, () => {
      expect(l.tiles.length).toBe(TILES_Y);
      for (const r of l.tiles) expect(r.length).toBe(TILES_X);
      const seen = reachable(l, l.start);
      const ok = (p: [number, number]) => seen.has(Math.floor(p[1] / TILE_M) * TILES_X + Math.floor(p[0] / TILE_M));
      expect(ok(l.exit)).toBe(true);
      for (const m of l.monsters) expect(ok([m.x, m.y])).toBe(true);
    });
  }
});

describe("wallGlow", () => {
  // 5x3 room, walls all around; one wave sample next to the left wall
  const nx = 5;
  const ny = 3;
  const solid = new Uint8Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) if (i % nx === 0 || i % nx === nx - 1 || i < nx || i >= nx * 2) solid[i] = 1;
  const s = buildSurface(solid, nx, ny);
  it("only wall cells that touch air get a glow slot", () => {
    for (const c of s.cells) expect(solid[c]).toBe(1);
    expect(s.cells.length).toBe(2 + 3 + 3);
  });
  it("jumps up when a wave is next to the wall, then decays", () => {
    const glow = new Float32Array(s.cells.length);
    const u = new Float32Array(nx * ny);
    u[1 * nx + 1] = 0.5;
    updateGlow(glow, s, u, 0.9);
    const lit = Array.from(s.cells).indexOf(1 * nx + 0);
    expect(glow[Array.from(s.cells).indexOf(2 * nx + 2)]).toBe(0);
    expect(glow[lit]).toBeCloseTo(0.25, 6);
    u.fill(0);
    updateGlow(glow, s, u, 0.9);
    expect(glow[lit]).toBeCloseTo(0.225, 6);
  });
});

describe("monster gradient step", () => {
  const nx = 40;
  const ny = 20;
  const E = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) E[y * nx + x] = Math.exp(-((x - 30) ** 2 + (y - 10) ** 2) / 50);
  it("heads toward the louder side", () => {
    const h = gradientHeading(E, nx, ny, 0.1, 1.5, 1.0, 1.0, 1e-4);
    expect(h).not.toBeNull();
    expect(h!.dx).toBeGreaterThan(0.9);
  });
  it("returns null when it is quiet", () => {
    expect(gradientHeading(new Float32Array(nx * ny), nx, ny, 0.1, 1.5, 1.0, 1.0, 1e-4)).toBeNull();
  });
});

describe("headless game (CPU profile, level 1)", () => {
  const p = CPU_PROFILE;
  const make = (r?: () => number) => {
    const dt = dtFromCourant(DEFAULT_COURANT, p.dx, C0);
    const lvl = rasterize(LEVELS[0]!, p);
    const cs = buildCoefficients(p.nx, p.ny, p.dx, dt, () => airMaterial(p));
    const sim = createLiveSim({ cs, backend: "cpu", solid: lvl.solid, pulseHz: p.pulseHz });
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return new World(sim, p, lvl, r ?? rand);
  };

  it("a clap lights up walls and the monster walks toward it", () => {
    const w = make();
    w.px = 14.0 * TILE_M;
    w.py = 12.5 * TILE_M;
    const m = w.monsters[0]!;
    const d0 = Math.hypot(m.x - w.px, m.y - w.py);
    w.update(1 / 60, { ...still, clap: true });
    let lit = 0;
    for (let t = 0; t < 6; t += 1 / 60) {
      w.update(1 / 60, still);
      lit = Math.max(lit, ...w.glow);
    }
    const d1 = Math.hypot(m.x - w.px, m.y - w.py);
    console.log("monster distance before/after 6 s", d0.toFixed(2), d1.toFixed(2), "max wall glow", lit.toExponential(2), "status", w.status);
    expect(lit).toBeGreaterThan(1e-3);
    expect(d1).toBeLessThan(d0 - 1);
  }, 60000);

  it("picks a reachable open spot when every random try is blocked", () => {
    const w = make(() => 0);
    const m = w.monsters[0]!;
    m.x = w.nx * w.dx - 1; // rand() = 0 aims 2 m to the right, outside the map: every try is blocked
    w.pickTarget(m);
    expect(Math.hypot(m.tx - m.x, m.ty - m.y)).toBeGreaterThanOrEqual(1);
    expect(w.blocked(m.tx, m.ty, 0.25)).toBe(false);
  });
  it("keeps moving when nothing is heard", () => {
    const w = make();
    const m = w.monsters[0]!;
    let far = 0;
    for (let t = 0; t < 8; t += 1 / 60) {
      w.update(1 / 60, still);
      far = Math.max(far, Math.hypot(m.x - 22.5 * TILE_M, m.y - 12.5 * TILE_M));
    }
    console.log("wander range after 8 s", far.toFixed(2), "m, hunting:", m.hunting);
    expect(far).toBeGreaterThan(1);
  }, 60000);
});

describe("sketch to level", () => {
  it("ignores a margin outside the drawn walls and puts start, monster and exit on open floor", async () => {
    const { sketchToLevel } = await import("../src/sketchLevel");
    const cols = 120;
    const rows = 80;
    const m = new Uint8Array(cols * rows);
    const wall = (x: number, y: number) => (m[y * cols + x] = 1);
    for (let x = 8; x < 112; x++) { wall(x, 8); wall(x, 71); wall(x, 72); }
    for (let y = 8; y < 72; y++) { wall(8, y); wall(111, y); wall(60, y < 36 || y > 44 ? y : 0); }
    const lvl = sketchToLevel(m, cols, rows, CPU_PROFILE);
    const cell = (p: [number, number]) => Math.floor(p[1] / CPU_PROFILE.dx) * CPU_PROFILE.nx + Math.floor(p[0] / CPU_PROFILE.dx);
    for (const p of [lvl.start, lvl.exit, [lvl.monsters[0]!.x, lvl.monsters[0]!.y] as [number, number]]) {
      expect(lvl.solid[cell(p)]).toBe(0);
      expect(p[0]).toBeGreaterThan(0.9); // inside the walls, not in the margin
      expect(p[1]).toBeGreaterThan(0.9);
    }
    expect(Math.hypot(lvl.exit[0] - lvl.start[0], lvl.exit[1] - lvl.start[1])).toBeGreaterThan(4);
  });
});

describe("sketch distance check", () => {
  it("rejects blank, zero, negative and non-number distances with a plain message", async () => {
    const { metresProblem } = await import("../src/sketchLevel");
    for (const bad of ["", "  ", "0", "-3", "abc"]) expect(metresProblem(bad)).toMatch(/real distance/);
    expect(metresProblem("12.5")).toBeNull();
  });
});
