import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLiveSim, type LiveSim } from "@core/live";
import { drawUnderlay } from "@ui/index";
import { DEAD_DB, legendGradient, paintHeatmap } from "./heatmap";
import { FREQ_HZ, WALL_MATERIALS, wallMaterial, type WallMaterialId } from "./materials";
import { HATCH_CSS, HelpPanel, Missions, Pinger, SketchDialog, WipeBar, thump, useReducedMotion, type SketchApplied } from "./radar";
import { CELL_M, buildJob, defaultScene, referencePower, toDb, type Scene, type Wall } from "./scene";
import { pickBackend, startSim, type Backend, type SimHandle } from "./sim";

const CANVAS_PX = 768;
const SNAP_M = 0.05;
const GRAB_M = 0.2;
/** Live pulse: steps per animation frame (GPU / CPU), and how long a pulse runs, in room crossings. */
const SPF_GPU = 10;
const SPF_CPU = 4;
const COURANT = 0.693;

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

function levelWord(v: number): string {
  return v > -10 ? "strong" : v > -20 ? "medium" : v > DEAD_DB ? "weak" : "dead";
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [hintGone, setHintGone] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [toast, setToast] = useState("");
  const [wipe, setWipe] = useState({ show: false, pos: 50 });
  const [photoVersion, setPhotoVersion] = useState(0);
  const [done, setDone] = useState({ dead: false, moved: false, wiped: false, ping: false });
  const reduced = useReducedMotion();

  const mapRef = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const underRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const backendRef = useRef<Backend | null>(null);
  const simRef = useRef<SimHandle | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const dragRef = useRef<"router" | null>(null);
  const clickRef = useRef<{ x: number; y: number } | null>(null);
  const dbRef = useRef<Float32Array | null>(null);
  const hasMapRef = useRef(false);
  const frozenRef = useRef(false);
  const liveRef = useRef<LiveSim | null>(null);
  const pingerRef = useRef<Pinger | null>(null);
  const photoRef = useRef<{ photo: HTMLCanvasElement; wM: number; hM: number } | null>(null);

  const roomM = backend ? backend.n * CELL_M : 0;

  const say = useCallback((text: string, ms = 7000) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), ms);
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
          hasMapRef.current = true;
          setHasMap(true);
          if (frozenRef.current) {
            frozenRef.current = false;
            setWipe({ show: true, pos: 50 });
          }
          setStatus({ text: `Done: ${r.steps} steps in ${((performance.now() - t0) / 1000).toFixed(1)} s`, fraction: null });
        })
        .catch((e) => setStatus({ text: `Simulation failed: ${String(e)}`, fraction: null, error: true }));
    } catch (e) {
      setStatus({ text: `Cannot start: ${String(e)}`, fraction: null, error: true });
    }
  }, []);

  useEffect(() => {
    pickBackend().then((b) => {
      backendRef.current = b;
      setBackend(b);
      const s = defaultScene(b.n * CELL_M);
      sceneRef.current = s;
      setScene(s);
      const crossing = b.n / COURANT;
      const p = new Pinger(b.kind === "webgpu" ? SPF_GPU : SPF_CPU, Math.round(1.6 * crossing));
      p.onActive = setPinging;
      pingerRef.current = p;
      const m = mapRef.current;
      if (m) m.insertBefore(p.host, overlayRef.current);
      run();
    });
    return () => {
      simRef.current?.cancel();
      pingerRef.current?.cancel();
      liveRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Run again shortly after the last edit. */
  const scheduleRun = useCallback(() => {
    setStale(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(run, 250);
  }, [run]);

  const edit = useCallback((next: Scene) => {
    // The first edit after a settled map keeps that map as "before" for the wipe slider.
    if (hasMapRef.current && !frozenRef.current && heatRef.current && beforeRef.current) {
      const h = heatRef.current;
      const b = beforeRef.current;
      b.width = h.width;
      b.height = h.height;
      b.getContext("2d")!.drawImage(h, 0, 0);
      frozenRef.current = true;
    }
    // The live wave belongs to the old floor plan.
    pingerRef.current?.cancel();
    liveRef.current?.destroy();
    liveRef.current = null;
    sceneRef.current = next;
    setScene(next);
  }, []);

  /** Canvas for the imported walls, drawn once per import. */
  const importedCanvas = useMemo(() => {
    const imp = scene?.imported;
    if (!imp) return null;
    const c = document.createElement("canvas");
    c.width = imp.cols;
    c.height = imp.rows;
    const g = c.getContext("2d")!;
    const img = g.createImageData(imp.cols, imp.rows);
    const col = wallMaterial("brick").color;
    const rgb = [1, 3, 5].map((i) => parseInt(col.slice(i, i + 2), 16));
    for (let k = 0; k < imp.mask.length; k++)
      if (imp.mask[k]) {
        img.data[4 * k] = rgb[0]!;
        img.data[4 * k + 1] = rgb[1]!;
        img.data[4 * k + 2] = rgb[2]!;
        img.data[4 * k + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return c;
  }, [scene?.imported]);

  // Floor plan overlay: imported walls, walls, draft wall, router.
  useEffect(() => {
    const c = overlayRef.current;
    if (!c || !scene || !backend) return;
    c.width = CANVAS_PX;
    c.height = CANVAS_PX;
    const g = c.getContext("2d")!;
    const k = CANVAS_PX / roomM;
    g.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    if (importedCanvas && scene.imported) {
      g.imageSmoothingEnabled = false;
      g.drawImage(importedCanvas, 0, 0, scene.imported.cols * CELL_M * k, scene.imported.rows * CELL_M * k);
    }
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
    g.fillStyle = "#ffffff";
    g.strokeStyle = "#05070b";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(scene.router.x * k, scene.router.y * k, 10, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.strokeStyle = "#38f2d6";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(scene.router.x * k, scene.router.y * k, 16, 0, Math.PI * 2);
    g.stroke();
  }, [scene, draft, backend, roomM, importedCanvas]);

  // Faint photo of the paper plan, 15%, under the walls.
  useEffect(() => {
    const c = underRef.current;
    if (!c || !roomM) return;
    c.width = CANVAS_PX;
    c.height = CANVAS_PX;
    const p = photoRef.current;
    if (!p) return;
    const k = CANVAS_PX / roomM;
    drawUnderlay(c.getContext("2d")!, p.photo, p.wM * k, p.hM * k, 0.15);
  }, [photoVersion, roomM]);

  const toM = (e: React.PointerEvent) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * roomM, y: ((e.clientY - r.top) / r.height) * roomM };
  };
  const snap = (v: number) => Math.min(roomM, Math.max(0, Math.round(v / SNAP_M) * SNAP_M));

  const wordAt = (p: { x: number; y: number }): string => {
    if (!dbRef.current || !backend) return "";
    const i = Math.floor(p.x / CELL_M);
    const j = Math.floor(p.y / CELL_M);
    return i >= 0 && j >= 0 && i < backend.n && j < backend.n ? levelWord(dbRef.current[j * backend.n + i]!) : "";
  };

  /** A click that was not a drag: send a live pulse from that spot. */
  const ping = (p: { x: number; y: number }) => {
    const b = backendRef.current;
    const pg = pingerRef.current;
    if (!b || !pg || !sceneRef.current) return;
    thump();
    setDone((d) => ({ ...d, ping: true }));
    if (reduced) {
      say("Your system asks for less motion, so the wave is not animated. The thump still plays.");
      return;
    }
    try {
      if (!liveRef.current) {
        const built = buildJob(sceneRef.current, b.n);
        const sim = createLiveSim({ cs: built.job.cs, backend: b.kind === "webgpu" ? "gpu" : "cpu", device: b.kind === "webgpu" ? b.device : undefined, pulseHz: FREQ_HZ });
        liveRef.current = sim;
        pg.attach(sim);
      }
      const sim = liveRef.current;
      pg.ping(Math.min(sim.nx - 1, Math.max(0, Math.floor(p.x / CELL_M))), Math.min(sim.ny - 1, Math.max(0, Math.floor(p.y / CELL_M))));
      const ratio = 1 / 60 / ((b.kind === "webgpu" ? SPF_GPU : SPF_CPU) * sim.dt);
      say(`Slowed down about ${Math.round(ratio / 1e6)} million times so you can watch it. Real Wi-Fi crosses a room in about 25 billionths of a second. The thump is just for feel.`, 9000);
    } catch (e) {
      say(`Ping is not available here: ${String(e)}`);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (!scene) return;
    setHintGone(true);
    const p = toM(e);
    if (wordAt(p) === "dead") setDone((d) => ({ ...d, dead: true }));
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
      } else clickRef.current = p;
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
    } else {
      const w = wordAt(p);
      setCursorDb(w);
      if (w === "dead") setDone((d) => (d.dead ? d : { ...d, dead: true }));
    }
  };

  const onUp = () => {
    if (!scene) return;
    if (dragRef.current === "router") {
      dragRef.current = null;
      setDone((d) => ({ ...d, moved: true }));
      scheduleRun();
    } else if (draft) {
      if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) >= SNAP_M) {
        edit({ ...scene, walls: [...scene.walls, draft] });
        scheduleRun();
      } else ping({ x: draft.x1, y: draft.y1 });
      setDraft(null);
    } else if (clickRef.current) {
      ping(clickRef.current);
      clickRef.current = null;
    }
  };

  const clearWalls = () => {
    if (!scene) return;
    photoRef.current = null;
    setPhotoVersion((v) => v + 1);
    edit({ walls: [], router: scene.router });
    scheduleRun();
  };
  const resetScene = () => {
    if (!backend) return;
    photoRef.current = null;
    setPhotoVersion((v) => v + 1);
    edit(defaultScene(roomM));
    scheduleRun();
  };

  const applySketch = ({ result, photo }: SketchApplied) => {
    if (!scene) return;
    photoRef.current = { photo, wM: result.cols * result.metresPerCell, hM: result.rows * result.metresPerCell };
    setPhotoVersion((v) => v + 1);
    const m = 0.5;
    edit({ walls: [], router: { x: Math.min(roomM - m, Math.max(m, scene.router.x)), y: Math.min(roomM - m, Math.max(m, scene.router.y)) }, imported: { mask: result.solid, cols: result.cols, rows: result.rows } });
    setSketchOpen(false);
    scheduleRun();
  };

  const missions = [
    { label: "Find the dead zone (hover over the striped red area)", done: done.dead },
    { label: "Move the router, then wipe to compare", done: done.moved && done.wiped },
    { label: "Click anywhere to ping and watch the wave", done: done.ping },
  ];

  return (
    <>
      <div className="stage">
        <div ref={mapRef} className={`map${stale ? " stale" : ""}${pinging ? " pinging" : ""}`} style={{ width: "min(100vw, calc(100vh - 130px))", aspectRatio: "1" }}>
          <canvas ref={heatRef} className="heat" />
          <canvas ref={beforeRef} className="before" style={{ visibility: wipe.show ? "visible" : "hidden", clipPath: `inset(0 ${100 - wipe.pos}% 0 0)` }} />
          <canvas ref={underRef} className="under" />
          {!hasMap && (
            <div className="wait">
              <div>Working out the signal… a few seconds</div>
              <progress value={status.fraction ?? undefined} max={1} />
            </div>
          )}
          <canvas ref={overlayRef} className="overlay" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        </div>
      </div>

      <div className="chip title">
        <a href="../">&larr; Home</a>
        <h1>Find the dead zone in your flat</h1>
      </div>
      <Missions items={missions} />
      <div className="topright">
        <div className={`chip status${status.error ? " err" : ""}`}>
          {status.text}
          {status.fraction !== null && <progress value={status.fraction} max={1} style={{ width: 90, marginLeft: 8 }} />}
        </div>
        <button className="chip qbtn" onClick={() => setHelpOpen((v) => !v)} aria-label="How does this work?" aria-expanded={helpOpen}>
          ?
        </button>
      </div>
      {helpOpen && (
        <HelpPanel onClose={() => setHelpOpen(false)}>
          <h2>How this works</h2>
          <p>This simulates Wi-Fi waves moving through a floor plan, right in your browser. The map shows where the signal is strong and where it dies.</p>
          <ol>
            <li>Draw walls: pick a material, then drag on the map.</li>
            <li>Drag the white dot (your router) to a new spot.</li>
            <li>Read the map: bright teal = strong signal, dark = weak, red stripes = dead.</li>
          </ol>
          <p>Click anywhere (without dragging) to send one pulse and watch it spread. Hold Shift while drawing for a straight wall. The map redraws a moment after each change; then drag the Before/After slider to compare.</p>
          <p className="small">
            Honest note: this is a flat 2D picture of a Wi-Fi router, so the colours show relative strength, not exact signal. Real rooms are 3D, and in 2D the signal fades more slowly with distance. The pulse is a slowed-down movie; the steady map is the main result. Room is {roomM.toFixed(1)} m wide
            {backend ? `, running on ${backend.kind === "webgpu" ? "your graphics chip" : "your processor"}` : ""}.
          </p>
        </HelpPanel>
      )}
      <div className={`chip hint${hintGone || !hasMap ? " gone" : ""}`}>Click anywhere to ping</div>
      {toast && <div className="chip toast">{toast}</div>}
      {wipe.show && (
        <WipeBar
          pos={wipe.pos}
          onChange={(v) => {
            setWipe({ show: true, pos: v });
            setDone((d) => ({ ...d, wiped: true }));
          }}
          onClose={() => setWipe({ show: false, pos: 50 })}
        />
      )}
      <div className="chip dock">
        <div className="legend">
          <strong>Signal strength</strong>
          <div className="grad" style={{ background: legendGradient() }} />
          <div className="ticks">
            <span>Weak</span>
            <span>Strong</span>
          </div>
          <div className="key">
            <span>
              <span className="hatch" style={{ background: HATCH_CSS }} />
              Dead zone (red stripes)
            </span>
            {cursorDb && <span>Under cursor: {cursorDb}</span>}
          </div>
        </div>
        <div className="tools">
          <button className={tool === "wall" ? "on" : ""} onClick={() => setTool("wall")}>
            Draw wall
          </button>
          <button className={tool === "erase" ? "on" : ""} onClick={() => setTool("erase")}>
            Erase wall
          </button>
          <label>
            <span className="swatch" style={{ background: wallMaterial(material).color }} />
            <select value={material} onChange={(e) => setMaterial(e.target.value as WallMaterialId)} aria-label="Wall material">
              {WALL_MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={clearWalls}>Clear walls</button>
          <button onClick={resetScene}>Example flat</button>
          <button onClick={() => setSketchOpen(true)}>Use my floor plan</button>
        </div>
      </div>
      {sketchOpen && backend && (
        <SketchDialog cellMetres={CELL_M} maxCols={backend.n} maxRows={backend.n} onApply={applySketch} onClose={() => setSketchOpen(false)} />
      )}
    </>
  );
}
