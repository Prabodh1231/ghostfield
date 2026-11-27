import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLiveSim, type LiveSim } from "@core/live";
import { drawUnderlay } from "@ui/index";
import { Coach, Ring, WIFI_END, WIFI_STEPS, useWaited } from "./coach";
import { drawDevice, drawNoSignal, drawOuterWall, drawRoomLabel, drawRouter, drawWallLine } from "./draw";
import { findDeadZones, levelOf, levelWord, paintGuess, paintHeatmap, smoothPower, type DeadZones } from "./heatmap";
import { WALL_MATERIALS, wallMaterial, type WallMaterialId } from "./materials";
import { HelpPanel, Pinger, SketchDialog, WipeBar, thump, useReducedMotion, type SketchApplied } from "./radar";
import { BANDS, CELL_M, CPML_CELLS, gridFor, resampleImported, type Band, EXAMPLE_LABELS, buildJob, defaultDevices, defaultScene, referencePower, toDb, type Device, type Scene, type Wall } from "./scene";
import { pickBackend, startSim, type Backend, type SimHandle } from "./sim";

const CANVAS_PX = 768;
const SNAP_M = 0.05;
const GRAB_M = 0.2;
/** Room side used to draw the plan before the backend is known (the GPU room). Positions are fractions, so the CPU room looks the same. */
const PROVISIONAL_M = 7.68;
/** Live pulse: steps per animation frame (GPU / CPU), and how long a pulse runs, in room crossings. */
const SPF_GPU = 10;
const SPF_CPU = 4;
const COURANT = 0.693;

type Tool = "wall" | "erase";
type Drag = "router" | { dev: number } | null;
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

function Bars({ level }: { level: number }) {
  if (level === 0)
    return (
      <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
        <path d="M3 2 L13 12 M13 2 L3 12" stroke="#ff3b5c" strokeWidth="3" />
      </svg>
    );
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1 + i * 5} y={13 - (4 + i * 4)} width="3.5" height={4 + i * 4} fill={i < level ? "#38f2d6" : "rgba(159,183,179,0.35)"} />
      ))}
    </svg>
  );
}

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [scene, setScene] = useState<Scene | null>(() => defaultScene(PROVISIONAL_M));
  const [devices, setDevices] = useState<Device[]>(() => defaultDevices(PROVISIONAL_M));
  const [isExample, setIsExample] = useState(true);
  const [tool, setTool] = useState<Tool>("wall");
  const [material, setMaterial] = useState<WallMaterialId>("brick");
  const [draft, setDraft] = useState<Wall | null>(null);
  const [status, setStatus] = useState<Status>({ text: "Starting up…", fraction: null });
  const [band, setBand] = useState<Band>("2.4");
  const [mapSecs5, setMapSecs5] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [hasMap, setHasMap] = useState(false);
  const [mapVersion, setMapVersion] = useState(0);
  const [cursorWord, setCursorWord] = useState<string>("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [toast, setToast] = useState("");
  const [wipe, setWipe] = useState({ show: false, pos: 50 });
  const [photoVersion, setPhotoVersion] = useState(0);
  const [done, setDone] = useState({ dead: false, moved: false, wiped: false, ping: false, wall: false });
  const [step, setStep] = useState(0);
  const [cssW, setCssW] = useState(CANVAS_PX);
  const reduced = useReducedMotion();
  const waited = useWaited(step);

  const mapRef = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const underRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const backendRef = useRef<Backend | null>(null);
  const bandRef = useRef<Band>("2.4");
  /** The imported plan as first imported (with the cell and room size then), so a band switch always resamples from it. */
  const importedOrigRef = useRef<{ imp: NonNullable<Scene["imported"]>; cell: number; room: number } | null>(null);
  const simRef = useRef<SimHandle | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const dragRef = useRef<Drag>(null);
  const clickRef = useRef<{ x: number; y: number } | null>(null);
  /** Smoothed signal in dB (what the words and the map use). */
  const dbRef = useRef<Float32Array | null>(null);
  const deadRef = useRef<DeadZones | null>(null);
  const hasMapRef = useRef(false);
  const frozenRef = useRef(false);
  const liveRef = useRef<LiveSim | null>(null);
  const pingerRef = useRef<Pinger | null>(null);
  const photoRef = useRef<{ photo: HTMLCanvasElement; wM: number; hM: number } | null>(null);

  /** Cell size of the chosen band, in metres. */
  const cell = BANDS[band].cellM;
  const gridN = backend ? gridFor(backend.kind, backend.n, band) : 0;
  const roomM = backend ? gridN * cell : PROVISIONAL_M;
  /** Icon and text scale: 1 on a big screen, about 2 on a phone, so the pictures stay readable. */
  const u = Math.max(1, CANVAS_PX / cssW);

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
      const built = buildJob(s, gridFor(b.kind, b.n, bandRef.current), { band: bandRef.current });
      setStatus({ text: "Starting…", fraction: 0 });
      const sim = startSim(b, built.job, (fraction, phase) =>
        setStatus({ text: phase === "settle" ? "Letting the waves spread…" : "Averaging the signal…", fraction }),
      );
      simRef.current = sim;
      sim.result
        .then((r) => {
          if (!r || simRef.current !== sim) return;
          // Average the ripples away first, so the map shows rooms and not stripes.
          const smooth = smoothPower(r.power, built.n);
          const ref = referencePower(smooth, built, s.router);
          const db = toDb(smooth, ref);
          dbRef.current = db;
          const dz = findDeadZones(db, built.n, BANDS[bandRef.current].cellM);
          deadRef.current = dz;
          paintHeatmap(heatRef.current!, db, built.n, dz.mask);
          setStale(false);
          hasMapRef.current = true;
          setHasMap(true);
          setMapVersion((v) => v + 1);
          if (frozenRef.current) {
            frozenRef.current = false;
            setWipe({ show: true, pos: 50 });
          }
          if (bandRef.current === "5") setMapSecs5(Math.max(1, Math.round((performance.now() - t0) / 1000)));
          setStatus({ text: `Last map: ${r.steps} steps in ${((performance.now() - t0) / 1000).toFixed(1)} s`, fraction: null });
        })
        .catch((e) => setStatus({ text: `Simulation failed: ${String(e)}`, fraction: null, error: true }));
    } catch (e) {
      setStatus({ text: `Cannot start: ${String(e)}`, fraction: null, error: true });
    }
  }, []);

  // A picture on the first frame: a rough glow around the router. The plan itself is drawn by the overlay effect.
  useEffect(() => {
    if (heatRef.current) paintGuess(heatRef.current, 0.2, 0.5);
  }, []);

  /** A wave player sized for a grid of n cells (a wave crosses the room about 1.6 times). */
  const makePinger = (b: Backend, n: number) => {
    pingerRef.current?.cancel();
    pingerRef.current?.host.remove();
    const p = new Pinger(b.kind === "webgpu" ? SPF_GPU : SPF_CPU, Math.round((1.6 * n) / COURANT));
    p.onActive = setPinging;
    pingerRef.current = p;
    const m = mapRef.current;
    if (m) m.insertBefore(p.host, overlayRef.current);
  };

  useEffect(() => {
    pickBackend().then((b) => {
      backendRef.current = b;
      setBackend(b);
      const s = defaultScene(b.n * CELL_M);
      sceneRef.current = s;
      setScene(s);
      setDevices(defaultDevices(b.n * CELL_M));
      makePinger(b, b.n);
      run();
    });
    return () => {
      simRef.current?.cancel();
      pingerRef.current?.cancel();
      liveRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the drawn size of the map, for the icon scale and the grab distance.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const ro = new ResizeObserver(() => setCssW(m.getBoundingClientRect().width || CANVAS_PX));
    ro.observe(m);
    return () => ro.disconnect();
  }, []);

  /** Run again shortly after the last edit. */
  const scheduleRun = useCallback(() => {
    setStale(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(run, 250);
  }, [run]);

  const edit = useCallback((next: Scene) => {
    // The first edit after a settled map keeps that map as "before" for the compare bar.
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

  /** Signal level at a spot (smoothed map), or null while there is no fresh map. */
  const levelAt = useCallback(
    (x: number, y: number): 0 | 1 | 2 | 3 | null => {
      const n = gridN;
      if (!n || !dbRef.current || !hasMap || stale) return null;
      const i = Math.min(n - 1, Math.max(0, Math.floor(x / cell)));
      const j = Math.min(n - 1, Math.max(0, Math.floor(y / cell)));
      return levelOf(dbRef.current[j * n + i]!);
    },
    [backend, hasMap, stale, cell, gridN],
  );

  // Floor plan overlay: outer wall, imported walls, walls, room names, no-signal tags, router, devices. Drawn from the first frame.
  useEffect(() => {
    const c = overlayRef.current;
    if (!c || !scene) return;
    c.width = CANVAS_PX;
    c.height = CANVAS_PX;
    const g = c.getContext("2d")!;
    const k = CANVAS_PX / roomM;
    g.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    drawOuterWall(g, CANVAS_PX, CPML_CELLS * cell * k, u);
    if (importedCanvas && scene.imported) {
      g.imageSmoothingEnabled = false;
      g.drawImage(importedCanvas, 0, 0, scene.imported.cols * cell * k, scene.imported.rows * cell * k);
    }
    const line = (w: Wall, alpha = 1) => {
      const info = wallMaterial(w.material);
      drawWallLine(g, w.x1 * k, w.y1 * k, w.x2 * k, w.y2 * k, info.color, Math.max(3 * u, info.thickness * k), alpha);
    };
    scene.walls.forEach((w) => line(w));
    if (draft) line(draft, 0.6);
    if (isExample) for (const l of EXAMPLE_LABELS) drawRoomLabel(g, l.text, l.fx * CANVAS_PX, l.fy * CANVAS_PX, u);
    if (hasMap && !stale && backend && deadRef.current) {
      for (const b of deadRef.current.blobs.slice(0, 3)) drawNoSignal(g, b.cx * cell * k, b.cy * cell * k - 30 * u, u);
    }
    drawRouter(g, scene.router.x * k, scene.router.y * k, u, step === 1);
    for (const d of devices) drawDevice(g, d.kind, d.x * k, d.y * k, levelAt(d.x, d.y), u);
  }, [scene, draft, roomM, cell, importedCanvas, devices, mapVersion, hasMap, stale, backend, isExample, u, step, levelAt]);

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
  /** At least 26 screen pixels, so a finger can grab an icon. */
  const grabM = Math.max(Math.min(GRAB_M, roomM * 0.05), (26 / cssW) * roomM);

  const cellAt = (p: { x: number; y: number }): number => {
    const n = gridN;
    if (!n) return -1;
    const i = Math.floor(p.x / cell);
    const j = Math.floor(p.y / cell);
    return i >= 0 && j >= 0 && i < n && j < n ? j * n + i : -1;
  };
  const wordAt = (p: { x: number; y: number }): string => {
    const k = cellAt(p);
    return k < 0 || !dbRef.current || stale ? "" : levelWord(dbRef.current[k]!);
  };
  const inDeadZone = (p: { x: number; y: number }): boolean => {
    const k = cellAt(p);
    return k >= 0 && !!deadRef.current?.mask[k];
  };

  /** A tap that was not a drag: send a live wave from that spot. */
  const sendWave = (p: { x: number; y: number }) => {
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
        const built = buildJob(sceneRef.current, gridFor(b.kind, b.n, bandRef.current), { band: bandRef.current });
        const sim = createLiveSim({ cs: built.job.cs, backend: b.kind === "webgpu" ? "gpu" : "cpu", device: b.kind === "webgpu" ? b.device : undefined, pulseHz: BANDS[bandRef.current].freqHz });
        liveRef.current = sim;
        pg.attach(sim);
      }
      const sim = liveRef.current;
      pg.ping(Math.min(sim.nx - 1, Math.max(0, Math.floor(p.x / cell))), Math.min(sim.ny - 1, Math.max(0, Math.floor(p.y / cell))));
      const ratio = 1 / 60 / ((b.kind === "webgpu" ? SPF_GPU : SPF_CPU) * sim.dt);
      say(`Slowed down about ${Math.round(ratio / 1e6)} million times so you can watch it. Real Wi-Fi crosses a room in about 25 billionths of a second. The thump is just for feel.`, 9000);
    } catch (e) {
      say(`Waves are not available here: ${String(e)}`);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (!scene || !backend) return;
    const p = toM(e);
    overlayRef.current!.setPointerCapture(e.pointerId);
    const devIdx = devices.findIndex((d) => Math.hypot(p.x - d.x, p.y - d.y) < grabM);
    if (Math.hypot(p.x - scene.router.x, p.y - scene.router.y) < grabM) {
      dragRef.current = "router";
    } else if (devIdx >= 0) {
      dragRef.current = { dev: devIdx };
      if (devices[devIdx]!.kind === "laptop") setDone((d) => ({ ...d, dead: true }));
    } else {
      if (inDeadZone(p)) setDone((d) => ({ ...d, dead: true }));
      beginDraw(p);
    }
  };

  const beginDraw = (p: { x: number; y: number }) => {
    if (!scene) return;
    if (tool === "wall") {
      setDraft({ x1: snap(p.x), y1: snap(p.y), x2: snap(p.x), y2: snap(p.y), material });
    } else {
      let best = -1;
      let bestD = grabM;
      scene.walls.forEach((w, i) => {
        const d = distToSeg(p.x, p.y, w);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        setIsExample(false);
        edit({ ...scene, walls: scene.walls.filter((_, i) => i !== best) });
        scheduleRun();
      } else clickRef.current = p;
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!scene || !backend) return;
    const p = toM(e);
    const drag = dragRef.current;
    if (drag === "router") {
      const m = 0.4; // keep the router out of the absorbing edge layer
      edit({ ...scene, router: { x: Math.min(roomM - m, Math.max(m, p.x)), y: Math.min(roomM - m, Math.max(m, p.y)) } });
    } else if (drag) {
      const m = 0.3;
      const x = Math.min(roomM - m, Math.max(m, p.x));
      const y = Math.min(roomM - m, Math.max(m, p.y));
      setDevices((ds) => ds.map((d, i) => (i === drag.dev ? { ...d, x, y } : d)));
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
      setCursorWord(wordAt(p));
      if (inDeadZone(p)) setDone((d) => (d.dead ? d : { ...d, dead: true }));
    }
  };

  const onUp = () => {
    if (!scene) return;
    const drag = dragRef.current;
    if (drag === "router") {
      dragRef.current = null;
      setDone((d) => ({ ...d, moved: true }));
      scheduleRun();
    } else if (drag) {
      dragRef.current = null;
    } else if (draft) {
      if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) >= SNAP_M) {
        setIsExample(false);
        setDone((d) => ({ ...d, wall: true }));
        edit({ ...scene, walls: [...scene.walls, draft] });
        scheduleRun();
      } else sendWave({ x: draft.x1, y: draft.y1 });
      setDraft(null);
    } else if (clickRef.current) {
      sendWave(clickRef.current);
      clickRef.current = null;
    }
  };

  /** Switch Wi-Fi band. The room shrinks at 5 GHz (finer cells, same grid), so everything is rescaled to keep its place. */
  const changeBand = (next: Band) => {
    if (!backend || next === band) return;
    const newN = gridFor(backend.kind, backend.n, next);
    const newRoom = newN * BANDS[next].cellM;
    const ratio = newRoom / roomM;
    const sc = (v: number) => Math.round(v * ratio * 1000) / 1000;
    makePinger(backend, newN);
    liveRef.current?.destroy();
    liveRef.current = null;
    bandRef.current = next;
    // a quick picture while the real map is worked out
    if (heatRef.current) paintGuess(heatRef.current, 0.2, 0.5);
    dbRef.current = null;
    deadRef.current = null;
    setBand(next);
    setDevices((ds) => ds.map((d) => ({ ...d, x: d.x * ratio, y: d.y * ratio })));
    if (photoRef.current) photoRef.current = { photo: photoRef.current.photo, wM: photoRef.current.wM * ratio, hM: photoRef.current.hM * ratio };
    setPhotoVersion((v) => v + 1);
    if (scene) {
      const s: Scene = isExample
        ? defaultScene(newRoom)
        : { ...scene, imported: importedOrigRef.current && scene.imported ? resampleImported(importedOrigRef.current.imp, importedOrigRef.current.cell, BANDS[next].cellM, newRoom / importedOrigRef.current.room, newN) : scene.imported, router: { x: sc(scene.router.x), y: sc(scene.router.y) }, walls: scene.walls.map((w) => ({ ...w, x1: sc(w.x1), y1: sc(w.y1), x2: sc(w.x2), y2: sc(w.y2) })) };
      sceneRef.current = s;
      setScene(s);
    }
    setDraft(null);
    scheduleRun();
  };

  const clearWalls = () => {
    if (!scene) return;
    photoRef.current = null;
    setPhotoVersion((v) => v + 1);
    setIsExample(false);
    edit({ walls: [], router: scene.router });
    scheduleRun();
  };
  const resetScene = () => {
    if (!backend) return;
    photoRef.current = null;
    setPhotoVersion((v) => v + 1);
    setIsExample(true);
    setDevices(defaultDevices(roomM));
    edit(defaultScene(roomM));
    scheduleRun();
  };

  const applySketch = ({ result, photo }: SketchApplied) => {
    if (!scene) return;
    photoRef.current = { photo, wM: result.cols * result.metresPerCell, hM: result.rows * result.metresPerCell };
    setPhotoVersion((v) => v + 1);
    setIsExample(false);
    const imp = { mask: result.solid, cols: result.cols, rows: result.rows };
    importedOrigRef.current = { imp, cell, room: roomM };
    const m = 0.5;
    edit({ walls: [], router: { x: Math.min(roomM - m, Math.max(m, scene.router.x)), y: Math.min(roomM - m, Math.max(m, scene.router.y)) }, imported: imp });
    setSketchOpen(false);
    scheduleRun();
  };

  // Coach: a finished step moves on by itself. Steps already done earlier are skipped.
  useEffect(() => {
    if (!hasMap || step >= WIFI_STEPS.length) return;
    const ok = [done.dead, done.moved && !stale, done.wiped, done.ping, done.wall];
    if (ok[step]) setStep(step + 1);
  }, [hasMap, step, done, stale]);
  // After the last step, the closing line stays 8 s, then goes.
  useEffect(() => {
    if (step !== WIFI_STEPS.length) return;
    const t = window.setTimeout(() => setStep(WIFI_STEPS.length + 1), 8000);
    return () => window.clearTimeout(t);
  }, [step]);
  // CSS rings on buttons (compare bar, Draw wall) follow these two attributes.
  useEffect(() => {
    document.body.dataset.coach = String(step);
    document.body.dataset.wait = waited ? "1" : "0";
  }, [step, waited]);

  // Where the map ring goes for the current step, as fractions of the map side.
  let ring: { fx: number; fy: number } | null = null;
  if (scene && step === 0 && hasMap && deadRef.current?.blobs[0] && backend) ring = { fx: deadRef.current.blobs[0].cx / gridN, fy: deadRef.current.blobs[0].cy / gridN };
  else if (scene && step === 0 && hasMap && devices[2]) ring = { fx: devices[2].x / roomM, fy: devices[2].y / roomM };
  else if (scene && step === 1) ring = { fx: scene.router.x / roomM, fy: scene.router.y / roomM };
  else if (step === 3) ring = { fx: 0.5, fy: 0.5 };
  else if (step === WIFI_STEPS.length) {
    const lap = devices.find((d) => d.kind === "laptop");
    if (lap) ring = { fx: lap.x / roomM, fy: lap.y / roomM };
  }

  const showStatus = status.error || (hasMap && status.fraction !== null);

  return (
    <>
      <div className="stage">
        <div ref={mapRef} className={`map${stale ? " stale" : ""}${pinging ? " pinging" : ""}`} style={{ width: "min(100vw, calc(100vh - 130px))", aspectRatio: "1" }}>
          <canvas ref={heatRef} className="heat" />
          <canvas ref={beforeRef} className="before" style={{ visibility: wipe.show ? "visible" : "hidden", clipPath: `inset(0 ${100 - wipe.pos}% 0 0)` }} />
          <canvas ref={underRef} className="under" />
          <canvas ref={overlayRef} className="overlay" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
          {ring && <Ring fx={ring.fx} fy={ring.fy} pulse={waited} />}
        </div>
      </div>

      <div className="chip title">
        <a href="../">&larr; Home</a>
        <h1>
          <span className="long">Find the Wi-Fi dead zone in your flat</span>
          <span className="short">Find the dead zone</span>
        </h1>
      </div>
      <Coach steps={WIFI_STEPS} end={WIFI_END} index={step} onSkip={() => setStep((s) => s + 1)} />
      {!hasMap && !status.error && (
        <div className="chip wait" role="status">
          <span>Working out the real signal… a few seconds</span>
          <progress value={status.fraction ?? undefined} max={1} />
        </div>
      )}
      <div className="topright">
        {showStatus && (
          <div className={`chip status${status.error ? " err" : ""}`}>
            {status.text}
            {status.fraction !== null && <progress value={status.fraction} max={1} style={{ width: 90, marginLeft: 8 }} />}
          </div>
        )}
        <button className="chip qbtn" onClick={() => setHelpOpen((v) => !v)} aria-label="How does this work?" aria-expanded={helpOpen}>
          ?
        </button>
      </div>
      {helpOpen && (
        <HelpPanel onClose={() => setHelpOpen(false)}>
          <h2>How this works</h2>
          <p>This is a flat’s floor plan seen from above. The teal shows where Wi-Fi reaches.</p>
          <ol>
            <li>Drag the router to a new spot.</li>
            <li>Draw walls: pick a wall type, then drag on the map.</li>
            <li>The laptop, phone and TV show their signal as Great, OK, Weak or None. Drag them to try other spots.</li>
          </ol>
          <p>Tap anywhere (without dragging) to send one wave and watch it spread. Hold Shift while drawing for a straight wall. The map redraws a moment after each change. Then drag the Before | After bar to compare.</p>
          <p className="small">
            Honest note: this is a flat top-down picture of a Wi-Fi router, so the colours show relative strength, not exact signal. Real rooms are 3D, and in this flat picture the signal fades more slowly with distance. The wave is a slowed-down movie; the steady map is the main result. Room is {roomM.toFixed(1)} m wide
            {backend ? `, running on ${backend.kind === "webgpu" ? "your graphics chip" : "your processor"}` : ""}. {status.fraction === null && !status.error ? status.text : ""}
          </p>
        </HelpPanel>
      )}
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
          <div className="levels">
            {[3, 2, 1, 0].map((l) => (
              <span key={l}>
                <Bars level={l} />
                {["None", "Weak", "OK", "Great"][l]}
              </span>
            ))}
          </div>
          <div className="band" role="group" aria-label="Wi-Fi band">
            <button className={band === "2.4" ? "on" : ""} aria-pressed={band === "2.4"} onClick={() => changeBand("2.4")}>
              2.4 GHz (reaches far)
            </button>
            <button className={band === "5" ? "on" : ""} aria-pressed={band === "5"} onClick={() => changeBand("5")}>
              5 GHz (faster, shorter reach)
            </button>
          </div>
          {band === "5" && backend?.kind === "cpu" && <div className="bandnote">5 GHz shows a smaller room ({roomM.toFixed(1)} m wide) so the map still comes quickly.</div>}
          {band === "5" && backend?.kind === "webgpu" && <div className="bandnote">5 GHz map takes about {mapSecs5 ?? 10} seconds{stale || status.fraction !== null ? " (working on it)" : ""}.</div>}
          <div className="key">
            <span>Brighter teal means stronger Wi-Fi.</span>
            {cursorWord && <span>Here: {cursorWord}</span>}
          </div>
        </div>
        <div className={`tools${moreOpen ? " open" : ""}`}>
          <button className={`b-draw${tool === "wall" ? " on" : ""}`} onClick={() => setTool("wall")}>
            Draw wall
          </button>
          <button className={tool === "erase" ? "on" : ""} onClick={() => setTool("erase")}>
            Erase wall
          </button>
          <button onClick={resetScene}>Example flat</button>
          <button className="morebtn" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
            More
          </button>
          <span className="extra">
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
            <button onClick={() => setSketchOpen(true)}>Use my floor plan</button>
          </span>
        </div>
      </div>
      {sketchOpen && backend && (
        <SketchDialog cellMetres={cell} maxCols={gridN} maxRows={gridN} onApply={applySketch} onClose={() => setSketchOpen(false)} />
      )}
    </>
  );
}
