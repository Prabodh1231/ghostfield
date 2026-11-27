# GhostField

GhostField shows invisible waves in a room. It runs in your browser. Nothing is installed and nothing leaves your computer.

One small 2D wave engine (FDTD, a grid method) drives three things:

| Try it | What it is | Link |
|---|---|---|
| Home | Pick an app | https://prabodh1231.github.io/ghostfield/ |
| Wi-Fi dead zones | Draw walls, move the router, see where Wi-Fi is weak | https://prabodh1231.github.io/ghostfield/wifi/ |
| Bass ghost finder | Draw a room, see where bass booms or vanishes, add bass traps | https://prabodh1231.github.io/ghostfield/bass/ |
| Echo Stalker (game) | You cannot see. Clap, and walls glow where sound hits them. A monster hunts you by sound. | https://prabodh1231.github.io/ghostfield/echo/ |

Built for the Kiroween 2026 hackathon (Skeleton Crew). MIT license.

## The radar look (Wi-Fi and bass apps)

Note: this part is in pull request #12. It shows on the live site once that is merged.

- The map fills the window. A small bar at the bottom holds the legend and help.
- Click the map to send a ping. A wave ring spreads out and fades, and you hear a soft thump.
- After you change something, a Before/After slider shows what changed.
- Three small goals per app tick off as you try things.
- Red always comes with a pattern (stripes or diamonds), so it does not rely on colour alone.
- If your system asks for less motion, the wave animation is off and you only get the thump and a note.

### Use my floor plan

Both apps (and the game) can start from a picture of a floor plan.

1. Choose "Use my floor plan" and pick a picture (a photo or scan with dark walls on light paper).
2. Click two points of known distance, then type the distance in metres. This sets the scale.
3. Dark lines become walls. A faint copy of the picture (15%) can sit under the map.

In the Wi-Fi app walls become brick. In the bass app walls are added to the room, and the speaker and seat move to the nearest free floor.

## Echo Stalker: how to play

You start in the dark. You see walls only when sound hits them.

| Key | What it does |
|---|---|
| W A S D or arrow keys | Walk. Each step makes a soft sound. |
| Shift | Sneak. Silent, half speed. |
| Space | Clap. Loud. Walls light up. Short wait before the next clap (0.8 s). |
| Click | Throw a pebble. It lands up to 8 m away and makes a sound there. Use it to pull the monster away. |
| ? or Esc | Help |

Goal: reach the faint pulsing exit marker.

- The monster has no eyes. It hears sound and walks toward the loudest direction. When it is quiet it wanders.
- You see the monster only as a red flash when a wave passes over it. Its footsteps are red rings. Your sounds are teal rings.
- Grey dotted zones are stealth zones. They soak up sound, so noise made inside is mostly hidden.
- Three levels: 1 First steps, 2 The snake (faster monster), 3 Two hunters (two monsters). Add `?level=2` to the address to jump to a level.
- Play Your Sketch: on the start screen, pick a floor-plan picture and set the scale (two clicks and metres). The game picks the start, the exit and the monster spot for you. A picture of your own flat works.
- Sound can be turned off. Every sound also has a ring on screen, so it plays fine muted.
- Keyboard and mouse only. No touch.

## Honest limits

- It is a flat (2D) model of a room seen from above. Real rooms are 3D. It shows the idea, not exact numbers.
- Wi-Fi shows relative signal, not real dBm. Flat waves fade more slowly with distance than real ones.
- Bass shows horizontal room modes only. There are no floor-to-ceiling modes. A 5 cm foam trap does little below 300 Hz.
- Live pings and the game run in slow motion so you can see the wave. Game on a good GPU: 0.2x speed. Bass ping: about 80 times slower than real. Wi-Fi ping: about 72 million times slower than real (radio is very fast).
- Without WebGPU the apps use the CPU. The game then uses a coarser grid (160 x 96 cells at 10 cm), so walls and waves look blurrier. Add `?backend=cpu` to test it.
- The Wi-Fi ping bounces off the room edge, because the live wave has no absorbing edge.
- Stealth zone strength and levels 2 and 3 were not tuned by playing.

### What was not checked

- Echo Stalker: a full play to the win screen, Retry and Next buttons by hand, and the sound by ear. The CPU fallback ran in Chrome with `?backend=cpu`, not on a PC without WebGPU. No "reduce flashing" switch exists. Only a drawn test image was used for sketches, not a photo of paper.
- Radar look (PR #12): the CPU fallback in the browser, reduced-motion switched on, the sound by ear, phones and small screens, and real paper photos. Of the mission ticks only the ping tick was seen. In the bass import the area outside the drawn room shows as grey wall.
- GPU time was measured in Node, and frame time in one Chrome on one Windows PC with an NVIDIA GPU. Other machines were not tried.

Details: [docs/echo-stalker.md](docs/echo-stalker.md), [docs/radar-and-sketch.md](docs/radar-and-sketch.md).

## Run it yourself

```
pnpm install
pnpm --filter echo-stalker dev      # or wifi-deadzone, bass-ghost-finder
```

## Layout

```
packages/ghostfield-core/   wave engine (no UI)
packages/ghostfield-ui/     shared look: palette, afterglow, thump, sketch importer
apps/wifi-deadzone/         Wi-Fi app
apps/bass-ghost-finder/     bass app
apps/echo-stalker/          the game
powers/ghostfield-fdtd/     Kiro Power (how to use the engine)
site-src/                   home page
```
