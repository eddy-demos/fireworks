# Fireworks

An interactive July 4th fireworks show — a full-screen, looping night-sky canvas
animation in four acts. Fireworks burst and their sparks fall ballistically; if you
**press and hold** during an act's window, the sparks are gathered by a damped spring
into that act's dot-matrix formation:

1. the tenki logo
2. the luxor logo
3. the American flag
4. the number "250"

Release, and they fall back into gravity.

## Run

```bash
npm install
npm run dev      # start the Vite dev server
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
```

Then open the printed local URL and press-and-hold anywhere.

## How it works

- [index.html](index.html) — two stacked full-viewport canvases (stars below,
  fireworks above) over a CSS gradient sky, plus the hint line.
- [src/FireworksShow.ts](src/FireworksShow.ts) — a framework-agnostic `<canvas>` +
  `requestAnimationFrame` module. One particle per formation dot; each act's dots
  belong to same-color firework bursts. Physics (spherical shell burst, gravity +
  quadratic drag, critically-damped grab spring), the burn/color curve, and the
  staggered per-dot grab are all here. Ported verbatim from the design handoff's
  reference prototype.
- [src/main.ts](src/main.ts) — bootstrap: wires the canvases, points at the logo
  SVGs, and starts the loop.
- [public/uploads/](public/uploads/) — the two logo SVGs (the flag and "250" are
  generated in code). The design reference lives in `design_handoff_fireworks_show/`.

## Config

Tweakable via `show.setConfig({...})` (defaults match the handoff):

| prop       | default | range     | meaning                                    |
| ---------- | ------- | --------- | ------------------------------------------ |
| `speed`    | 1       | 0.3–2.5   | global time scale                          |
| `holdTime` | 2.7     | 0.5–8 s   | how long each act's grab window stays open |
| `autoForm` | false   | bool      | formations assemble without interaction    |
| `dotSize`  | 9       | 4–16 px   | sampling grid; smaller = more particles    |
