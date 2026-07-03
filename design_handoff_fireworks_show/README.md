# Handoff: Interactive July 4th Fireworks Show

## Overview
A full-screen interactive canvas animation: a looping night-sky fireworks show in four acts. By default the fireworks just burst and their sparks fall ballistically; if the user **presses and holds** during an act's window, the sparks are gathered by a damped spring into that act's dot-matrix formation — (1) the tenki logo, (2) a second brand logo, (3) the American flag, (4) the number "250" — and released back into gravity when they let go.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing the intended look and behavior, not production code to copy directly. The task is to **recreate this in the target codebase's environment** (React, vanilla TS, etc.) using its established patterns. If no environment exists yet, a single `<canvas>` + `requestAnimationFrame` module in whatever framework hosts it is appropriate — the logic is framework-agnostic.

Note: `fireworks-show.html` is written as a "Design Component" for a design tool. All the meaningful logic lives in the single `class Component` inside the `<script type="text/x-dc">` tag (~600 lines). `support.js` is that tool's runtime — **do not port it**; treat the class as the spec. The class's React-isms (`componentDidMount`, `this.props`) map to init/config in your port.

**Do not hand Claude Code the compressed standalone export (`American Flag Fireworks.html` bundle)** — it is a self-unpacking browser artifact, not source.

## Fidelity
**High-fidelity.** The physics constants, colors, timings, and interaction are final and tuned. Recreate behavior exactly; exact spark positions are randomized per cycle by design.

## Architecture
Two stacked full-viewport canvases over a CSS gradient background:
- **Star canvas** (below): ~90 twinkling stars, cleared and redrawn every frame. 30% are "glint" stars (sharp `pow(wave,5)` flashes with a small cross-flare); the rest pulse with `wave²`. Alpha 0.08–0.80, slight radius breathe.
- **Fireworks canvas** (above): NOT cleared each frame. Each frame it is faded with `globalCompositeOperation='destination-out'` + `rgba(0,0,0,0.11)` fill (this produces the motion trails), then sparks are drawn with `'lighter'` (additive). Dots that have settled into a formation draw with `'source-over'` so their colors read true instead of blooming white.
- Background CSS gradient: `linear-gradient(180deg, #0A0A1E 0%, #05050F 45%, #000000 100%)`.
- Hint line, bottom center: "PRESS AND HOLD TO SEE SOMETHING MAGICAL" — Inter Tight 300, 15px, letter-spacing 0.10em, uppercase, `rgba(255,255,255,0.40)`.

## The particle system (the heart of it)
One particle per formation dot. Every act ("set") has: `parts[]`, `bursts[]` (fireworks), formation origin `fx0/fy0`, and launch `times[]`.

**Formation sampling**: each target artwork is rasterized offscreen and sampled on a `dotSize` grid (default 9px):
- Flag: drawn programmatically at official 1:1.9 spec (13 stripes `#B22234`/white, canton `#3C3B6E` 7 stripes tall × 0.76H wide, 50 five-point stars in 9 alternating rows). Dots classified red/white/navy.
- "250": canvas text, `900 380px "Inter Tight","Arial Black"`, red `#C22436` fill + white stroke whose lineWidth is computed so the outline is **exactly 2 dots thick on screen**.
- Logos: the two SVGs in `uploads/`, rasterized at 900px wide; pixels classified mark-color vs white by channel comparison (blue: `b > r+40`; gold: `r > b+60`).
- All target coordinates get a **subtle isometric tilt** baked in: `x' = dx·0.95 − dy·0.10`, `y' = dy·0.88 + dx·0.10` around the shape center.
- Imperfection: every dot gets ±0.55·cell jitter; 7% are "strays" given a 25–120px offset, drawn at 0.75 alpha — they hang around the edges and never join cleanly.

**Bursts**: dots are chunked by color and x-position; each chunk gets one firework whose center is that chunk's centroid, raised 4–24% of viewport height (clamped 12–60% from top), jittered each cycle. Flag = 5 bursts (2 red, 2 white, 1 blue); "250" = 3 red (one per digit) + 1 white (the outline); logos = 1 mark-color + 2 white.

**Shell burst (spherical)**: every star starts AT the burst center with velocity = uniform-random direction on a **3D sphere projected to 2D** (normalize 3 gaussians, use x/y) × speed `baseSpeed·(1 + gauss·0.12)` (~12% variance = shell thickness). `baseSpeed` 260–440 per burst.

**Ballistics** (per frame, dt-integrated): gravity `+90 px/s²`, quadratic drag `v *= 1/(1 + 0.010·|v|·dt)`.

**Grab / formation** (the interaction): a per-act scalar `g` ramps 0→1 over 0.9s while pointer is held inside the act's window, decays over 0.8s otherwise. Per dot: `gp = clamp((g − rel·0.3)/0.7)`, smoothstepped — so dots join and release **staggered**, never all at once. While `s>0`, a critically-damped spring pulls toward the target: `k = 14·s`, `c = 2√k`. The held shape sinks 20 px/s (`sinkY` accumulates while g>0.6).

**Burn curve**: per-dot `life` 2.4–3.8s. `age = (timeSinceBurst − heldTime)/life` — **aging pauses while held** so formations don't die mid-hold. Brightness `= (1−age²)·flicker`, flicker `0.7+0.3·sin`. Color by age: white-hot `[255,244,224]` → chemical color (first 10% of life) → chemical → ember `[255,110,40]` (last 15%). A brief attack: `hot = e^(−18·tb)` boosts alpha ×(1+1.1·hot) and radius ×(1+0.5·hot). While formed, color crossfades to the settled formation color by the act's grab progress.

**Rendering batching**: dots are bucketed per frame by (drawMode, colorIndex, ageQuantile 0–5, alphaBand 1–8) and each bucket drawn as one path of circles — keep this, it's the perf backbone (~7k dots at 60fps).

## Timeline (seconds, scaled by `speed`)
Acts run back-to-back; each act: rockets launch staggered (`times[]`, 0.65s comet ascent each), burst, window opens at 1.0s and closes at `3.0 + holdTime` (flag act: `3.9 + holdTime`); next act starts 0.8s after the window closes; cycle ends 2.8s after the last window. Every cycle re-randomizes launch order, burst positions, shell velocities, strays, and jitter.

**Rockets**: gold `rgba(255,214,130,0.9)` comet (r 2.4) with white core, eased ascent from bottom to burst point, slight horizontal wobble; trails come free from the persistence fade. **Detonation**: 0.14s white core flash (alpha 0.45→0) + expanding shockwave ring (stroke, radius 14→204).

## Colors
Chemical (burst) → settled (formation):
- Red `rgb(255,77,94)` → `rgb(199,39,57)`
- White `rgb(255,255,255)` → same
- Flag navy `rgb(123,121,232)` → `rgb(95,93,190)`
- Logo blue `rgb(82,158,255)` → `#047BFF`
- Logo gold `rgb(255,216,120)` → `#FFC547`

## Config (exposed as tweakable props)
- `speed` 0.3–2.5 (default 1) — global time scale
- `holdTime` 0.5–8s (default 2.7) — how long each act's grab window stays open
- `autoForm` bool (default false) — formations assemble without interaction
- `dotSize` 4–16px (default 9) — sampling grid; smaller = more particles (perf scales ~1/cell²)

## Interactions
- `pointerdown` anywhere = hold (also `pointerup`/`pointercancel`/window `blur` release)
- Works with no interaction at all — then it's just a fireworks show
- Resize rebuilds all particle sets at the new viewport size

## Assets
- `uploads/Type=Regular (Large).svg` — tenki logo (blue `#047BFF` mark + white wordmark), act 1
- `uploads/Logo.svg` — second logo (gold `#FFC547` mark + white wordmark), act 2
- Flag and "250" are generated in code — no assets

## Files
- `fireworks-show.html` — the prototype; all logic in the `class Component` script tag
- `support.js` — design-tool runtime, reference only, do not port
- `uploads/*.svg` — the two logo sources
