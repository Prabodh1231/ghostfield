import { F_MAX, F_MIN } from "./scene";

/** Response level (dB) at f, linear interpolation on the 20..300 Hz grid. */
export function levelAt(freqs: ArrayLike<number>, db: ArrayLike<number>, f: number): number {
  const i = Math.max(0, Math.min(freqs.length - 2, Math.floor(((f - F_MIN) / (F_MAX - F_MIN)) * (freqs.length - 1))));
  const t = Math.max(0, Math.min(1, (f - freqs[i]!) / (freqs[i + 1]! - freqs[i]!)));
  return db[i]! * (1 - t) + db[i + 1]! * t;
}

export const HARMONICS = 10;
export const MAX_HZ = 1200;
const REL_MIN = -24; // dB below the room's median level
const REL_MAX = 12;

/**
 * Laptop-mode harmonic levels for fundamental f. Harmonic k has weight (1/sqrt k) / sum, so all weights add to 1.
 * The whole stack is scaled by the simulated response at f relative to the median of the band:
 * a boom is louder (up to +12 dB), a null quieter (down to -24 dB). Total stays <= 1 * 10^(12/20) * 0.25 = 1.
 */
export function stackLevels(freqs: ArrayLike<number>, db: ArrayLike<number>, f: number): number[] {
  const sorted = Array.from(db as ArrayLike<number> as number[]).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  const rel = Math.max(REL_MIN, Math.min(REL_MAX, levelAt(freqs, db, f) - median));
  const gain = 0.25 * 10 ** (rel / 20);
  const ks = Array.from({ length: HARMONICS }, (_, i) => i + 1).filter((k) => k * f <= MAX_HZ);
  const w = ks.map((k) => 1 / Math.sqrt(k));
  const sum = w.reduce((a, b) => a + b, 0);
  return Array.from({ length: HARMONICS }, (_, i) => (i < ks.length ? (gain * w[i]!) / sum : 0));
}

export type PlayMode = "laptop" | "tone";

/**
 * Web Audio player. Safe by design: master volume starts at 5% and the slider tops out at 40%,
 * everything goes through a hard compressor used as a limiter, and start/stop fade over 0.2 s / 0.1 s.
 */
export class BassPlayer {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private oscs: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  volume = 0.05;
  playing = false;

  start(mode: PlayMode, f: number, levels: number[]): void {
    this.ctx ??= new AudioContext();
    const ctx = this.ctx;
    void ctx.resume();
    if (this.playing) this.stopNow();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(limiter).connect(ctx.destination);
    const n = mode === "laptop" ? HARMONICS : 1;
    this.oscs = [];
    this.gains = [];
    for (let k = 1; k <= n; k++) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = Math.min(MAX_HZ, k * f);
      const g = ctx.createGain();
      g.gain.value = mode === "laptop" ? levels[k - 1]! : 0.5;
      o.connect(g).connect(this.master);
      o.start();
      this.oscs.push(o);
      this.gains.push(g);
    }
    this.master.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.07);
    this.playing = true;
  }

  /** Follow a new frequency or new levels without clicks. */
  update(mode: PlayMode, f: number, levels: number[]): void {
    if (!this.ctx || !this.playing) return;
    const t = this.ctx.currentTime;
    this.oscs.forEach((o, i) => o.frequency.setTargetAtTime(Math.min(MAX_HZ, (i + 1) * f), t, 0.03));
    if (mode === "laptop") this.gains.forEach((g, i) => g.gain.setTargetAtTime(levels[i]!, t, 0.05));
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(0.4, v));
    if (this.ctx && this.playing) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  stop(): void {
    if (!this.ctx || !this.playing) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    const oscs = this.oscs;
    window.setTimeout(() => oscs.forEach((o) => o.stop()), 200);
    this.playing = false;
  }

  private stopNow(): void {
    this.oscs.forEach((o) => o.stop());
    this.playing = false;
  }
}
