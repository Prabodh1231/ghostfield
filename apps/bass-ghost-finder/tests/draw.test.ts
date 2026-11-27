import { describe, expect, it } from "vitest";
import { COACH_STEPS } from "../src/coach";
import { findSpots, pickMode, seatWord } from "../src/draw";

describe("room picture helpers", () => {
  it("picks the (0,1) standing wave for 5 x 4 m at 40 Hz", () => {
    expect(pickMode(5, 4, 40)).toEqual({ m: 0, n: 1 });
  });
  it("finds the loudest block and the quietest block", () => {
    const nx = 40;
    const ny = 30;
    const power = new Float32Array(nx * ny).fill(0.5);
    power[10 * nx + 30] = 5;
    power[20 * nx + 5] = 0;
    const { loud, quiet } = findSpots(power, new Uint8Array(nx * ny), nx, ny, 0.1, 0.5, 1);
    expect(Math.hypot(loud[0]!.x - 3.05, loud[0]!.y - 1.05)).toBeLessThan(0.5);
    expect(Math.hypot(quiet[0]!.x - 0.55, quiet[0]!.y - 2.05)).toBeLessThan(0.5);
    expect(loud.length).toBe(2);
  });
  it("seat words", () => {
    expect([seatWord(8), seatWord(0), seatWord(-8)]).toEqual(["Boomy", "OK", "Thin"]);
  });
  it("coach steps are 12 words or fewer and avoid jargon", () => {
    for (const s of COACH_STEPS) {
      expect(s.text.split(/\s+/).length).toBeLessThanOrEqual(12);
      expect(s.text).not.toMatch(/ping|wipe|trap|dB|Hz/i);
    }
  });
});
