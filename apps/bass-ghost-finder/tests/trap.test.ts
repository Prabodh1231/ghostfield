import { describe, expect, it } from "vitest";
import { responseSpectrum, runCpuResponse } from "@core/runtime/responseJob";
import { C0, DEFAULT_RF, buildResponseJob, defaultScene, type Scene, type TrapRf } from "../src/scene";

/**
 * Headless check with the CPU solver. Empty room 256x200 cells at 2.5 cm (6.4 m x 5.0 m), rigid walls.
 * 1. The response peaks at the (1,0), (0,1), (1,1) mode frequencies.
 * 2. A 60 cm corner superchunk lowers the (1,0) peak by a measured amount.
 * 3. Break check: with Rf = 0 the same trap does nothing.
 * Takes about a minute; run it alone.
 */
const DX = 0.025;
const LX = 256 * DX;
const LY = 200 * DX;
const SECONDS = 4;
const room: Scene = { ...defaultScene(), w: LX, h: LY, sub: { x: 0.2 * LX, y: 0.27 * LY }, seat: { x: 0.8 * LX, y: 0.74 * LY } };
const withChunk: Scene = { ...room, traps: [{ type: "chunk", x1: 0.01, y1: 0.01, x2: 0.01, y2: 0.01 }] };
const modeHz = (m: number, n: number) => (C0 / 2) * Math.sqrt((m / LX) ** 2 + (n / LY) ** 2);

function respond(scene: Scene, rf: TrapRf = DEFAULT_RF) {
  const { job } = buildResponseJob(scene, DX, SECONDS, rf);
  expect(job.cs.nx).toBe(256);
  expect(job.cs.ny).toBe(200);
  return runCpuResponse(job)!;
}

/** Peak of |H| within +-3% of f0, scanned every 0.05 Hz, parabolic refinement of the frequency. */
function peak(r: ReturnType<typeof respond>, f0: number): { f: number; db: number } {
  const freqs: number[] = [];
  for (let f = f0 * 0.97; f <= f0 * 1.03; f += 0.05) freqs.push(f);
  const h = responseSpectrum(r, freqs);
  let k = 1;
  for (let i = 1; i < h.length - 1; i++) if (h[i]! > h[k]!) k = i;
  const a = Math.log(h[k - 1]!);
  const b = Math.log(h[k]!);
  const c = Math.log(h[k + 1]!);
  const d = a - 2 * b + c;
  return { f: freqs[k]! + (d === 0 ? 0 : (0.5 * (a - c)) / d) * 0.05, db: 20 * Math.log10(h[k]!) };
}

describe("bass app headless check", () => {
  it(
    "peaks at the room modes; a corner superchunk lowers the (1,0) peak; Rf = 0 removes the effect",
    () => {
      const modes: [number, number][] = [[1, 0], [0, 1], [1, 1]];
      const lines: string[] = [`room ${LX} m x ${LY} m (256x200 @ 2.5 cm), ${SECONDS} s record, CPU solver`];
      const empty = respond(room);
      const E = modes.map(([m, n]) => peak(empty, modeHz(m, n)));
      lines.push("empty room: mode | formula Hz | measured Hz | error % | peak dB");
      modes.forEach(([m, n], i) => {
        const err = (100 * (E[i]!.f - modeHz(m, n))) / modeHz(m, n);
        lines.push(`(${m},${n}) | ${modeHz(m, n).toFixed(3)} | ${E[i]!.f.toFixed(3)} | ${err.toFixed(3)} | ${E[i]!.db.toFixed(2)}`);
        expect(Math.abs(err)).toBeLessThan(0.5);
      });

      const T = respond(withChunk);
      const broken = respond(withChunk, { foam: 5000, chunk: 0 });
      const dropT = modes.map((_, i) => peak(T, modeHz(...modes[i]!)).db - E[i]!.db);
      const dropB = modes.map((_, i) => peak(broken, modeHz(...modes[i]!)).db - E[i]!.db);
      lines.push("peak change vs empty room (dB): mode | superchunk Rf 10000 | superchunk Rf 0 (broken)");
      modes.forEach(([m, n], i) => lines.push(`(${m},${n}) | ${dropT[i]!.toFixed(2)} | ${dropB[i]!.toFixed(2)}`));
      console.log(lines.join("\n"));

      expect(dropT[0]!).toBeLessThan(-1); // the trap lowers the (1,0) peak by more than 1 dB
      expect(Math.abs(dropB[0]!)).toBeLessThan(0.01); // Rf = 0: same as empty
    },
    600_000,
  );
});
