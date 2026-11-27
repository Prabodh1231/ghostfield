import { describe, expect, it } from "vitest";
import { BassPlayer, HARMONICS } from "../src/audio";

class Param {
  value = 0;
  target: number | null = null;
  setTargetAtTime(v: number) { this.target = v; }
}
const made: { gains: Param[] } = { gains: [] };
const node = () => ({ connect: (n: unknown) => n, start() {}, stop() {}, frequency: new Param(), gain: new Param(), threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
class FakeCtx {
  currentTime = 0;
  destination = {};
  resume() { return Promise.resolve(); }
  createDynamicsCompressor() { return node(); }
  createOscillator() { return node(); }
  createGain() { const n = node(); made.gains.push(n.gain); return n; }
}

describe("BassPlayer mode change while playing", () => {
  it("laptop -> tone silences harmonics 2..10; tone -> laptop restores the room levels", () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
    const levels = Array.from({ length: HARMONICS }, (_, i) => 0.1 + i * 0.01);
    const p = new BassPlayer();
    p.start("laptop", 60, levels);
    const g = made.gains.slice(1); // [0] is the master gain
    expect(g.length).toBe(HARMONICS);
    p.update("tone", 60, levels);
    expect(g.map((x) => x.target)).toEqual([0.5, ...Array(HARMONICS - 1).fill(0)]);
    p.update("laptop", 60, levels);
    expect(g.map((x) => x.target)).toEqual(levels);
  });
});
