/**
 * Radar-look helpers. This file is copied as-is into both apps (apps/wifi-deadzone and apps/bass-ghost-finder),
 * because shared code lives in packages/** which these apps do not own. Keep the two copies identical.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LiveSim } from "@core/live";
import { PALETTE, SketchError, createAfterglow, importSketch, ramp, thump, type Afterglow, type SketchResult } from "@ui/index";

export { PALETTE, ramp, thump };

/** True when the system asks for less motion. Follows changes. */
export function useReducedMotion(): boolean {
  const [r, setR] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const f = () => setR(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return r;
}

/** CSS repeating stripes in the alert colour. The shape cue that goes with the alert colour. */
export const HATCH_CSS = `repeating-linear-gradient(135deg, ${PALETTE.alert} 0 3px, rgba(5,7,11,0.9) 3px 6px)`;

/** Fill the alert stripes into RGBA pixel k at cell (i, j): diagonal stripes, 4 cells wide. */
export function hatchPixel(i: number, j: number): boolean {
  return ((i + j) >> 2) % 2 === 0;
}

/**
 * Click-to-ping wave drawing. Steps a LiveSim a few steps per animation frame, paints |u| into a small
 * canvas, and lets @ui's afterglow (0.94) fade the trail. No React state per frame: the loop lives here.
 * The loop stops by itself when the pulse is done and the trail has faded, and it does nothing in a hidden tab.
 */
export class Pinger {
  readonly host: HTMLDivElement;
  private glow: Afterglow | null = null;
  private frame: HTMLCanvasElement | null = null;
  private img: ImageData | null = null;
  private sim: LiveSim | null = null;
  private stepsLeft = 0;
  private fadeLeft = 0;
  private peak = 1e-9;
  private raf = 0;
  /** Called with true when a wave starts and false when its trail is gone. */
  onActive: (active: boolean) => void = () => {};

  constructor(
    private stepsPerFrame: number,
    private runSteps: number,
  ) {
    this.host = document.createElement("div");
    this.host.className = "glow";
  }

  /** Use this sim from now on (the old one is the caller's to destroy). */
  attach(sim: LiveSim): void {
    this.cancel();
    this.sim = sim;
        this.glow = createAfterglow(sim.nx, sim.ny, 0.94);
    this.frame = document.createElement("canvas");
    this.frame.width = sim.nx;
    this.frame.height = sim.ny;
    this.img = this.frame.getContext("2d")!.createImageData(sim.nx, sim.ny);
    this.host.replaceChildren(this.glow.canvas as HTMLCanvasElement);
    this.peak = 1e-9;
  }

  ping(ix: number, iy: number): void {
    if (!this.sim) return;
    const wasIdle = this.stepsLeft <= 0 && this.fadeLeft <= 0;
    this.sim.addPulse(ix, iy, 1);
    this.stepsLeft = this.runSteps;
    this.fadeLeft = 70;
    if (wasIdle) this.onActive(true);
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  /** Stop and clear the picture. */
  cancel(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const was = this.stepsLeft > 0 || this.fadeLeft > 0;
    this.stepsLeft = 0;
    this.fadeLeft = 0;
    this.glow?.clear();
    if (was) this.onActive(false);
  }

  private tick = (): void => {
    this.raf = 0;
    const sim = this.sim;
    if (!sim || !this.glow || !this.frame || !this.img) return;
    if (document.hidden) {
      // Nothing is drawn in a hidden tab. Try again when it is visible.
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const ctx = this.frame.getContext("2d")!;
    if (this.stepsLeft > 0) {
      sim.advance(this.stepsPerFrame);
      this.stepsLeft -= this.stepsPerFrame;
      const u = sim.field();
      let mx = 0;
      for (let k = 0; k < u.length; k++) {
        const a = Math.abs(u[k]!);
        if (a > mx) mx = a;
      }
      this.peak = Math.max(this.peak * 0.97, mx);
      const inv = 1 / (this.peak + 1e-30);
      const d = this.img.data;
      for (let k = 0; k < u.length; k++) {
        const t = Math.min(1, Math.abs(u[k]!) * inv);
        const [r, g, b] = ramp(t);
        d[4 * k] = r;
        d[4 * k + 1] = g;
        d[4 * k + 2] = b;
        d[4 * k + 3] = 255;
      }
      ctx.putImageData(this.img, 0, 0);
    } else {
      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, this.frame.width, this.frame.height);
      this.fadeLeft--;
    }
    this.glow.frame(this.frame);
    if (this.stepsLeft > 0 || this.fadeLeft > 0) this.raf = requestAnimationFrame(this.tick);
    else {
      this.glow.clear();
      this.onActive(false);
    }
  };
}

export interface Mission {
  label: string;
  done: boolean;
}

/** Three 15-second goals. A tick (and a strike-through) shows a finished one: not colour alone. */
export function Missions({ items }: { items: Mission[] }) {
  return (
    <ul className="missions" aria-label="Try these, 15 seconds each">
      {items.map((m) => (
        <li key={m.label} className={m.done ? "done" : ""}>
          <span className="tick" aria-hidden>
            {m.done ? "\u2713" : "\u25CB"}
          </span>
          <span className="t15">15 s</span> {m.label}
        </li>
      ))}
    </ul>
  );
}

/** Before/after slider. `pos` is 0..100 (percent of the width that shows "before"). */
export function WipeBar({ pos, onChange, onClose }: { pos: number; onChange: (v: number) => void; onClose: () => void }) {
  return (
    <div className="wipebar">
      <span>Before</span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => onChange(+e.target.value)} aria-label="Compare before and after" />
      <span>After</span>
      <button onClick={onClose} aria-label="Hide the comparison">
        Hide
      </button>
    </div>
  );
}

export interface SketchApplied {
  result: SketchResult;
  /** The photo, already scaled so its longest side is at most 1024 px. */
  photo: HTMLCanvasElement;
}

/** "Use my floor plan": pick a photo, click two points of a known length, type the length. */
export function SketchDialog(props: { cellMetres: number; maxCols: number; maxRows: number; onApply: (a: SketchApplied) => void; onClose: () => void }) {
  const { cellMetres, maxCols, maxRows, onApply, onClose } = props;
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [pts, setPts] = useState<{ x: number; y: number }[]>([]);
  const [metres, setMetres] = useState("3");
  const [error, setError] = useState("");
  const view = useRef<HTMLCanvasElement>(null);

  const load = (f: File | undefined) => {
    if (!f) return;
    setError("");
    setPts([]);
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1024 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.naturalWidth * k));
      c.height = Math.max(1, Math.round(im.naturalHeight * k));
      c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      setPhoto(c);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      setError("That file is not a picture I can open. Try a JPG or PNG.");
    };
    im.src = url;
  };

  useEffect(() => {
    const c = view.current;
    if (!c || !photo) return;
    c.width = photo.width;
    c.height = photo.height;
    const g = c.getContext("2d")!;
    g.drawImage(photo, 0, 0);
    g.strokeStyle = PALETTE.teal;
    g.fillStyle = PALETTE.teal;
    g.lineWidth = 3;
    pts.forEach((p) => {
      g.beginPath();
      g.arc(p.x, p.y, 6, 0, Math.PI * 2);
      g.fill();
    });
    if (pts.length === 2) {
      g.beginPath();
      g.moveTo(pts[0]!.x, pts[0]!.y);
      g.lineTo(pts[1]!.x, pts[1]!.y);
      g.stroke();
    }
  }, [photo, pts]);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) * e.currentTarget.width) / r.width, y: ((e.clientY - r.top) * e.currentTarget.height) / r.height };
    setPts((old) => (old.length >= 2 ? [p] : [...old, p]));
  };

  const apply = () => {
    if (!photo || pts.length < 2) return;
    try {
      const img = photo.getContext("2d")!.getImageData(0, 0, photo.width, photo.height);
      const result = importSketch(img, {
        maxCols,
        maxRows,
        cellMetres,
        scale: { x1: pts[0]!.x, y1: pts[0]!.y, x2: pts[1]!.x, y2: pts[1]!.y, metres: parseFloat(metres) },
      });
      onApply({ result, photo });
    } catch (e) {
      setError(e instanceof SketchError ? e.message : `Could not read the plan: ${String(e)}`);
    }
  };

  return (
    <div className="modal" role="dialog" aria-label="Use my floor plan">
      <div className="card">
        <h2>Use my floor plan</h2>
        <ol>
          <li>Pick a photo or scan of your plan (dark pen on white paper works best).</li>
          <li>Click two points whose real distance you know, such as the two ends of one wall.</li>
          <li>Type that distance in metres.</li>
        </ol>
        <input type="file" accept="image/*" onChange={(e) => load(e.target.files?.[0])} />
        {photo && (
          <>
            <canvas ref={view} className="sketchview" onClick={click} />
            <label>
              Real distance between the 2 points, in metres{" "}
              <input type="number" min={0.1} step={0.1} value={metres} onChange={(e) => setMetres(e.target.value)} />
            </label>
            <div className="small">{pts.length === 0 ? "Click the first point." : pts.length === 1 ? "Click the second point." : "Ready. Click again to start over."}</div>
          </>
        )}
        {error && <div className="err">{error}</div>}
        <div className="row">
          <button onClick={apply} disabled={!photo || pts.length < 2}>
            Use this plan
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
        <div className="small">The photo stays on your computer. The map shows it faintly (15%) under the walls.</div>
      </div>
    </div>
  );
}

/** Panel opened by the "?" button. */
export function HelpPanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="help" role="dialog" aria-label="How this works">
      <button className="x" onClick={onClose} aria-label="Close help">
        &times;
      </button>
      {children}
    </div>
  );
}
