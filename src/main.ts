import { FireworksShow } from './FireworksShow.ts';

const canvas = document.getElementById('fireworks') as HTMLCanvasElement;
const starCanvas = document.getElementById('stars') as HTMLCanvasElement;

// Assets live in public/uploads and are served from the site root.
// encodeURI handles the space and parentheses in the filename.
const show = new FireworksShow(canvas, starCanvas, {
  tenkiLogo: encodeURI('/uploads/Type=Regular (Large).svg'),
  logo2: encodeURI('/uploads/Logo.svg'),
});

// Config is tweakable — see FireworksConfig (speed, holdTime, autoForm, dotSize).
// Defaults match the design handoff. Example: show.setConfig({ autoForm: true }).
show.start();

// Wait for Inter Tight before rasterizing the "250" so the outline dots land
// on the real glyph shapes rather than the Arial Black fallback.
if (document.fonts?.ready) {
  document.fonts.ready.then(() => {
    // Re-run setup so buildTextSet re-rasterizes with the loaded font.
    window.dispatchEvent(new Event('resize'));
  });
}

// Expose for quick console tweaking during development.
(window as unknown as { show: FireworksShow }).show = show;
