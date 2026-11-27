export const PALETTE = { bg: "#05070B", teal: "#38F2D6", alert: "#FF3B5C" } as const;

const LO = [0x05, 0x07, 0x0b] as const;
const HI = [0x38, 0xf2, 0xd6] as const;

/** Maps t in 0..1 (clamped) to [r,g,b] 0..255 on the straight ramp #05070B to #38F2D6. */
export function ramp(t: number): [number, number, number] {
  const k = t < 0 || Number.isNaN(t) ? 0 : t > 1 ? 1 : t;
  return [0, 1, 2].map((i) => Math.round(LO[i]! + (HI[i]! - LO[i]!) * k)) as [number, number, number];
}
