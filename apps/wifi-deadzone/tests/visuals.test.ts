import { describe, expect, it } from "vitest";
import { WIFI_END, WIFI_STEPS } from "../src/coach";
import { findDeadZones, levelWord, smoothPower } from "../src/heatmap";

describe("round 10 visuals", () => {
  it("smoothPower keeps a flat field flat and spreads a spike without losing its total", () => {
    const n = 64;
    const flat = new Float32Array(n * n).fill(2);
    expect(Math.max(...smoothPower(flat, n).map((v) => Math.abs(v - 2)))).toBeLessThan(1e-5);
    const spike = new Float32Array(n * n);
    spike[32 * n + 32] = 169;
    const s = smoothPower(spike, n);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(169, 2);
    expect(s[32 * n + 32]).toBeCloseTo(1, 4);
  });

  it("words: -9 / -15 / -25 / -40 are Great / OK / Weak / None", () => {
    expect([-9, -15, -25, -40].map(levelWord)).toEqual(["Great", "OK", "Weak", "None"]);
  });

  it("dead zones: a big patch counts, a speck and a thin line do not", () => {
    const n = 200;
    const db = new Float32Array(n * n).fill(-5);
    for (let j = 60; j < 100; j++) for (let i = 60; i < 100; i++) db[j * n + i] = -50; // 1600 cells
    for (let j = 120; j < 124; j++) for (let i = 120; i < 124; i++) db[j * n + i] = -50; // speck
    for (let i = 20; i < 190; i++) db[150 * n + i] = -50; // thin line
    const z = findDeadZones(db, n);
    expect(z.blobs).toHaveLength(1);
    expect(z.blobs[0]!.area).toBe(1600);
  });

  it("coach steps are 12 words or fewer", () => {
    for (const t of [...WIFI_STEPS, WIFI_END]) expect(t.split(/\s+/).length).toBeLessThanOrEqual(12);
  });
});
