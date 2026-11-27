import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { responseSpectrum } from "@core/runtime/responseJob";
import { acousticCoefficients } from "@core/live/acoustics";
import { createLiveSim, type LiveSim } from "@core/live";
import { drawUnderlay } from "@ui/index";
import { BassPlayer, levelAt, stackLevels, type PlayMode } from "./audio";
import { HATCH_CSS, HelpPanel, Missions, PALETTE, Pinger, SketchDialog, WipeBar, hatchPixel, ramp, thump, useReducedMotion, type SketchApplied } from "./radar";
import {
  FREQS,
  F_MAX,
  F_MIN,
  MAX_ROOM_M,
  MIN_ROOM_M,
  TRAPS,
  airCell,
  buildFieldJob,
  buildResponseJob,
  buildRoom,
  defaultScene,
  isAir,
  type Scene,
  type Trap,
  type TrapType,
} from "./scene";
import { pickBackend, startField, startResponse, type Backend, type SimHandle } from "./sim";

const PX_PER_M = 150;
const GRAB_M = 0.3;
const MAP_DB = 40;
/** Loudest spots: within this many dB of the peak they get red stripes. */
const BOOM_DB = -3;
const SPF_GPU = 4;
const SPF_CPU = 2;
const COURANT = 0.693;
/** The same ramp the map uses (cubed), so the legend matches the colours. */
const LEGEND_GRADIENT = `linear-gradient(90deg, ${Array.from({ length: 11 }, (_, k) => {
  const [r, g, b] = ramp((k / 10) ** 3);
  return `rgb(${r},${g},${b}) ${k * 10}%`;
}).join(",")})`;
type Tool = TrapType | "erase" | "ping";
interface Response {
  db: Float64Array;
}
interface Status {
  text: string;
  fraction: number | null;
  error?: boolean;
}

function distSeg(px: number, py: number, t: Trap): number {
  const dx = t.x2 - t.x1;
  const dy = t.y2 - t.y1;
  const l2 = dx * dx + dy * dy;
  const k = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - t.x1) * dx + (py - t.y1) * dy) / l2));
  return Math.hypot(px - (t.x1 + k * dx), py - (t.y1 + k * dy));
}

/** Local maxima of the response that stand at least 3 dB above the median. */
function findPeaks(db: Float64Array): number[] {
  const med = Array.from(db).sort((a, b) => a - b)[db.length >> 1]!;
  const out: number[] = [];
  for (let i = 2; i < db.length - 2; i++) if (db[i]! > db[i - 1]! && db[i]! >= db[i + 1]! && db[i]! > db[i - 2]! && db[i]! >= db[i + 2]! && db[i]! > med + 3) out.push(i);
  return out;
}

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [scene, setScene] = useState<Scene>(defaultScene);
  const [tool, setTool] = useState<Tool>("ping");
  const [draft, setDraft] = useState<Trap | null>(null);
  const [freq, setFreq] = useState(40);
  const [response, setResponse] = useState<Response | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<Status>({ text: "Starting up…", fraction: null });
  const [mode, setMode] = useState<PlayMode>("laptop");
  const [volume, setVolume] = useState(5);
  const [playing, setPlaying] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [panel, setPanel] = useState<"room" | "sound" | null>(() => (window.innerWidth >= 1500 ? "sound" : null));
  const [sketchOpen, setSketchOpen] = useState(false);
  const [hintGone, setHintGone] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [toast, setToast] = useState("");
  const [wipe, setWipe] = useState({ show: false, pos: 50 });
  const [done, setDone] = useState({ boom: false, trap: false, wiped: false });
  const reduced = useReducedMotion();

  const mapDivRef = useRef<HTMLDivElement>(null);
  const planRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);
  const beforeMapRef = useRef<HTMLCanvasElement | null>(null);
  const photoRef = useRef<{ photo: HTMLCanvasElement; wM: number; hM: number } | null>(null);
  const sceneRef = useRef(scene);
  const freqRef = useRef(freq);
  const responseRef = useRef<Response | null>(null);
  const backendRef = useRef<Backend | null>(null);
  const respSim = useRef<SimHandle<unknown> | null>(null);
  const mapSim = useRef<SimHandle<unknown> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mapTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const drag = useRef<null | "sub" | "seat" | "trap" | "ping">(null);
  const player = useRef<BassPlayer>(new BassPlayer());
  const frozen = useRef(false);
  const pendingTrap = useRef<number | null>(null);
  const pingerRef = useRef<Pinger | null>(null);
  const liveRef = useRef<LiveSim | null>(null);

  const room = useMemo(() => (backend ? buildRoom(draft ? { ...scene, traps: [...scene.traps, draft] } : scene, backend.dx) : null), [scene, draft, backend]);

  const say = useCallback((text: string, ms = 7000) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), ms);
  }, []);

  const runMap = useCallback(() => {
    const b = backendRef.current;
    if (!b) return;
    mapSim.current?.cancel();
    try {
      const { room: r, job } = buildFieldJob(sceneRef.current, b.dx, freqRef.current);
      const sim = startField(b, job, (f) => setStatus({ text: "Drawing the map of booms and quiet spots...", fraction: f }));
      mapSim.current = sim as SimHandle<unknown>;
      sim.result
        .then((res) => {
          if (!res || mapSim.current !== (sim as SimHandle<unknown>)) return;
          let pmax = 0;
          for (let i = 0; i < res.power.length; i++) if (!r.solid[i]) pmax = Math.max(pmax, res.power[i]!);
          const c = document.createElement("canvas");
          c.width = r.nx;
          c.height = r.ny;
          const img = c.getContext("2d")!.createImageData(r.nx, r.ny);
          for (let i = 0; i < res.power.length; i++) {
            const o = 4 * i;
            if (r.solid[i]) {
              img.data.set([42, 52, 64, 255], o);
              continue;
            }
            const db = 10 * Math.log10(Math.max(1e-12, res.power[i]! / pmax));
            // Loudest spots: red stripes (a shape), the rest on the teal ramp.
            if (db >= BOOM_DB && hatchPixel(i % r.nx, Math.floor(i / r.nx))) {
              img.data.set([0xff, 0x3b, 0x5c, 255], o);
              continue;
            }
            const [R, G, B] = ramp(((db + MAP_DB) / MAP_DB) ** 3);
            img.data.set([R, G, B, 255], o);
          }
          c.getContext("2d")!.putImageData(img, 0, 0);
          mapRef.current = c;
          if (frozen.current) {
            frozen.current = false;
            setWipe({ show: true, pos: 50 });
          }
          setMapVersion((v) => v + 1);
          setStale(false);
          setStatus({ text: `Done. Map at ${freqRef.current.toFixed(1)} Hz.`, fraction: null });
        })
        .catch((e) => setStatus({ text: `Map failed: ${String(e)}`, fraction: null, error: true }));
    } catch (e) {
      setStatus({ text: `Cannot start: ${String(e)}`, fraction: null, error: true });
    }
  }, []);

  const runResponse = useCallback(() => {
    const b = backendRef.current;
    if (!b) return;
    respSim.current?.cancel();
    mapSim.current?.cancel();
    try {
      const { job } = buildResponseJob(sceneRef.current, b.dx, 2);
      setStatus({ text: "Measuring how the room sounds...", fraction: 0 });
      const sim = startResponse(b, job, (f) => setStatus({ text: "Measuring how the room sounds...", fraction: f }));
      respSim.current = sim as SimHandle<unknown>;
      sim.result
        .then((res) => {
          if (!res || respSim.current !== (sim as SimHandle<unknown>)) return;
          const h = responseSpectrum(res, FREQS);
          const next = { db: Float64Array.from(h, (v) => 20 * Math.log10(Math.max(1e-30, v))) };
          // Mission: a trap was added and the note on the map got at least 3 dB quieter at the seat.
          if (pendingTrap.current !== null) {
            const drop = pendingTrap.current - levelAt(FREQS, next.db, freqRef.current);
            if (drop >= 3) {
              setDone((d) => ({ ...d, trap: true }));
              say(`The trap cut this note by ${drop.toFixed(0)} dB at your seat. Press Play to hear it.`);
            }
            pendingTrap.current = null;
          }
          responseRef.current = next;
          setResponse(next);
          runMap();
        })
        .catch((e) => setStatus({ text: `Simulation failed: ${String(e)}`, fraction: null, error: true }));
    } catch (e) {
      setStatus({ text: `Cannot start: ${String(e)}`, fraction: null, error: true });
    }
  }, [runMap, say]);

  useEffect(() => {
    pickBackend().then((b) => {
      backendRef.current = b;
      setBackend(b);
      const p = new Pinger(b.kind === "webgpu" ? SPF_GPU : SPF_CPU, Math.round((2 * (MAX_ROOM_M / b.dx)) / COURANT));
      p.onActive = setPinging;
      pingerRef.current = p;
      mapDivRef.current?.appendChild(p.host);
      runResponse();
    });
    const p = player.current;
    return () => {
      respSim.current?.cancel();
      mapSim.current?.cancel();
      pingerRef.current?.cancel();
      liveRef.current?.destroy();
      p.stop();
    };
  }, [runResponse]);

  const edit = useCallback(
    (next: Scene) => {
      // The first edit after a settled map keeps that map as "before" for the wipe slider.
      if (mapRef.current && !frozen.current) {
        const c = document.createElement("canvas");
        c.width = mapRef.current.width;
        c.height = mapRef.current.height;
        c.getContext("2d")!.drawImage(mapRef.current, 0, 0);
        beforeMapRef.current = c;
        frozen.current = true;
      }
      if (next.traps.length > sceneRef.current.traps.length && responseRef.current && pendingTrap.current === null) {
        pendingTrap.current = levelAt(FREQS, responseRef.current.db, freqRef.current);
      }
      // The live wave belongs to the old room.
      pingerRef.current?.cancel();
      liveRef.current?.destroy();
      liveRef.current = null;
      sceneRef.current = next;
      setScene(next);
      setStale(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(runResponse, 300);
    },
    [runResponse],
  );

  const chooseFreq = useCallback(
    (f: number) => {
      const v = Math.max(F_MIN, Math.min(F_MAX, f));
      freqRef.current = v;
      setFreq(v);
      setStale(true);
      window.clearTimeout(mapTimer.current);
      mapTimer.current = window.setTimeout(runMap, 300);
    },
    [runMap],
  );

  // Plan view: map, before/after wipe, photo, traps, subwoofer, seat.
  useEffect(() => {
    const c = planRef.current;
    if (!c || !room || !backend) return;
    const k = PX_PER_M;
    c.width = Math.round(room.nx * room.dx * k);
    c.height = Math.round(room.ny * room.dx * k);
    const g = c.getContext("2d")!;
    const cell = room.dx * k;
    g.fillStyle = PALETTE.bg;
    g.fillRect(0, 0, c.width, c.height);
    if (mapRef.current) {
      g.imageSmoothingEnabled = true;
      g.drawImage(mapRef.current, 0, 0, c.width, c.height);
      if (wipe.show && beforeMapRef.current) {
        const x = (c.width * wipe.pos) / 100;
        g.save();
        g.beginPath();
        g.rect(0, 0, x, c.height);
        g.clip();
        g.drawImage(beforeMapRef.current, 0, 0, c.width, c.height);
        g.restore();
        g.strokeStyle = PALETTE.teal;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, c.height);
        g.stroke();
      }
    } else {
      g.fillStyle = "#2a3440";
      for (let j = 0; j < room.ny; j++) for (let i = 0; i < room.nx; i++) if (room.solid[j * room.nx + i]) g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
    }
    const ph = photoRef.current;
    if (ph) drawUnderlay(g, ph.photo, ph.wM * k, ph.hM * k, 0.15);
    for (let j = 0; j < room.ny; j++)
      for (let i = 0; i < room.nx; i++) {
        const rf = room.rf[j * room.nx + i]!;
        if (rf > 0) {
          g.fillStyle = rf >= TRAPS.chunk.rf ? "rgba(190,120,255,0.8)" : "rgba(235,245,255,0.85)";
          g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
        }
      }
    const dot = (p: { x: number; y: number }, color: string, label: string) => {
      g.fillStyle = color;
      g.strokeStyle = "#05070b";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x * k, p.y * k, 14, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
      g.fillStyle = "#05070b";
      g.font = "bold 10px system-ui";
      g.textAlign = "center";
      g.fillText(label, p.x * k, p.y * k + 3.5);
    };
    dot(scene.sub, "#ffd24a", "SUB");
    dot(scene.seat, "#ffffff", "SEAT");
  }, [room, backend, scene.sub, scene.seat, mapVersion, wipe, response]);

  // Response chart. Peaks are red diamonds (a shape as well as a colour).
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.width = 640;
    c.height = 240;
    const g = c.getContext("2d")!;
    g.fillStyle = "#05070b";
    g.fillRect(0, 0, 640, 240);
    const L = 44;
    const R = 628;
    const T = 10;
    const B = 212;
    const xOf = (f: number) => L + ((f - F_MIN) / (F_MAX - F_MIN)) * (R - L);
    g.font = "11px system-ui";
    g.fillStyle = "#9fb7b3";
    g.strokeStyle = "#1c2a2d";
    g.textAlign = "center";
    for (let f = 50; f <= 300; f += 50) {
      g.beginPath();
      g.moveTo(xOf(f), T);
      g.lineTo(xOf(f), B);
      g.stroke();
      g.fillText(`${f}`, xOf(f), B + 14);
    }
    g.fillText("Hz", R - 6, B + 28);
    if (response) {
      const d = response.db;
      let mx = -Infinity;
      for (const v of d) mx = Math.max(mx, v);
      const span = 50;
      const yOf = (v: number) => B - ((Math.max(mx - span, v) - (mx - span)) / span) * (B - T);
      g.textAlign = "right";
      for (let s = 0; s <= span; s += 10) {
        g.fillText(`${-s}`, L - 6, yOf(mx - s) + 4);
        g.beginPath();
        g.moveTo(L, yOf(mx - s));
        g.lineTo(R, yOf(mx - s));
        g.stroke();
      }
      g.strokeStyle = PALETTE.teal;
      g.lineWidth = 1.5;
      g.beginPath();
      FREQS.forEach((f, i) => (i === 0 ? g.moveTo(xOf(f), yOf(d[i]!)) : g.lineTo(xOf(f), yOf(d[i]!))));
      g.stroke();
      g.fillStyle = PALETTE.alert;
      for (const i of findPeaks(d)) {
        const x = xOf(FREQS[i]!);
        const y = yOf(d[i]!);
        g.beginPath();
        g.moveTo(x, y - 6);
        g.lineTo(x + 5, y);
        g.lineTo(x, y + 6);
        g.lineTo(x - 5, y);
        g.closePath();
        g.fill();
      }
    }
    g.strokeStyle = "#ffd24a";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(xOf(freq), T);
    g.lineTo(xOf(freq), B);
    g.stroke();
  }, [response, freq, panel]);

  // Keep the sound in step with the frequency and the room.
  useEffect(() => {
    if (!playing || !response) return;
    player.current.update(mode, freq, stackLevels(FREQS, response.db, freq));
  }, [playing, mode, freq, response]);

  const planPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * (e.currentTarget.width / r.width)) / PX_PER_M, y: ((e.clientY - r.top) * (e.currentTarget.height / r.height)) / PX_PER_M };
  };

  /** A click in the room: one pulse from that spot, slowed down so you can watch it. */
  const ping = (p: { x: number; y: number }) => {
    const b = backendRef.current;
    const pg = pingerRef.current;
    if (!b || !pg) return;
    const rm = buildRoom(sceneRef.current, b.dx);
    if (!isAir(rm, p.x, p.y)) return;
    thump();
    if (reduced) {
      say("Your system asks for less motion, so the wave is not animated. The thump still plays.");
      return;
    }
    try {
      if (!liveRef.current) {
        const sim = createLiveSim({
          cs: acousticCoefficients(rm.nx, rm.ny, rm.dx, rm.rf),
          solid: rm.solid,
          backend: b.kind === "webgpu" ? "gpu" : "cpu",
          device: b.kind === "webgpu" ? b.device : undefined,
          pulseHz: 400,
        });
        liveRef.current = sim;
        pg.attach(sim);
      }
      const sim = liveRef.current;
      pg.ping(Math.min(sim.nx - 1, Math.floor(p.x / rm.dx)), Math.min(sim.ny - 1, Math.floor(p.y / rm.dx)));
      const ratio = 1 / 60 / ((b.kind === "webgpu" ? SPF_GPU : SPF_CPU) * sim.dt);
      say(`Slowed down about ${Math.round(ratio)} times so you can watch it. The thump is just for feel.`, 8000);
    } catch (e) {
      say(`Ping is not available here: ${String(e)}`);
    }
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!room) return;
    setHintGone(true);
    const p = planPoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = sceneRef.current;
    if (Math.hypot(p.x - s.sub.x, p.y - s.sub.y) < GRAB_M) drag.current = "sub";
    else if (Math.hypot(p.x - s.seat.x, p.y - s.seat.y) < GRAB_M) drag.current = "seat";
    else if (tool === "ping") {
      ping(p);
    } else if (tool === "erase") {
      let best = -1;
      let bd = 0.5;
      s.traps.forEach((t, i) => {
        const d = t.type === "foam" ? distSeg(p.x, p.y, t) : Math.hypot(p.x - t.x1, p.y - t.y1);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0) edit({ ...s, traps: s.traps.filter((_, i) => i !== best) });
      else ping(p);
    } else if (isAir(room, p.x, p.y)) {
      drag.current = "trap";
      setDraft({ type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    }
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || !room) return;
    const p = planPoint(e);
    const s = sceneRef.current;
    if (drag.current === "trap") {
      setDraft((d) => (d ? (d.type === "chunk" ? { ...d, x1: p.x, y1: p.y, x2: p.x, y2: p.y } : { ...d, x2: p.x, y2: p.y }) : d));
    } else if ((drag.current === "sub" || drag.current === "seat") && isAir(room, p.x, p.y)) {
      edit({ ...s, [drag.current]: { x: p.x, y: p.y } });
    }
  };

  const onUp = () => {
    const s = sceneRef.current;
    if (drag.current === "trap" && draft) {
      const len = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1);
      if (draft.type === "chunk" || len >= 0.1) edit({ ...s, traps: [...s.traps, draft] });
      else ping({ x: draft.x1, y: draft.y1 });
    }
    drag.current = null;
    setDraft(null);
  };

  const setSize = (key: "w" | "h" | "notchW" | "notchH", v: number) => {
    if (!(v > 0)) return;
    const s = sceneRef.current;
    const n = { ...s, [key]: Math.max(key.startsWith("notch") ? 0.5 : MIN_ROOM_M, Math.min(MAX_ROOM_M, v)) };
    const cl = (p: { x: number; y: number }) => ({ x: Math.min(p.x, n.w - 0.2), y: Math.min(p.y, n.h - 0.2) });
    edit({ ...n, sub: cl(n.sub), seat: cl(n.seat) });
  };

  const applySketch = ({ result, photo }: SketchApplied) => {
    const b = backendRef.current;
    if (!b) return;
    const dx = b.dx;
    const w = Math.max(MIN_ROOM_M, result.cols * dx);
    const h = Math.max(MIN_ROOM_M, result.rows * dx);
    photoRef.current = { photo, wM: result.cols * result.metresPerCell, hM: result.rows * result.metresPerCell };
    const base: Scene = { ...sceneRef.current, shape: "rect", w, h, traps: [], imported: { mask: result.solid, cols: result.cols, rows: result.rows, dx } };
    // Put SUB and SEAT on the nearest free floor, since the old spots may now be inside a wall.
    const rm = buildRoom(base, dx);
    const place = (fx: number, fy: number) => {
      const a = airCell(rm, fx * w, fy * h);
      return { x: (a.ix + 0.5) * dx, y: (a.iy + 0.5) * dx };
    };
    edit({ ...base, sub: place(0.2, 0.8), seat: place(0.7, 0.3) });
    setSketchOpen(false);
  };

  const onChartClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) * (640 / r.width);
    let f = F_MIN + ((x - 44) / (628 - 44)) * (F_MAX - F_MIN);
    if (response) {
      let best = -1;
      let bd = 6;
      for (const i of findPeaks(response.db))
        if (Math.abs(FREQS[i]! - f) < bd) {
          bd = Math.abs(FREQS[i]! - f);
          best = i;
        }
      if (best >= 0) {
        f = FREQS[best]!;
        setDone((d) => ({ ...d, boom: true }));
      }
    }
    chooseFreq(Math.round(f * 2) / 2);
  };

  const togglePlay = () => {
    if (playing) {
      player.current.stop();
      setPlaying(false);
    } else if (response) {
      player.current.volume = volume / 100;
      player.current.start(mode, freq, stackLevels(FREQS, response.db, freq));
      setPlaying(true);
    }
  };

  const relDb = response ? levelAt(FREQS, response.db, freq) - Array.from(response.db).sort((a, b) => a - b)[response.db.length >> 1]! : 0;
  const hasMap = mapRef.current !== null;
  const ratio = room ? room.nx / room.ny : 1;

  const missions = [
    { label: "Find a boom (click a red diamond on the chart)", done: done.boom },
    { label: "Add a trap and hear the boom drop", done: done.trap },
    { label: "Wipe to compare before and after", done: done.wiped },
  ];

  return (
    <>
      <div className="stage">
        <div ref={mapDivRef} className={`map${stale ? " stale" : ""}${pinging ? " pinging" : ""}`} style={{ width: `min(100vw, calc((100vh - 130px) * ${ratio}))`, aspectRatio: String(ratio) }}>
          <canvas ref={planRef} className="plan" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ cursor: "crosshair" }} />
          {!hasMap && (
            <div className="wait">
              <div>Working out the room… a few seconds</div>
              <progress value={status.fraction ?? undefined} max={1} />
            </div>
          )}
        </div>
      </div>

      <div className="chip title">
        <a href="../">&larr; Home</a>
        <h1>Find where bass booms in your room</h1>
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
          <p>This simulates sound waves bouncing around a room, right in your browser. Low notes pile up in some spots (boom) and cancel in others (quiet).</p>
          <ol>
            <li>Drag SUB (your speaker) and SEAT (where you listen).</li>
            <li>In the chart, click a red diamond (it appears after a few seconds): that note booms in your room.</li>
            <li>Read the map: bright teal = loud, dark = quiet, red stripes = the boom. Add foam to tame it.</li>
          </ol>
          <p>Click anywhere in the room to send one pulse and watch it bounce. The Before/After slider appears after you change something.</p>
          <p className="small">
            Honest note: this is a flat top-down view, so it shows side-to-side booms only, not floor-to-ceiling ones. It is a model, not a measurement. Thin foam does little for deep bass; that is physics, not a bug. The pulse is a slowed-down movie; the steady map is the main result.
            {backend ? ` Running on ${backend.kind === "webgpu" ? "your graphics chip" : "your processor"}.` : ""}
          </p>
        </HelpPanel>
      )}
      {panel === "sound" && (
        <div className="panel">
          <canvas ref={chartRef} className="chart" onClick={onChartClick} />
          {!response && <div className="small">Measuring the room… red diamonds appear here in a few seconds</div>}
          <div className="small">What you hear at SEAT for each note (low to high pitch), compared with the loudest. Dips vanish, red diamonds boom. Click a diamond to map it. Yellow line = the note on the map.</div>
          <label>
            Frequency <input type="range" min={F_MIN} max={F_MAX} step={0.5} value={freq} onChange={(e) => chooseFreq(+e.target.value)} /> {freq.toFixed(1)} Hz
          </label>
          <div className="small">{!response ? "" : relDb >= 3 ? "At your seat this note is louder than most of the room." : relDb <= -3 ? "At your seat this note is quieter than most of the room." : "At your seat this note is about average."}</div>
          <label>
            Sound{" "}
            <select value={mode} onChange={(e) => setMode(e.target.value as PlayMode)}>
              <option value="laptop">Laptop speakers (adds higher tones)</option>
              <option value="tone">Normal (the pure low tone)</option>
            </select>
          </label>
          <label>
            Volume{" "}
            <input
              type="range"
              min={0}
              max={40}
              value={volume}
              onChange={(e) => {
                setVolume(+e.target.value);
                player.current.setVolume(+e.target.value / 100);
              }}
            />{" "}
            <button className={playing ? "on" : ""} onClick={togglePlay} disabled={!response}>
              {playing ? "Stop" : "Play"}
            </button>
          </label>
        </div>
      )}
      {panel === "room" && (
        <div className="panel">
          <label>
            Room{" "}
            <select value={scene.shape} onChange={(e) => edit({ ...sceneRef.current, shape: e.target.value as Scene["shape"], imported: undefined })}>
              <option value="rect">Rectangle</option>
              <option value="L">L-shape</option>
            </select>
          </label>
          <label>
            Width m <input type="number" step="0.1" min={MIN_ROOM_M} max={MAX_ROOM_M} value={scene.w} onChange={(e) => setSize("w", +e.target.value)} />
          </label>
          <label>
            Depth m <input type="number" step="0.1" min={MIN_ROOM_M} max={MAX_ROOM_M} value={scene.h} onChange={(e) => setSize("h", +e.target.value)} />
          </label>
          {scene.shape === "L" && (
            <>
              <label>
                Cut-out width m <input type="number" step="0.1" min={0.5} max={MAX_ROOM_M} value={scene.notchW} onChange={(e) => setSize("notchW", +e.target.value)} />
              </label>
              <label>
                Cut-out depth m <input type="number" step="0.1" min={0.5} max={MAX_ROOM_M} value={scene.notchH} onChange={(e) => setSize("notchH", +e.target.value)} />
              </label>
            </>
          )}
        </div>
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
          <strong>
            Map of one note: {freq.toFixed(1)} Hz
          </strong>
          <div className="grad" style={{ background: LEGEND_GRADIENT }} />
          <div className="ticks">
            <span>Quiet</span>
            <span>Loud</span>
          </div>
          <div className="key">
            <span>
              <span className="hatch" style={{ background: HATCH_CSS }} />
              Boom (red stripes)
            </span>
            <span>
              <span className="swatch" style={{ background: "rgb(235,245,255)" }} />
              Foam
            </span>
            <span>
              <span className="swatch" style={{ background: "rgb(190,120,255)" }} />
              Corner block
            </span>
            <span>
              <span className="swatch" style={{ background: "rgb(42,52,64)" }} />
              Wall
            </span>
          </div>
        </div>
        <div className="tools">
          {(["ping", "foam", "chunk", "erase"] as Tool[]).map((t) => (
            <button key={t} className={tool === t ? "on" : ""} onClick={() => setTool(t)}>
              {t === "ping" ? "Ping" : t === "erase" ? "Erase trap" : t === "foam" ? "Foam panel (5 cm)" : "Corner block (60 cm)"}
            </button>
          ))}
          <button onClick={() => edit({ ...sceneRef.current, traps: [] })}>Clear traps</button>
          <button className={panel === "room" ? "on" : ""} onClick={() => setPanel(panel === "room" ? null : "room")}>
            Room size
          </button>
          <button className={panel === "sound" ? "on" : ""} onClick={() => setPanel(panel === "sound" ? null : "sound")}>
            Chart &amp; sound
          </button>
          <button onClick={() => setSketchOpen(true)}>Use my floor plan</button>
        </div>
      </div>
      {sketchOpen && backend && (
        <SketchDialog cellMetres={backend.dx} maxCols={Math.floor(MAX_ROOM_M / backend.dx)} maxRows={Math.floor(MAX_ROOM_M / backend.dx)} onApply={applySketch} onClose={() => setSketchOpen(false)} />
      )}
    </>
  );
}
