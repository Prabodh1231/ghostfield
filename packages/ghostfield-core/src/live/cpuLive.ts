import { CpuSolver, rigidWalls, type Boundary } from "../cpu";
import { etd, waveSpeed, type Material } from "../coefficients";
import { PulseBank } from "./pulse";
import { MAX_PULSES, type LiveSim, type LiveSimOptions } from "./types";

export function checkCell(nx: number, ny: number, ix: number, iy: number): void {
  if (!(Number.isInteger(ix) && Number.isInteger(iy) && ix >= 0 && iy >= 0 && ix < nx && iy < ny)) {
    throw new RangeError(`cell (${ix},${iy}) outside grid`);
  }
}

/** Throws if the material is invalid or faster than the grid's CFL speed. */
export function checkMaterial(m: Material, cMax: number): void {
  if (!(m.C > 0 && m.L > 0 && m.gammaU >= 0 && m.gammaQ >= 0)) throw new RangeError("bad material");
  if (waveSpeed(m) > cMax * (1 + 1e-9)) throw new RangeError("material is faster than cs.cMax (CFL)");
}

/** [Au, Bu, Aq, Bq] for one cell. */
export function cellCoef(m: Material, dt: number): [number, number, number, number] {
  const u = etd(m.gammaU, dt, m.C);
  const q = etd(m.gammaQ, dt, m.L);
  return [u.A, u.B, q.A, q.B];
}

export function createCpuLive(opts: LiveSimOptions): LiveSim {
  const cs = { ...opts.cs, coef: Float32Array.from(opts.cs.coef) };
  const { nx, ny, dx, dt } = cs;
  const solid = opts.solid ? Uint8Array.from(opts.solid) : new Uint8Array(nx * ny);
  const bank = new PulseBank(opts.pulseHz ?? 400, dt);
  let walls: Boundary = rigidWalls(nx, ny, solid);
  let dirty = false;
  // The solver keeps one boundary object; this one forwards to the current wall lists.
  const solver = new CpuSolver(cs, { afterQ: (s) => walls.afterQ?.(s) });
  for (let k = 0; k < MAX_PULSES; k++) {
    solver.addSource({
      ix: 0,
      iy: 0,
      value: (step) => (bank.alive[k] ? bank.value(k, step) : 0),
    });
  }
  const sim: LiveSim = {
    backend: "cpu",
    nx,
    ny,
    dx,
    dt,
    get step() {
      return solver.step;
    },
    advance(n) {
      if (dirty) {
        walls = rigidWalls(nx, ny, solid);
        dirty = false;
      }
      for (let k = 0; k < MAX_PULSES; k++) {
        solver.sources[k]!.ix = bank.ix[k]!;
        solver.sources[k]!.iy = bank.iy[k]!;
      }
      solver.run(n);
    },
    field: () => solver.u,
    addPulse(x, y, amp) {
      checkCell(nx, ny, x, y);
      return bank.add(x, y, amp, solver.step);
    },
    setSolid(ix, iy, s) {
      checkCell(nx, ny, ix, iy);
      solid[iy * nx + ix] = s ? 1 : 0;
      solver.u[iy * nx + ix] = 0;
      dirty = true;
    },
    setMaterial(ix, iy, m) {
      checkCell(nx, ny, ix, iy);
      checkMaterial(m, cs.cMax);
      cs.coef.set(cellCoef(m, dt), 4 * (iy * nx + ix));
    },
    reset() {
      solver.u.fill(0);
      solver.qx.fill(0);
      solver.qy.fill(0);
      bank.clear();
    },
    destroy() {},
  };
  return sim;
}
