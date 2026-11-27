import { describe, expect, it } from "vitest";
import { DOOR_HOLD_S, DOOR_OPEN_S, doorAngle, doorDone, doorIsVertical, stepDoor, turnToward } from "../src/sprites";

describe("door", () => {
  it("stays closed until the player arrives, then opens in about DOOR_OPEN_S", () => {
    expect(stepDoor(0, 0.1, false, false)).toBe(0);
    let o = 0;
    for (let t = 0; t < DOOR_OPEN_S; t += 0.05) o = stepDoor(o, 0.05, true, false);
    expect(o).toBeGreaterThan(0.9);
    expect(stepDoor(o, 1, true, false)).toBe(1);
  });
  it("jumps straight to open when reduced motion is on", () => {
    expect(stepDoor(0, 0.016, true, true)).toBe(1);
  });
  it("swings from 0 to about 85 degrees", () => {
    expect(doorAngle(0)).toBe(0);
    expect(doorAngle(1)).toBeGreaterThan(1.4);
    expect(doorAngle(1)).toBeLessThan(Math.PI / 2);
  });
  it("shows the win screen only after it is open and held", () => {
    expect(doorDone(0.5, 5)).toBe(false);
    expect(doorDone(1, DOOR_HOLD_S - 0.01)).toBe(false);
    expect(doorDone(1, DOOR_HOLD_S)).toBe(true);
  });
  it("lies along the nearest wall", () => {
    const wallOnRight = (x: number) => x > 5;
    expect(doorIsVertical((x) => wallOnRight(x), 4.5, 3)).toBe(true);
    const wallBelow = (_x: number, y: number) => y > 5;
    expect(doorIsVertical(wallBelow, 3, 4.5)).toBe(false);
  });
});

describe("player facing", () => {
  it("turns toward the wanted direction and stays a unit vector", () => {
    const [x, y] = turnToward(1, 0, 0, 1, 0.5);
    expect(Math.hypot(x, y)).toBeCloseTo(1);
    expect(y).toBeGreaterThan(0.5);
  });
});
