import { describe, it, expect } from "vitest";
import fc from "fast-check";

describe("smoke", () => {
  it("runs vitest and fast-check", () => {
    expect(1 + 1).toBe(2);
    fc.assert(fc.property(fc.integer(), (n) => n + 0 === n), { seed: 1 });
  });
});
