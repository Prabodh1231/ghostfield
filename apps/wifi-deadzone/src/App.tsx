import { useCallback, useEffect, useRef, useState } from "react";
import { legendGradient, paintHeatmap } from "./heatmap";
import { WALL_MATERIALS, wallMaterial, type WallMaterialId } from "./materials";
import { CELL_M, buildJob, defaultScene, referencePower, toDb, type Scene, type Wall } from "./scene";
import { pickBackend, startSim, type Backend, type SimHandle } from "./sim";

const CANVAS_PX = 768;
const SNAP_M = 0.05;
const GRAB_M = 0.2;

type Tool = "wall" | "erase";
interface Status {
  text: string;
  fraction: number | null;
  error?: boolean;
}

function distToSeg(px: number, py: number, w: Wall): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / l2));
  return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy));
}

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [tool, setTool] = useState<Tool>("wall");
  const [material, setMaterial] = useState<WallMaterialId>("brick");
  const [draft, setDraft] = useState<Wall | null>(null);
  const [status, setStatus] = useState<Status>({ text: "Starting up…", fraction: null });
  const [stale, setStale] = useState(false);
  const [hasMap, setHasMap] = useState(false);
  const [cursorDb, setCursorDb] = useState<string>("");

  const heatRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const backendRef = useRef<Backend | null>(null);
  const simRef = useRef<SimHandle | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const dragRef = useRef<"router" | null>(null);
  const dbRef = useRef<Float32Array | null>(null);

  const roomM = backend ? backend.n * CELL_M : 0;

  useEffect(() => {
    pickBackend().then((b) => {
      backendRef.current = b;
      setBackend(b);
      const s = defaultScene(b.n * CELL_M);
      sceneRef.current = s;
      setScene(s);
      run();
    });
    return () => simRef.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(() => {
    const b = backendRef.current;
    const s = sceneRef.current;
    if (!b || !s) return;
    simRef.current?.cancel();
    const t0 = performance.now();
    try {
      const built = buildJob(s, b.n);
      setStatus({ text: "Starting…", fraction: 0 });
      const sim = startSim(b, built.job, (fraction, phase) =>
        setStatus({ text: phase === "settle" ? "Letting the waves spread…" : "Averaging the signal…", fraction }),
      );
      simRef.current = sim;
      sim.result
        .then((r) => {
          if (!r || simRef.current !== sim) return;
          const ref = referencePower(r.power, built, s.router);
          const db = toDb(r.power, ref);
          dbRef.current = db;
          paintHeatmap(heatRef.current!, db, built.n);
          setStale(false);
          setHasMap(true);
          setStatus({ text: `Done: ${r.steps} steps in ${((performance.now() - t0) / 1000).toFixed(1)} s`, fraction: null });
        })
        .catch((e) => setStatus({ text: `Simulation failed: ${String(e)}`, fraction: null, error: true }));
    } catch (e) {
      setStatus({ text: `Cannot start: ${String(e)}`, fraction: null, error: true });
    }
  }, []);

  /** Run again shortly after the last edit. */
  const scheduleRun = useCallback(() => {
    setStale(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(run, 250);
  }, [run]);

  const edit = useCallback(
    (next: Scene) => {
      sceneRef.current = next;
      setScene(next);
    },
    [],
  );

  // Floor plan overlay: walls, draft wall, router.
  useEffect(() => {
    const c = overlayRef.current;
    if (!c || !scene || !backend) return;
    c.width = CANVAS_PX;
    c.height = CANVAS_PX;
    const g = c.getContext("2d")!;
    const k = CANVAS_PX / roomM;
    g.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    const line = (w: Wall, alpha = 1) => {
      const info = wallMaterial(w.material);
      g.globalAlpha = alpha;
      g.strokeStyle = info.color;
      g.lineWidth = Math.max(3, info.thickness * k);
      g.lineCap = "butt";
      g.beginPath();
      g.moveTo(w.x1 * k, w.y1 * k);
      g.lineTo(w.x2 * k, w.y2 * k);
      g.stroke();
      g.globalAlpha = 1;
    };
    scene.walls.forEach((w) => line(w));
    if (draft) line(draft, 0.6);
    g.fillStyle = "#39ff88";
    g.strokeStyle = "#000";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(scene.router.x * k, scene.router.y * k, 9, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }, [scene, draft, backend, roomM]);

  const toM = (e: React.PointerEvent) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * roomM, y: ((e.clientY - r.top) / r.height) * roomM };
  };
  const snap = (v: number) => Math.min(roomM, Math.max(0, Math.round(v / SNAP_M) * SNAP_M));

  const onDown = (e: React.PointerEvent) => {
    if (!scene) return;
    const p = toM(e);
    overlayRef.current!.setPointerCapture(e.pointerId);
    if (Math.hypot(p.x - scene.router.x, p.y - scene.router.y) < GRAB_M) {
      dragRef.current = "router";
    } else if (tool === "wall") {
      setDraft({ x1: snap(p.x), y1: snap(p.y), x2: snap(p.x), y2: snap(p.y), material });
    } else {
      let best = -1;
      let bestD = GRAB_M;
      scene.walls.forEach((w, i) => {
        const d = distToSeg(p.x, p.y, w);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        edit({ ...scene, walls: scene.walls.filter((_, i) => i !== best) });
        scheduleRun();
      }
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!scene) return;
    const p = toM(e);
    if (dragRef.current === "router") {
      const m = 0.4; // keep the router out of the absorbing edge layer
      edit({ ...scene, router: { x: Math.min(roomM - m, Math.max(m, p.x)), y: Math.min(roomM - m, Math.max(m, p.y)) } });
    } else if (draft) {
      let x2 = snap(p.x);
      let y2 = snap(p.y);
      // Shift keeps the wall horizontal or vertical.
      if (e.shiftKey) {
        if (Math.abs(x2 - draft.x1) > Math.abs(y2 - draft.y1)) y2 = draft.y1;
        else x2 = draft.x1;
      }
      setDraft({ ...draft, x2, y2 });
    } else if (dbRef.current && backend) {
      const i = Math.floor(p.x / CELL_M);
      const j = Math.floor(p.y / CELL_M);
      const v = i >= 0 && j >= 0 && i < backend.n && j < backend.n ? dbRef.current[j * backend.n + i]! : null;
      setCursorDb(v === null ? "" : v > -10 ? "strong" : v > -25 ? "medium" : v > -45 ? "weak" : "dead");
    }
  };

  const onUp = () => {
    if (!scene) return;
    if (dragRef.current === "router") {
      dragRef.current = null;
      scheduleRun();
    } else if (draft) {
      if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) >= SNAP_M) edit({ ...scene, walls: [...scene.walls, draft] });
      setDraft(null);
      scheduleRun();
    }
  };

  const clearWalls = () => {
    if (!scene) return;
    edit({ ...scene, walls: [] });
    scheduleRun();
  };
  const resetScene = () => {
    if (!backend) return;
    edit(defaultScene(roomM));
    scheduleRun();
  };

  return (
    <div className="app">
      <a className="back" href="../">&larr; Back to home</a>
      <h1>Find the dead zone in your flat</h1>
      <p className="lead">This simulates Wi-Fi waves moving through a floor plan, right in your browser. The map shows where the signal is strong and where it dies.</p>
      <ol className="steps">
        <li><b>1</b> Draw walls: pick a material, then drag on the map.</li>
        <li><b>2</b> Drag the green dot (your router) to a new spot.</li>
        <li><b>3</b> Read the map: bright = strong signal, dark = weak or dead.</li>
      </ol>
      <div className="bar">
        <button className={tool === "wall" ? "on" : ""} onClick={() => setTool("wall")}>
          Draw wall
        </button>
        <button className={tool === "erase" ? "on" : ""} onClick={() => setTool("erase")}>
          Erase wall
        </button>
        <label>
          <span className="swatch" style={{ background: wallMaterial(material).color }} />
          <select value={material} onChange={(e) => setMaterial(e.target.value as WallMaterialId)}>
            {WALL_MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button onClick={clearWalls}>Clear walls</button>
        <button onClick={resetScene}>Back to example flat</button>
        <button onClick={run}>Redraw map</button>
      </div>
      <p className="note">
        The map redraws a moment after each change. Hold Shift while drawing for a straight wall.
      </p>
      <div className={`stage${stale ? " stale" : ""}`}>
        <canvas ref={heatRef} className="heat" />
        {!hasMap && (
          <div className="wait">
            <div>Working out the signal… a few seconds</div>
            <progress value={status.fraction ?? undefined} max={1} />
          </div>
        )}
        <canvas
          ref={overlayRef}
          className="overlay"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>
      <div className="legend">
        <strong>Signal strength</strong>
        <div className="grad" style={{ background: legendGradient() }} />
        <div className="ticks">
          <span>Dead</span>
          <span>Weak</span>
          <span>Strong</span>
        </div>
        <div className="note">Compared with the signal right next to the router. {cursorDb && `Under the cursor: ${cursorDb}`}</div>
        <div className="small">
          Honest note: this is a flat 2D picture of a Wi-Fi router, so the colours show relative strength, not exact signal. Real rooms are 3D, and in 2D the signal fades more slowly with distance.
        </div>
      </div>
      <div className={`status${status.error ? " err" : ""}`}>
        {status.text}
        {status.fraction !== null && <progress value={status.fraction} max={1} />}
      </div>
      {backend && <div className="small">Room is {roomM.toFixed(1)} m wide.</div>}
    </div>
  );
}
