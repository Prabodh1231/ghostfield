let ac: AudioContext | null = null;

/** Soft low thump (falling sine). Call from a click or key handler so the browser allows audio. */
export function thump(opts: { volume?: number; pitchHz?: number } = {}): void {
  const Ctor =
    typeof window !== "undefined"
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Ctor) return;
  try {
    ac ??= new Ctor();
    if (ac.state === "suspended") void ac.resume();
    const vol = Math.min(1, Math.max(0, opts.volume ?? 0.5));
    const f = opts.pitchHz ?? 70;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f * 2.5, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  } catch {
    /* audio is optional */
  }
}
