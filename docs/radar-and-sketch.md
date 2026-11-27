# Radar look and "Use my floor plan"

Status: merged in pull request #12 (946d1ea). Code: `apps/wifi-deadzone`, `apps/bass-ghost-finder`, shared helpers in `packages/ghostfield-ui`. Source: `ghostfield-radar/reports/radar-apps.md`.

## What a user sees
- Colours: a dark-to-teal ramp (#05070B to #38F2D6). Alert red (#FF3B5C) is always paired with a shape: diagonal stripes (Wi-Fi dead zones, bass boom spots) and red diamonds on the bass chart.
- The map fills the window with a bottom bar: title, `?` help (3 steps, the 2D note, which backend runs), legend.
- Click to ping: a wave ring with a fading trail and a thump. A first-run hint "Click anywhere to ping" fades after the first click.
- Before/After slider after the first edit of a settled map.
- Three mission pills per app. Wi-Fi: hover a dead zone; move the router and touch the slider; ping. Bass: click a peak diamond; add a trap that drops the seat level by 3 dB or more; touch the slider.
- Reduced motion: no wave animation, only the thump and a note.

## Use my floor plan
File input, two-click scale bar, metres box, 15% underlay. Wi-Fi: walls become brick cells. Bass: walls join the room's solid cells; speaker and seat move to the nearest free floor.

## Changes worth knowing
- Wi-Fi dead-zone limit moved from -45 dB to -30 dB, because at -45 the example flat showed almost nothing. "Medium" is now above -20 dB.
- The absorbing edge layer is no longer striped red.
- Slow-down shown on screen is computed: about 72 million times for the Wi-Fi ping (GPU), about 80 times for the bass ping (shown at 400 Hz, so the ring is soft and wide).
- `radar.tsx` and `styles.css` are the same file in both apps. Shared code would need to move into `packages/`.

## Checks run
`tsc --noEmit` and `vite build` clean in both apps. Wi-Fi vitest 3 pass. Bass scene tests 5 pass, trap test 1 pass (99 s). Headed Chrome with a real GPU, 1366x768: first map in about 1.7 s (Wi-Fi) and 2.1 s (bass), no blank screen, no console errors; ping, edit, slider, help and a synthetic 600x400 floor plan at 5 m scale all ran.

## Not checked
CPU fallback in the browser. Reduced motion switched on. Sound by ear. Phones and small screens. Real paper photos. All mission ticks except ping (the rest were read from code). In the bass import the area outside the drawn room shows as grey wall. The Wi-Fi live ping has no absorbing edge, so it bounces off the room edge.
