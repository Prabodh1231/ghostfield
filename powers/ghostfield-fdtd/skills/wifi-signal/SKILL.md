---
name: wifi-signal
description: How to read and report GhostField Wi-Fi output. The map is relative signal in dB inside a 2D model, not dBm. Use when explaining, labelling or changing the Wi-Fi dead-zone results, or when discussing bass versus Wi-Fi modes.
---

# Wi-Fi output is relative, not dBm

The Wi-Fi app (`apps/wifi-deadzone`) shows **relative signal in dB**, from a **2D** model.

- Output per cell is time-averaged `u^2` (`result.power`).
- `referencePower` takes the mean power on a ring of radius 0.5 m around the router, skipping wall cells. That level is 0 dB.
- `toDb(power, ref, floorDb = -90)` gives `10*log10(P/Pref)`, floored at -90.
- Never label it dBm. It has no transmit power, antenna gain or 3D spreading, so it cannot give absolute levels.
- Say "dead zone" or "weaker than 0.5 m from the router". Do not claim a real RSSI.

## Setup facts
- Frequency 2.4 GHz (`FREQ_HZ`). Cell size 1 cm (`CELL_M`). GPU grid 768, CPU grid 384. CPML 16 cells.
- Materials come from ITU-R P.2040-3 Table 3 at 2.4 GHz: epsr = a*f^b, sigma = c*f^d. `toMaterial` gives `C = eps0*epsr`, `L = mu0`, `gammaU = sigma/C`, `gammaQ = 0`.
- Wall thicknesses are app choices, not from ITU.
- Time step uses free-space speed (the fastest), with Courant 0.693. See the `ghostfield-engine` skill.

## Bass (not Wi-Fi)
The bass app (not in main when this was written) uses the same engine with pressure. Its modes are **horizontal** room modes. Test 7 checks the solver against the room-mode formula for a rigid rectangular room.

