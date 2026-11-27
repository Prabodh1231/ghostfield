import { describe, it } from "vitest";
import { buildCoefficients, dtFromCourant, DEFAULT_COURANT } from "@core/coefficients";
import { createLiveSim } from "@core/live";
import { C0 } from "@core/live/acoustics";
import { CPU_PROFILE, GPU_PROFILE, airMaterial, type Profile } from "../src/config";

function run(p: Profile, rf: number) {
  const dt = dtFromCourant(DEFAULT_COURANT, p.dx, C0);
  const cs = buildCoefficients(p.nx, p.ny, p.dx, dt, () => airMaterial(p));
  const sim = createLiveSim({ cs, backend: "cpu", pulseHz: p.pulseHz });
  const cx = Math.round(p.nx / 4), cy = Math.round(p.ny / 2);
  if (rf > 0) {
    // porous slab 1.2 m wide, 3 m tall, 2 m to the right of the source
    for (let y = cy - Math.round(1.5 / p.dx); y <= cy + Math.round(1.5 / p.dx); y++)
      for (let x = cx + Math.round(2 / p.dx); x < cx + Math.round(3.2 / p.dx); x++) sim.setMaterial(x, y, airMaterial(p, rf));
  }
  sim.addPulse(cx, cy, p.clapAmp);
  const at = (m: number) => cx + Math.round(m / p.dx) + cy * p.nx - cx;
  const peak = { m1: 0, m3: 0, m5: 0 };
  const tEnd = 0.25; // simulated seconds
  const n = Math.round(tEnd / dt);
  const energy: number[] = [];
  for (let i = 0; i < n; i += 5) {
    sim.advance(5);
    const u = sim.field();
    peak.m1 = Math.max(peak.m1, Math.abs(u[cy * p.nx + cx + Math.round(1 / p.dx)]!));
    peak.m3 = Math.max(peak.m3, Math.abs(u[cy * p.nx + cx + Math.round(3.5 / p.dx)]!));
    peak.m5 = Math.max(peak.m5, Math.abs(u[cy * p.nx + cx + Math.round(5.5 / p.dx)]!));
    if (i % 200 === 0) energy.push(u.reduce((a, v) => a + v * v, 0));
  }
  void at;
  return { peak, energy };
}

describe("calibration (prints numbers)", () => {
  for (const p of [CPU_PROFILE, GPU_PROFILE]) {
    it(p.name, () => {
      const open = run(p, 0);
      const zone = run(p, p.zoneRf);
      console.log(p.name, "open peaks 1m/3.5m/5.5m", open.peak, "with zone", zone.peak, "energy", open.energy.map((e) => e.toExponential(1)).join(" "));
    }, 120000);
  }
});
