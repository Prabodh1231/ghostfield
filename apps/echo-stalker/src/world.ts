import type { LiveSim } from "@core/live";
import { airMaterial, type Profile } from "./config";
import type { LevelData } from "./levels";
import { gradientHeading, integrateEnergy } from "./monster";
import { buildSurface, updateGlow, type WallSurface } from "./wallGlow";

export interface Input {
  mx: number;
  my: number;
  sneak: boolean;
  clap: boolean;
  /** Where the player clicked, in metres. */
  throwAt: { x: number; y: number } | null;
}

/** Things that happened this update. The page turns them into sound and rings. */
export interface GameEvent {
  kind: "clap" | "step" | "pebble" | "mstep";
  x: number;
  y: number;
}

export interface Monster {
  x: number;
  y: number;
  wander: number;
  hunt: number;
  hunting: boolean;
  /** Heading, unit vector. */
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  stepDist: number;
  /** Where it was a moment ago, to notice being stuck. */
  checkX: number;
  checkY: number;
  checkT: number;
}

/** Loudness of each sound, as a share of a clap. */
export const LOUD = { clap: 1, pebble: 0.55, step: 0.12 };
const PLAYER_R = 0.22;
const MONSTER_R = 0.25;
const CATCH_DIST = 0.6;
const EXIT_DIST = 0.6;

export class World {
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;
  readonly surface: WallSurface;
  /** Wall glow per surface cell (u^2, leaky max). */
  readonly glow: Float32Array;
  /** Leaky-integrated wave energy the monster listens to. */
  readonly energy: Float32Array;
  readonly monsters: Monster[];
  px: number;
  py: number;
  status: "play" | "caught" | "won" = "play";
  time = 0;
  events: GameEvent[] = [];
  private stepsF = 0;
  private clapCd = 0;
  private pebbleCd = 0;
  private stepDist = 0;
  private pebbles: { t: number; x: number; y: number }[] = [];
  private rand: () => number;

  constructor(
    readonly sim: LiveSim,
    readonly p: Profile,
    readonly level: LevelData,
    rand: () => number = Math.random,
  ) {
    this.nx = level.nx;
    this.ny = level.ny;
    this.dx = p.dx;
    this.rand = rand;
    this.surface = buildSurface(level.solid, this.nx, this.ny);
    this.glow = new Float32Array(this.surface.cells.length);
    this.energy = new Float32Array(this.nx * this.ny);
    [this.px, this.py] = level.start;
    this.monsters = level.monsters.map((s) => ({
      ...s,
      hunting: false,
      hx: 1,
      hy: 0,
      tx: s.x,
      ty: s.y,
      stepDist: 0,
      checkX: s.x,
      checkY: s.y,
      checkT: 0,
    }));
    // Stealth zones: higher flow resistance, set cell by cell on the live sim.
    const porous = airMaterial(p, p.zoneRf);
    for (let i = 0; i < level.porous.length; i++) if (level.porous[i] && !level.solid[i]) sim.setMaterial(i % this.nx, Math.floor(i / this.nx), porous);
  }

  solidAt(x: number, y: number): boolean {
    const ix = Math.floor(x / this.dx);
    const iy = Math.floor(y / this.dx);
    return ix < 0 || iy < 0 || ix >= this.nx || iy >= this.ny || this.level.solid[iy * this.nx + ix] === 1;
  }

  /** True if a circle of radius r at (x, y) touches a wall (8 points on the rim + the centre). */
  blocked(x: number, y: number, r: number): boolean {
    if (this.solidAt(x, y)) return true;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      if (this.solidAt(x + Math.cos(a) * r, y + Math.sin(a) * r)) return true;
    }
    return false;
  }

  /** Move by (mx, my) metres in small steps, sliding along walls. Returns the distance moved. */
  private move(o: { x: number; y: number }, mx: number, my: number, r: number): number {
    const n = Math.max(1, Math.ceil(Math.hypot(mx, my) / 0.03));
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const sx = mx / n;
      const sy = my / n;
      if (!this.blocked(o.x + sx, o.y, r)) { o.x += sx; moved += Math.abs(sx); }
      if (!this.blocked(o.x, o.y + sy, r)) { o.y += sy; moved += Math.abs(sy); }
    }
    return moved;
  }

  private emit(kind: GameEvent["kind"], x: number, y: number, loud: number) {
    this.events.push({ kind, x, y });
    if (kind === "mstep") return; // the monster's steps are only drawn and heard, never put into the sim
    const ix = Math.min(this.nx - 2, Math.max(1, Math.floor(x / this.dx)));
    const iy = Math.min(this.ny - 2, Math.max(1, Math.floor(y / this.dx)));
    this.sim.addPulse(ix, iy, this.p.clapAmp * loud);
  }

  /** First wall hit on the way from the player to (x, y), at most 8 m, stopping just before it. */
  pebbleLanding(x: number, y: number): { x: number; y: number } {
    const d = Math.hypot(x - this.px, y - this.py);
    const len = Math.min(8, d);
    if (d < 0.01) return { x: this.px, y: this.py };
    const ux = (x - this.px) / d;
    const uy = (y - this.py) / d;
    let t = 0;
    while (t + 0.05 <= len && !this.solidAt(this.px + ux * (t + 0.05), this.py + uy * (t + 0.05))) t += 0.05;
    return { x: this.px + ux * t, y: this.py + uy * t };
  }

  update(rawDt: number, inp: Input): void {
    if (this.status !== "play") return;
    const dt = Math.min(rawDt, 0.05);
    this.time += dt;
    this.clapCd -= dt;
    this.pebbleCd -= dt;

    // player
    const len = Math.hypot(inp.mx, inp.my);
    if (len > 0) {
      const v = (inp.sneak ? 1.5 : 3) * dt;
      const o = { x: this.px, y: this.py };
      const moved = this.move(o, (inp.mx / len) * v, (inp.my / len) * v, PLAYER_R);
      this.px = o.x;
      this.py = o.y;
      if (!inp.sneak) {
        this.stepDist += moved;
        if (this.stepDist >= 1.2) {
          this.stepDist -= 1.2;
          this.emit("step", this.px, this.py, LOUD.step);
        }
      }
    }
    if (inp.clap && this.clapCd <= 0) {
      this.clapCd = 0.8;
      this.emit("clap", this.px, this.py, LOUD.clap);
    }
    if (inp.throwAt && this.pebbleCd <= 0) {
      this.pebbleCd = 0.5;
      const l = this.pebbleLanding(inp.throwAt.x, inp.throwAt.y);
      this.pebbles.push({ t: 0.25, ...l });
    }
    for (const b of this.pebbles) b.t -= dt;
    for (const b of this.pebbles.filter((q) => q.t <= 0)) this.emit("pebble", b.x, b.y, LOUD.pebble);
    this.pebbles = this.pebbles.filter((q) => q.t > 0);

    // wave field
    this.stepsF += (this.p.timeScale * dt) / this.sim.dt;
    const n = Math.min(300, Math.floor(this.stepsF));
    this.stepsF -= Math.floor(this.stepsF);
    if (n > 0) this.sim.advance(n);
    const u = this.sim.field();
    updateGlow(this.glow, this.surface, u, Math.exp(-dt / 0.9));
    integrateEnergy(this.energy, u, Math.exp(-dt / 1.5));

    for (const m of this.monsters) this.updateMonster(m, dt);

    for (const m of this.monsters) if (Math.hypot(m.x - this.px, m.y - this.py) < CATCH_DIST) this.status = "caught";
    if (Math.hypot(this.level.exit[0] - this.px, this.level.exit[1] - this.py) < EXIT_DIST && this.status === "play") this.status = "won";
  }

  private updateMonster(m: Monster, dt: number) {
    const h = gradientHeading(this.energy, this.nx, this.ny, this.dx, m.x, m.y, 1.6, 0.004);
    m.hunting = h !== null;
    let wantX: number;
    let wantY: number;
    let speed: number;
    if (h) {
      wantX = h.dx;
      wantY = h.dy;
      speed = m.wander + (m.hunt - m.wander) * Math.min(1, h.strength / 0.05);
    } else {
      // quiet: walk to a random spot, pick a new one on arrival or when stuck. Never slower than `wander`.
      m.checkT += dt;
      if (m.checkT > 0.8) {
        const stuck = Math.hypot(m.x - m.checkX, m.y - m.checkY) < 0.25 * m.wander;
        m.checkX = m.x;
        m.checkY = m.y;
        m.checkT = 0;
        if (stuck) this.pickTarget(m);
      }
      const d = Math.hypot(m.tx - m.x, m.ty - m.y);
      if (d < 0.4) this.pickTarget(m);
      wantX = (m.tx - m.x) / Math.max(d, 1e-6);
      wantY = (m.ty - m.y) / Math.max(d, 1e-6);
      speed = m.wander;
    }
    // turn smoothly
    const k = 1 - Math.exp(-dt * 6);
    let hx = m.hx + (wantX - m.hx) * k;
    let hy = m.hy + (wantY - m.hy) * k;
    const hl = Math.hypot(hx, hy) || 1;
    hx /= hl;
    hy /= hl;
    m.hx = hx;
    m.hy = hy;
    const moved = this.move(m, hx * speed * dt, hy * speed * dt, MONSTER_R);
    m.stepDist += moved;
    if (m.stepDist >= 1.0) {
      m.stepDist -= 1.0;
      this.emit("mstep", m.x, m.y, 0);
    }
  }

  private pickTarget(m: Monster) {
    for (let tries = 0; tries < 20; tries++) {
      const a = this.rand() * 2 * Math.PI;
      const r = 2 + this.rand() * 5;
      const x = m.x + Math.cos(a) * r;
      const y = m.y + Math.sin(a) * r;
      if (!this.blocked(x, y, MONSTER_R)) {
        m.tx = x;
        m.ty = y;
        return;
      }
    }
    m.tx = m.x;
    m.ty = m.y;
  }
}
