// Interactive July 4th fireworks show.
//
// Framework-agnostic port of the design-handoff prototype's `class Component`.
// All physics constants, colors, timings, and the press-and-hold interaction are
// ported verbatim from the reference; only the React-isms (props, refs, lifecycle)
// were mapped onto a plain constructor + start()/destroy() and a config object.
//
// Two stacked canvases: a star layer (cleared every frame) below a fireworks layer
// (persistence-faded every frame to produce motion trails). One particle per
// formation dot; each act gathers its sparks into a dot-matrix shape while held.

export interface FireworksConfig {
  /** global time scale, 0.3–2.5 */
  speed: number;
  /** how long each act's grab window stays open, in seconds (0.5–8) */
  holdTime: number;
  /** formations assemble without interaction */
  autoForm: boolean;
  /** sampling grid in px, 4–16; smaller = more particles */
  dotSize: number;
}

export interface FireworksAssets {
  /** tenki logo — blue mark + white wordmark (act 1) */
  tenkiLogo: string;
  /** second logo — gold mark + white wordmark (act 2) */
  logo2: string;
}

const DEFAULT_CONFIG: FireworksConfig = {
  speed: 1,
  holdTime: 2.7,
  autoForm: false,
  dotSize: 9,
};

interface Part {
  fx: number; fy: number; ci: number; bi: number;
  svx: number; svy: number; born: boolean;
  x: number; y: number; vx: number; vy: number;
  life: number; heldT: number; seed: number; rel: number;
  stray: boolean; ox: number; oy: number;
}

interface Burst {
  baseX: number; baseY: number; cx: number; cy: number; lx: number; bt: number; baseSpeed: number;
}

interface ParticleSet {
  parts: Part[]; bursts: Burst[]; fx0: number; fy0: number; sinkY: number; times: number[];
}

interface Star { x: number; y: number; r: number; ph: number; sp: number; glint: boolean; }

function makePart(fx: number, fy: number, ci: number): Part {
  return {
    fx, fy, ci, bi: 0,
    svx: 0, svy: 0, born: false,
    x: 0, y: 0, vx: 0, vy: 0,
    life: 0, heldT: 0, seed: 0, rel: 0,
    stray: false, ox: 0, oy: 0,
  };
}

export class FireworksShow {
  private canvas: HTMLCanvasElement;
  private starCanvas: HTMLCanvasElement;
  private assets: FireworksAssets;
  private config: FireworksConfig;

  private ctx!: CanvasRenderingContext2D;
  private sctx!: CanvasRenderingContext2D;

  private raf: number | null = null;
  private t = 0;
  private last: number | null = null;
  private dt = 0.016;
  private cycleIdx = -1;
  private holding = false;
  private grabs = [0, 0, 0, 0];

  private w = 0;
  private h = 0;
  private cell = 9;
  private stars: Star[] = [];

  // chemical star colors (mid-burn) and settled formation colors
  // ci: 0 red, 1 white, 2 flag navy, 3 logo blue, 4 logo gold
  private chemCols = [[255, 77, 94], [255, 255, 255], [123, 121, 232], [82, 158, 255], [255, 216, 120]];
  private flagCols = [[199, 39, 57], [255, 255, 255], [95, 93, 190], [4, 123, 255], [255, 197, 71]];
  private hotCol = [255, 244, 224];
  private emberCol = [255, 110, 40];

  // flag artwork raster
  private flagData!: Uint8ClampedArray;
  private flagW = 0;
  private flagH = 0;

  // formation sets
  private flagSet!: ParticleSet;
  private textSet!: ParticleSet;
  private logoSet?: ParticleSet;
  private logo2Set?: ParticleSet;

  // formation origin for the flag (recomputed in rebuildParticles)
  private fx0 = 0;
  private fy0 = 0;

  private logoImg?: HTMLImageElement;
  private logo2Img?: HTMLImageElement;

  private onResize = () => this.setup();
  private onDown = () => { this.holding = true; };
  private onUp = () => { this.holding = false; };

  constructor(
    canvas: HTMLCanvasElement,
    starCanvas: HTMLCanvasElement,
    assets: FireworksAssets,
    config: Partial<FireworksConfig> = {},
  ) {
    this.canvas = canvas;
    this.starCanvas = starCanvas;
    this.assets = assets;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** update tweakable config at runtime (e.g. from a control panel) */
  setConfig(patch: Partial<FireworksConfig>) {
    this.config = { ...this.config, ...patch };
  }

  // ── lifecycle (was componentDidMount / componentWillUnmount) ────────────────

  start() {
    this.buildFlagArt();
    // the logo SVGs rasterize async; each act joins the show once loaded
    const img = new Image();
    img.onload = () => {
      this.logoImg = img;
      if (this.w) { this.buildLogoSet(this.cell); this.randomizeCycle([this.logoSet, this.logo2Set].filter(Boolean) as ParticleSet[]); }
    };
    img.src = this.assets.tenkiLogo;
    const img2 = new Image();
    img2.onload = () => {
      this.logo2Img = img2;
      if (this.w) { this.buildLogoSet(this.cell); this.randomizeCycle([this.logoSet, this.logo2Set].filter(Boolean) as ParticleSet[]); }
    };
    img2.src = this.assets.logo2;

    this.setup();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('blur', this.onUp);
    this.startLoop();
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('blur', this.onUp);
  }

  private gauss(): number {
    return (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 0.85;
  }

  // ── formation artwork ───────────────────────────────────────────────────────

  // Flat flag art, official 1:1.9, sampled for dot colors
  private buildFlagArt() {
    const H = 650, W = Math.round(H * 1.9);
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d')!;
    const stripeH = H / 13;
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#B22234' : '#FFFFFF';
      ctx.fillRect(0, Math.round(i * stripeH), W, Math.ceil(stripeH));
    }
    const unionH = stripeH * 7, unionW = 0.76 * H;
    ctx.fillStyle = '#3C3B6E';
    ctx.fillRect(0, 0, unionW, unionH);
    const gx = unionW / 12, gy = unionH / 10;
    const starR = 0.0616 * H * 0.5;
    ctx.fillStyle = '#FFFFFF';
    for (let r = 0; r < 9; r++) {
      const count = r % 2 === 0 ? 6 : 5;
      const offX = r % 2 === 0 ? gx : gx * 2;
      for (let c = 0; c < count; c++) this.drawStar(ctx, offX + c * gx * 2, gy + r * gy, starR);
    }
    this.flagData = ctx.getImageData(0, 0, W, H).data;
    this.flagW = W; this.flagH = H;
  }

  private drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const aOut = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const aIn = aOut + Math.PI / 5;
      const ri = r * 0.382;
      if (i === 0) ctx.moveTo(cx + r * Math.cos(aOut), cy + r * Math.sin(aOut));
      else ctx.lineTo(cx + r * Math.cos(aOut), cy + r * Math.sin(aOut));
      ctx.lineTo(cx + ri * Math.cos(aIn), cy + ri * Math.sin(aIn));
    }
    ctx.closePath();
    ctx.fill();
  }

  // subtle isometric-like tilt baked into the formation coordinates
  private isoXY(fx: number, fy: number, fw: number, fh: number) {
    const dx = fx - fw / 2, dy = fy - fh / 2;
    return {
      x: fw / 2 + dx * 0.95 - dy * 0.10,
      y: fh / 2 + dy * 0.88 + dx * 0.10,
    };
  }

  // ── canvas setup + particle construction ────────────────────────────────────

  private setup() {
    const c = this.canvas, sc = this.starCanvas;
    if (!c || !sc) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    sc.width = w * dpr; sc.height = h * dpr;
    this.ctx = c.getContext('2d')!;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sctx = sc.getContext('2d')!;
    this.sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.stars = [];
    for (let i = 0; i < 90; i++) {
      this.stars.push({
        x: Math.random() * w, y: Math.random() * h * 0.85,
        r: 0.6 + Math.random() * 1.1, ph: Math.random() * 6.28,
        sp: 0.8 + Math.random() * 2.4, glint: Math.random() < 0.3,
      });
    }
    this.rebuildParticles();
  }

  // Effective sampling cell. `dotSize` is tuned in CSS px for a desktop-width
  // viewport; since each formation's width scales with the viewport, a fixed
  // cell yields far fewer dots on narrow (mobile) screens and the shapes read
  // as sparse. Scaling the cell down on smaller viewports keeps the dot count
  // *across* a formation roughly constant, so forms stay legible everywhere.
  private effectiveCell(): number {
    const REF_W = 1000; // width dotSize was tuned for; wider screens are unchanged
    const scale = Math.min(1, this.w / REF_W);
    return Math.max(2.5, this.config.dotSize * scale);
  }

  // One particle per flag dot; each belongs to a same-color firework burst
  private rebuildParticles() {
    const w = this.w, h = this.h;
    const cell = this.cell = this.effectiveCell();
    const fw = Math.min(w * 0.68, h * 0.6 * 1.9), fh = fw / 1.9;
    this.fx0 = (w - fw) / 2;
    this.fy0 = (h - fh) / 2 - h * 0.02;
    const srcW = this.flagW, srcH = this.flagH, fd = this.flagData;
    const parts: Part[] = [];
    for (let fx = cell / 2; fx < fw; fx += cell) {
      const sx = Math.min(srcW - 1, Math.round((fx / fw) * srcW));
      for (let fy = cell / 2; fy < fh; fy += cell) {
        const sy = Math.min(srcH - 1, Math.round((fy / fh) * srcH));
        const i = (sy * srcW + sx) * 4;
        const r = fd[i], g = fd[i + 1], bl = fd[i + 2];
        let ci: number;
        if (r > 190 && g > 190 && bl > 190) ci = 1;
        else if (r > g && r > bl) ci = 0;
        else ci = 2;
        const q = this.isoXY(fx, fy, fw, fh);
        parts.push(makePart(q.x, q.y, ci));
      }
    }
    // bursts: 2 red, 2 white, 1 blue — dots chunked by x so gathering stays coherent
    const groups: Part[][] = [[], [], []];
    for (const p of parts) groups[p.ci].push(p);
    const bursts: Burst[] = [];
    const makeBursts = (list: Part[], n: number) => {
      list.sort((a, b) => a.fx - b.fx);
      const per = Math.ceil(list.length / n);
      for (let j = 0; j < n; j++) {
        const chunk = list.slice(j * per, (j + 1) * per);
        if (!chunk.length) continue;
        let mx = 0, my = 0;
        for (const p of chunk) { mx += p.fx; my += p.fy; }
        mx = this.fx0 + mx / chunk.length;
        my = this.fy0 + my / chunk.length;
        const bi = bursts.length;
        bursts.push({ baseX: mx, baseY: my, cx: mx, cy: my, lx: mx, bt: 0, baseSpeed: 300 });
        for (const p of chunk) p.bi = bi;
      }
    };
    makeBursts(groups[0], 2);
    makeBursts(groups[1], 2);
    makeBursts(groups[2], 1);
    this.flagSet = { parts, bursts, fx0: this.fx0, fy0: this.fy0, sinkY: 0, times: [0.25, 0.7, 1.15, 1.6, 2.05] };
    this.buildTextSet(cell);
    this.buildLogoSet(cell);
    this.randomizeCycle();
  }

  // Logo dot grids sampled from the uploaded SVGs — colored mark + white wordmark
  private buildLogoSet(cell: number) {
    if (this.logoImg && this.w) {
      this.logoSet = this.buildOneLogo(this.logoImg, cell, 3, (r, _g, b) => b > r + 40);
    }
    if (this.logo2Img && this.w) {
      this.logo2Set = this.buildOneLogo(this.logo2Img, cell, 4, (r, _g, b) => r > b + 60);
    }
  }

  private buildOneLogo(img: HTMLImageElement, cell: number, markCi: number, isMark: (r: number, g: number, b: number) => boolean): ParticleSet {
    const w = this.w, h = this.h;
    const ratio = img.width / img.height;
    const LW = 900, LH = Math.max(1, Math.round(LW / ratio));
    const off = document.createElement('canvas');
    off.width = LW; off.height = LH;
    const c = off.getContext('2d')!;
    c.drawImage(img, 0, 0, LW, LH);
    const td = c.getImageData(0, 0, LW, LH).data;
    const fw = Math.min(w * 0.62, h * 0.9 * ratio);
    const fh = fw / ratio;
    const fx0 = (w - fw) / 2, fy0 = (h - fh) / 2 - h * 0.02;
    const parts: Part[] = [];
    for (let fx = cell / 2; fx < fw; fx += cell) {
      const sx = Math.min(LW - 1, Math.round((fx / fw) * LW));
      for (let fy = cell / 2; fy < fh; fy += cell) {
        const sy = Math.min(LH - 1, Math.round((fy / fh) * LH));
        const i = (sy * LW + sx) * 4;
        if (td[i + 3] < 128) continue;
        const ci = isMark(td[i], td[i + 1], td[i + 2]) ? markCi : 1;
        const q = this.isoXY(fx, fy, fw, fh);
        parts.push(makePart(q.x, q.y, ci));
      }
    }
    // one colored burst for the mark, two white bursts for the wordmark
    const bursts: Burst[] = [];
    const makeChunks = (list: Part[], n: number) => {
      list.sort((a, b) => a.fx - b.fx);
      const per = Math.ceil(list.length / n);
      for (let j = 0; j < n; j++) {
        const chunk = list.slice(j * per, (j + 1) * per);
        if (!chunk.length) continue;
        let mx = 0, my = 0;
        for (const p of chunk) { mx += p.fx; my += p.fy; }
        mx = fx0 + mx / chunk.length;
        my = fy0 + my / chunk.length;
        const bi = bursts.length;
        bursts.push({ baseX: mx, baseY: my, cx: mx, cy: my, lx: mx, bt: 0, baseSpeed: 300 });
        for (const p of chunk) p.bi = bi;
      }
    };
    makeChunks(parts.filter((p) => p.ci === markCi), 1);
    makeChunks(parts.filter((p) => p.ci === 1), 2);
    return { parts, bursts, fx0, fy0, sinkY: 0, times: [0.25, 0.7, 1.15] };
  }

  // "250" dot grid — all red, one firework per digit
  private buildTextSet(cell: number) {
    const w = this.w, h = this.h;
    const TW = 1100, TH = 460;
    const off = document.createElement('canvas');
    off.width = TW; off.height = TH;
    const c = off.getContext('2d')!;
    c.font = '900 380px "Inter Tight", "Arial Black", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // red fill + white outline → red dots inside, white border dots
    const fw = Math.min(w * 0.72, h * 0.72 * (TW / TH));
    c.fillStyle = '#C22436';
    c.fillText('250', TW / 2, TH / 2 + 14);
    c.lineWidth = 2 * cell * (TW / fw); // border exactly 2 dots thick on screen
    c.strokeStyle = '#FFFFFF';
    c.strokeText('250', TW / 2, TH / 2 + 14);
    const td = c.getImageData(0, 0, TW, TH).data;
    const fh = fw * (TH / TW);
    const fx0 = (w - fw) / 2, fy0 = (h - fh) / 2 - h * 0.02;
    const parts: Part[] = [];
    for (let fx = cell / 2; fx < fw; fx += cell) {
      const sx = Math.min(TW - 1, Math.round((fx / fw) * TW));
      for (let fy = cell / 2; fy < fh; fy += cell) {
        const sy = Math.min(TH - 1, Math.round((fy / fh) * TH));
        const i = (sy * TW + sx) * 4;
        if (td[i + 3] < 128) continue;
        const ci = td[i] > 190 && td[i + 1] > 190 ? 1 : 0;
        const q = this.isoXY(fx, fy, fw, fh);
        parts.push(makePart(q.x, q.y, ci));
      }
    }
    // red dots: one burst per digit (chunk by x); white border dots: one big white burst
    const bursts: Burst[] = [];
    const makeChunks = (list: Part[], n: number) => {
      list.sort((a, b) => a.fx - b.fx);
      const per = Math.ceil(list.length / n);
      for (let j = 0; j < n; j++) {
        const chunk = list.slice(j * per, (j + 1) * per);
        if (!chunk.length) continue;
        let mx = 0, my = 0;
        for (const p of chunk) { mx += p.fx; my += p.fy; }
        mx = fx0 + mx / chunk.length;
        my = fy0 + my / chunk.length;
        const bi = bursts.length;
        bursts.push({ baseX: mx, baseY: my, cx: mx, cy: my, lx: mx, bt: 0, baseSpeed: 300 });
        for (const p of chunk) p.bi = bi;
      }
    };
    makeChunks(parts.filter((p) => p.ci === 0), 3);
    makeChunks(parts.filter((p) => p.ci === 1), 1);
    this.textSet = { parts, bursts, fx0, fy0, sinkY: 0, times: [0.25, 0.65, 1.05, 1.45] };
  }

  // Fresh launch order, burst positions, and shell velocities each cycle
  private randomizeCycle(only?: ParticleSet[]) {
    for (const set of (only || [this.logoSet, this.logo2Set, this.flagSet, this.textSet])) {
      if (!set) continue;
      set.sinkY = 0;
      const times = set.times.slice();
      for (let i = times.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = times[i]; times[i] = times[j]; times[j] = tmp;
      }
      set.bursts.forEach((b, i) => {
        b.bt = times[i % times.length];
        b.cx = b.baseX + (Math.random() - 0.5) * this.w * 0.10;
        // varied heights, staying near each chunk's own region of the shape
        b.cy = Math.max(this.h * 0.12, Math.min(this.h * 0.60, b.baseY - (0.04 + Math.random() * 0.20) * this.h));
        b.lx = b.cx + (Math.random() - 0.5) * 60;
        b.baseSpeed = 260 + Math.random() * 180;
      });
      for (const p of set.parts) {
        const b = set.bursts[p.bi];
        // spherical shell: uniform direction on a 3D sphere projected to 2D,
        // tight speed distribution (~12% variance) = shell thickness
        const nx = this.gauss(), ny = this.gauss(), nz = this.gauss();
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const speed = b.baseSpeed * (1 + this.gauss() * 0.12);
        p.svx = (nx / len) * speed;
        p.svy = (ny / len) * speed;
        p.born = false;
        p.x = 0; p.y = 0; p.vx = 0; p.vy = 0;
        p.life = 2.4 + Math.random() * 1.4;
        p.heldT = 0;
        p.seed = Math.random();
        p.rel = Math.random();
        // imperfection: most dots settle slightly off-grid; some stay stray off to the sides
        p.stray = Math.random() < 0.07;
        if (p.stray) {
          const sa = Math.random() * 6.2832;
          const sd = 25 + Math.random() * 95;
          p.ox = Math.cos(sa) * sd;
          p.oy = Math.sin(sa) * sd * 0.8;
        } else {
          p.ox = (Math.random() - 0.5) * this.cell * 1.1;
          p.oy = (Math.random() - 0.5) * this.cell * 1.1;
        }
      }
    }
  }

  // ── main loop ───────────────────────────────────────────────────────────────

  private startLoop() {
    const tick = (now: number) => {
      if (this.last == null) this.last = now;
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.t += dt * this.config.speed;
      this.dt = dt * this.config.speed;
      if (this.effectiveCell() !== this.cell) this.rebuildParticles();
      this.drawFrame();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private drawFrame() {
    const ctx = this.ctx, sctx = this.sctx;
    if (!ctx || !sctx || !this.flagSet) return;
    const w = this.w, h = this.h, t = this.t;

    // Acts: tenki logo → second logo → flag → red/white "250".
    // Sparks just burst and fall — unless the user presses and holds
    // during an act's window, which gathers them into that act's formation.
    const hold = this.config.holdTime; // how long the grab window stays open
    const winA = 1.0;
    const win0b = 3.0 + hold;
    const tL2 = win0b + 0.8;
    const winL2b = 3.0 + hold;
    const t1 = tL2 + winL2b + 0.8;
    const win1b = 3.9 + hold;
    const t2 = t1 + win1b + 0.8;
    const win2b = 3.0 + hold;
    const D = t2 + win2b + 2.8;
    const ct = t % D;
    const idx = Math.floor(t / D);
    if (idx !== this.cycleIdx) { this.cycleIdx = idx; this.randomizeCycle(); this.grabs = [0, 0, 0, 0]; }

    // night-sky stars live on their own layer so trail fade doesn't smear them
    sctx.clearRect(0, 0, w, h);
    sctx.fillStyle = '#FFFFFF';
    for (const s of this.stars) {
      const wave = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      // sharp-valleyed pulse; "glint" stars flash bright and brief
      const tw = s.glint ? Math.pow(wave, 5) : wave * wave;
      sctx.globalAlpha = 0.08 + 0.72 * tw;
      const rr = s.r * (0.85 + 0.45 * tw);
      sctx.beginPath();
      sctx.arc(s.x, s.y, rr, 0, 6.2832);
      sctx.fill();
      if (s.glint && tw > 0.55) {
        // tiny cross flare at peak
        sctx.globalAlpha = (tw - 0.55) * 1.4;
        sctx.fillRect(s.x - rr * 3.2, s.y - 0.4, rr * 6.4, 0.8);
        sctx.fillRect(s.x - 0.4, s.y - rr * 3.2, 0.8, rr * 6.4);
      }
    }
    sctx.globalAlpha = 1;

    // trails: fade the previous frame instead of clearing it, then draw additively
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.11)'; // lower = longer trails on moving sparks
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    this.renderSet(ct, this.logoSet, winA, win0b, 0);
    this.renderSet(ct - tL2, this.logo2Set, winA, winL2b, 1);
    this.renderSet(ct - t1, this.flagSet, winA, win1b, 2);
    this.renderSet(ct - t2, this.textSet, winA, win2b, 3);

    ctx.globalCompositeOperation = 'source-over';
  }

  // Draw one act: comet launch → shell burst; ballistic sparks fall free
  // unless the user holds, which spring-gathers them onto their targets
  private renderSet(ct: number, set: ParticleSet | undefined, win0: number, win1: number, gi: number) {
    if (!set || ct < -0.75) return;
    // grab ramps up while held inside the window, decays otherwise
    const active = (this.holding || this.config.autoForm) && ct >= win0 && ct <= win1;
    let g = this.grabs[gi];
    g = active ? Math.min(1, g + this.dt / 0.9) : Math.max(0, g - this.dt / 0.8);
    this.grabs[gi] = g;
    if (ct > win1 + 4.8 && g <= 0) return;
    const ctx = this.ctx, h = this.h, t = this.t, dt = this.dt;
    ctx.globalCompositeOperation = 'lighter';

    // shape sinks slowly while it is being held together
    if (g > 0.6) set.sinkY += 20 * dt;

    // launch comets (persistence gives them their tails) + burst shockwave ring
    const rd = 0.65;
    for (const b of set.bursts) {
      if (ct >= b.bt - rd && ct < b.bt) {
        const u = (ct - (b.bt - rd)) / rd;
        const ey = 1 - (1 - u) * (1 - u);
        const rx = b.lx + (b.cx - b.lx) * u;
        const ry = (h + 12) + (b.cy - (h + 12)) * ey;
        ctx.fillStyle = 'rgba(255,214,130,0.9)';
        ctx.beginPath();
        ctx.arc(rx + Math.sin(ct * 40 + b.bt * 9) * 1.2, ry, 2.4, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(rx, ry, 1.2, 0, 6.2832);
        ctx.fill();
      }
      const ft = ct - b.bt;
      if (ft >= 0 && ft < 0.14) {
        const kk = ft / 0.14;
        // hard attack: bright core flash + expanding shockwave ring
        ctx.globalAlpha = (1 - kk);
        ctx.fillStyle = 'rgba(255,250,235,0.45)';
        ctx.beginPath();
        ctx.arc(b.cx, b.cy, 10 + kk * 26, 0, 6.2832);
        ctx.fill();
        ctx.globalAlpha = (1 - kk) * 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.cx, b.cy, 14 + kk * 190, 0, 6.2832);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // grab progress → how far colors have settled from chemical burn to formation color
    const sG = g * g * (3 - 2 * g);

    // color table: [ci][ageQ] — white-hot ignition → chemical color → ember,
    // blended toward the formation color by grab progress
    const cols: number[][][] = [];
    for (let ci = 0; ci < 5; ci++) {
      cols[ci] = [];
      const chem = this.chemCols[ci], flag = this.flagCols[ci];
      for (let aq = 0; aq < 6; aq++) {
        const a = (aq + 0.5) / 6;
        let c0: number[];
        if (a < 0.10) {
          const m = a / 0.10;
          c0 = [0, 1, 2].map((j) => this.hotCol[j] + (chem[j] - this.hotCol[j]) * m);
        } else if (a < 0.85) {
          c0 = chem;
        } else {
          const m = (a - 0.85) / 0.15;
          c0 = [0, 1, 2].map((j) => chem[j] + (this.emberCol[j] - chem[j]) * m);
        }
        cols[ci][aq] = [0, 1, 2].map((j) => Math.round(c0[j] + (flag[j] - c0[j]) * sG));
      }
    }

    const GRAV = 90, CD = 0.010; // gravity + quadratic air drag
    const flagR = this.cell * 0.42;
    const buckets = new Map<number, number[]>();

    for (const p of set.parts) {
      const b = set.bursts[p.bi];
      if (ct < b.bt) { p.born = false; continue; }
      if (!p.born) {
        // every star starts AT the burst center with radial shell velocity
        p.born = true;
        p.x = b.cx; p.y = b.cy;
        p.vx = p.svx; p.vy = p.svy;
        p.heldT = 0;
      }
      const tb = ct - b.bt;

      // per-dot staggered grab: dots join and let go one by one
      const gp = Math.min(1, Math.max(0, (g - p.rel * 0.3) / 0.7));
      const s = gp * gp * (3 - 2 * gp);

      // ballistic integration: gravity + quadratic drag
      p.vy += GRAV * dt;
      const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const dr = 1 / (1 + CD * spd * dt);
      p.vx *= dr; p.vy *= dr;
      // critically-damped spring toward the target while grabbed
      if (s > 0.001) {
        const tx = set.fx0 + p.fx + p.ox;
        const ty = set.fy0 + p.fy + p.oy + set.sinkY;
        const kk = 14 * s, cc = 2 * Math.sqrt(kk);
        p.vx += (tx - p.x) * kk * dt - p.vx * cc * dt;
        p.vy += (ty - p.y) * kk * dt - p.vy * cc * dt;
        p.heldT += dt * s; // burning pauses while the star is held in formation
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // burn curve: age drives brightness and color; held stars stop aging
      const age = Math.min(1, Math.max(0, (tb - p.heldT) / p.life));
      if (age >= 1 && s <= 0.01) continue;
      const flick = 0.7 + 0.3 * Math.sin(p.seed * 6.28 + t * (13 + p.seed * 9));
      const hot = Math.exp(-tb * 18); // brief one-flash attack at ignition
      let al = (1 - age * age) * flick * (1 - s) + s * (p.stray ? 0.75 : 1);
      al = Math.min(1, al * (1 + 1.1 * hot));
      if (al <= 0.02) continue;
      const r = (2.2 + (flagR - 2.2) * s) * (1 + 0.5 * hot);

      const ageQ = Math.min(5, Math.floor(age * 6));
      const band = Math.min(8, Math.max(1, Math.round(al * 8)));
      const mode = s > 0.6 ? 1 : 0; // formed dots draw solid so colors read true
      const key = ((mode * 5 + p.ci) * 6 + ageQ) * 10 + band;
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(p.x, p.y, r);
    }

    for (const entry of buckets) {
      const key = entry[0], arr = entry[1];
      const band = key % 10;
      const rest = (key - band) / 10;
      const ageQ = rest % 6;
      const mci = (rest - ageQ) / 6;
      const ci = mci % 5;
      const mode = (mci - ci) / 5;
      const c = cols[ci][ageQ];
      ctx.globalCompositeOperation = mode === 1 ? 'source-over' : 'lighter';
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${band / 8})`;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 3) {
        ctx.moveTo(arr[i] + arr[i + 2], arr[i + 1]);
        ctx.arc(arr[i], arr[i + 1], arr[i + 2], 0, 6.2832);
      }
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
  }
}
