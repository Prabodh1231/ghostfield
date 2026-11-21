import { useCallback, useEffect, useRef, useState } from "react";
import { DB_MAX, DB_MIN, legendGradient, paintHeatmap } from "./heatmap";
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
  const [status, setStatus] = useState<Status>({ text: "Detecting backend…", fraction: null });
  const [stale, setStale] = useState(false);
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
      setCursorDb(v === null ? "" : `${v.toFixed(1)} dB`);
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
      <h1>GhostField: Wi-Fi dead zones</h1>
      <p className="note">
        2D model of a 2.4 GHz router. Not a calibrated measurement: real rooms are 3D, and a 2D field fades more slowly with distance.
      </p>
      <div className="bar">
        <span>
          Backend:{" "}
          <strong>
            {!backend ? "…" : backend.kind === "webgpu" ? "WebGPU" : "CPU (Web Worker)"}
          </strong>
          {backend && (
            <>
              {" "}
              · {backend.n}×{backend.n} cells @ {(CELL_M * 100).toFixed(1)} cm · room {roomM.toFixed(2)} m
              {backend.kind === "cpu" && ` · WebGPU not used: ${backend.reason}`}
            </>
          )}
        </span>
      </div>
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
        <button onClick={resetScene}>Example flat</button>
        <button onClick={run}>Run again</button>
      </div>
      <p className="note">
        Drag the green router. Draw a wall by dragging (hold Shift for straight lines). The map updates after each change.
      </p>
      <div className={`stage${stale ? " stale" : ""}`}>
        <canvas ref={heatRef} className="heat" />
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
        <strong>Relative signal (2D model)</strong>
        <div className="grad" style={{ background: legendGradient() }} />
        <div className="ticks">
          <span>{DB_MIN} dB</span>
          <span>{DB_MAX} dB</span>
        </div>
        <div className="note">0 dB = the average level on a ring 0.5 m around the router. Time-averaged |Ez|² of a 2.4 GHz wave. {cursorDb && `Under the cursor: ${cursorDb}`}</div>
      </div>
      <div className={`status${status.error ? " err" : ""}`}>
        {status.text}
        {status.fraction !== null && <progress value={status.fraction} max={1} />}
      </div>
    </div>
  );
}
