/**
 * One-step-at-a-time coach banner. The bass app has its own copy (apps/bass-ghost-finder/src/coach.tsx),
 * because shared code would have to live in packages/**. Only the step texts differ.
 */
import { useEffect, useState } from "react";

/** Each text is 12 words or fewer (checked by a test). */
export const WIFI_STEPS: readonly string[] = [
  "Tap the red area. Your laptop gets no Wi-Fi there.",
  "Drag the router to a new spot. Watch the map change.",
  "Drag the bar to compare before and after.",
  "Tap anywhere to send a wave. Watch it spread.",
  "Draw a wall: press Draw wall, then drag on the map.",
];
export const WIFI_END = "Nice! Try moving the laptop to find a good spot.";

/** True once the same step has been showing for `ms` without being done. Resets when the step changes. */
export function useWaited(step: number, ms = 20000): boolean {
  const [w, setW] = useState(false);
  useEffect(() => {
    setW(false);
    const t = window.setTimeout(() => setW(true), ms);
    return () => window.clearTimeout(t);
  }, [step, ms]);
  return w;
}

export function Coach(props: { steps: readonly string[]; end: string; index: number; onSkip: () => void }) {
  const { steps, end, index, onSkip } = props;
  if (index > steps.length) return null;
  const ending = index === steps.length;
  return (
    <div className="chip coach" role="status" aria-live="polite">
      <div className="coach-top">
        <strong>{ending ? "Done" : `Step ${index + 1} of ${steps.length}`}</strong>
        {!ending && (
          <button className="link" onClick={onSkip}>
            Skip
          </button>
        )}
      </div>
      <div className="coach-text">{ending ? end : steps[index]}</div>
    </div>
  );
}

/** Ring on the map at a spot given as fractions of the map side. Pulses when `pulse` (the step has waited too long). */
export function Ring({ fx, fy, pulse }: { fx: number; fy: number; pulse: boolean }) {
  return <div className={`ring${pulse ? " pulse" : ""}`} style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }} aria-hidden />;
}
