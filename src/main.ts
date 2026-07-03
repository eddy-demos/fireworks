import { inject } from '@vercel/analytics';
import { FireworksShow } from './FireworksShow.ts';

// Vercel Web Analytics. This is a vanilla TS + Vite app (no React/Next), so we
// use the framework-agnostic inject() rather than the <Analytics /> component.
// Data is only collected once deployed on Vercel with Analytics enabled; locally
// it runs in debug mode and logs to the console without sending anything.
inject();

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

// Custom cursor: an outlined circle that follows the pointer (positioned via
// left/top so it tracks instantly), with a filled circle that fades in inside
// it while the click is held. The hold/scale styling is driven by CSS classes.
const cursor = document.getElementById('cursor') as HTMLDivElement;
window.addEventListener('pointermove', (e) => {
  cursor.style.left = `${e.clientX}px`;
  cursor.style.top = `${e.clientY}px`;
  cursor.classList.add('visible');
});
window.addEventListener('pointerdown', () => cursor.classList.add('held'));
const releaseCursor = () => cursor.classList.remove('held');
window.addEventListener('pointerup', releaseCursor);
window.addEventListener('pointercancel', releaseCursor);
window.addEventListener('blur', releaseCursor);

// Expose for quick console tweaking during development.
(window as unknown as { show: FireworksShow }).show = show;
