# PR #9 follow-up: no blank first screen

## Cause
Could not reproduce the blank map outside the review's headless run. Measured on the built `site/` (head 3967487) with this machine's NVIDIA GPU and Chrome, served locally:

| Run | Wi-Fi first map | Bass first chart + map |
|---|---|---|
| Headed Chrome, WebGPU | 2.0 s | 3.4 s |
| Headed Chrome, CPU worker (`?backend=cpu`) | 13.2 s | 5.1 s |
| Headless new, `--disable-gpu` (CPU fallback) | 3.0 s | not run |

So the apps and the `/wifi/`, `/bass/` worker paths work. The review screenshot said "Starting up..." (Wi-Fi), which the app only shows before a backend is chosen. The likely cause is `detectBackend()` waiting forever on `requestAdapter()` / `requestDevice()` in a setup with no usable GPU. This is inferred, not proven. Whatever the cause, nothing was shown while waiting, and there was no time limit on the GPU check.

## What changed (app UI only)
- `apps/*/src/sim.ts`: `pickBackend` gives WebGPU 4 s to answer, then uses the CPU worker.
- Wi-Fi `App.tsx`/`styles.css`: dark box on the map "Working out the signal... a few seconds" with a progress bar until the first map is drawn.
- Bass `App.tsx`/`styles.css`: same waiting message on the room view and on the chart ("orange dots appear here in a few seconds").
- Review point 2: Wi-Fi legend says Dead / Weak / Strong, no dB. Cursor readout says strong / medium / weak / dead.
- Review point 3: dropped "2.4 GHz", "WebGPU", "Grid NxN" from the main view (Wi-Fi shows only the room width; bass says "your graphics chip" or "your processor").
- Review point 4: "Quiet (null)" is now "Quiet". "Hz is pitch: a small number is a deep note" added next to the map note. dB removed from bass text; the seat line is now words (louder / quieter / about average). Initial status "Detecting backend..." is now "Starting up...".
- Review point 5: bass step 2 says the orange dots appear after a few seconds, and the chart shows a waiting message until they do.
- No change to the first-run size: the CPU first map still takes up to ~13 s, but the waiting message covers it.

## Screenshots (`reports/pr9-shots/`, not in git)
before-headed-wifi.png, before-headed-bass.png, before-cpu-wifi.png, before-cpu-bass.png, before-headless-wifi.png, before-nogpu-wifi.png,
after-wifi-gpu.png, after-wifi-gpu-waiting.png, after-bass-gpu.png, after-bass-gpu-waiting.png,
after-wifi-cpu.png, after-wifi-cpu-waiting.png (first map after the wait, CPU), after-bass-cpu.png, after-bass-cpu-waiting.png.

## Not checked
Mouse interaction, audio, mobile width, and the exact no-GPU hang (the 4 s limit is not exercised by a real hang).

## After the change (same headed Chrome)
Wi-Fi first map: 1.8 s (WebGPU), 9.7 s (CPU). Bass first chart and map: 3.5 s (WebGPU), 8.7 s (CPU).
