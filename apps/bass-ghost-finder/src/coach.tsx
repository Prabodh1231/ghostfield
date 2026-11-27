/** One-step-at-a-time helper banner. Copied per app on purpose (not shared through packages/). */

export type CoachTarget = "boom" | "play" | "foam" | "bar" | "couch";
export interface CoachStep {
  text: string;
  target: CoachTarget;
}

/** Each text is 12 words or fewer (checked in tests/coach.test.ts). */
export const COACH_STEPS: CoachStep[] = [
  { text: "Red rings show where bass booms. Teal is loud, dark is quiet.", target: "boom" },
  { text: "Press Play to hear the bass from your seat.", target: "play" },
  { text: "Press Add foam, then drag along a wall.", target: "foam" },
  { text: "Foam soaks up bass. Press Play again and listen.", target: "play" },
  { text: "Drag the bar to compare before and after.", target: "bar" },
  { text: "Nice! Now drag the couch to a quiet spot.", target: "couch" },
];

export function Coach({ step, onSkip }: { step: number; onSkip: () => void }) {
  const s = COACH_STEPS[step];
  if (!s) return null;
  const last = step === COACH_STEPS.length - 1;
  return (
    <div className="chip coach" role="status" aria-live="polite">
      <div className="coachtop">
        <span className="small">{last ? "All done" : `Step ${step + 1} of ${COACH_STEPS.length - 1}`}</span>
        <button className="link" onClick={onSkip}>
          {step === 0 ? "Got it" : last ? "Close" : "Skip"}
        </button>
      </div>
      <div className="coachtext">{s.text}</div>
    </div>
  );
}
