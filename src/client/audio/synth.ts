/**
 * Procedural sound synthesis. Every sound in the game is generated at
 * runtime from noise, oscillators and filters (no recorded assets), so all
 * audio is original. Buffers are rendered once per variant and cached.
 */
import { Random } from '../../common/math/rng';

export type Recipe = (ctx: SynthCtx) => void;

/** Offline sample writer with small DSP helpers. */
export class SynthCtx {
  readonly data: Float32Array;
  readonly rng: Random;

  constructor(
    readonly sr: number,
    readonly seconds: number,
    seed: number,
  ) {
    this.data = new Float32Array(Math.max(1, Math.floor(sr * seconds)));
    this.rng = new Random(seed);
  }

  get length(): number {
    return this.data.length;
  }

  /** White noise burst with an attack/decay envelope, filtered through a band. */
  noise(opts: { start?: number; dur: number; gain: number; attack?: number; decay?: number; lp?: number; hp?: number; bp?: [number, number]; grain?: number }): void {
    const { sr, data, rng } = this;
    const s0 = Math.floor((opts.start ?? 0) * sr);
    const n = Math.min(data.length - s0, Math.floor(opts.dur * sr));
    const lp = opts.lp ? onePoleCoef(opts.lp, sr) : 1;
    const hp = opts.hp ? onePoleCoef(opts.hp, sr) : 0;
    const bp = opts.bp ? new Biquad('bandpass', opts.bp[0], opts.bp[1], sr) : null;
    let l = 0;
    let h = 0;
    const att = Math.max(1, (opts.attack ?? 0.002) * sr);
    const dec = (opts.decay ?? opts.dur / 4) * sr;
    let hold = 0;
    for (let i = 0; i < n; i++) {
      let v: number;
      if (opts.grain) {
        // Granular crunch: sample-and-hold noise with random gating
        if (i % opts.grain === 0) hold = rng.next() < 0.6 ? rng.next() * 2 - 1 : 0;
        v = hold;
      } else v = rng.next() * 2 - 1;
      l += (v - l) * lp;
      h += (l - h) * hp;
      let out = l - (hp ? h : 0);
      if (bp) out = bp.process(out);
      const env = Math.min(1, i / att) * Math.exp(-i / dec);
      data[s0 + i]! += out * env * opts.gain;
    }
  }

  /** Oscillator tone with an exponential pitch glide and envelope. */
  tone(opts: { start?: number; dur: number; gain: number; f0: number; f1?: number; wave?: 'sine' | 'square' | 'saw' | 'tri'; attack?: number; decay?: number; vibrato?: number; vibratoRate?: number; lp?: number }): void {
    const { sr, data } = this;
    const s0 = Math.floor((opts.start ?? 0) * sr);
    const n = Math.min(data.length - s0, Math.floor(opts.dur * sr));
    const f1 = opts.f1 ?? opts.f0;
    const att = Math.max(1, (opts.attack ?? 0.005) * sr);
    const dec = (opts.decay ?? opts.dur / 3) * sr;
    const lp = opts.lp ? onePoleCoef(opts.lp, sr) : 1;
    let ph = 0;
    let l = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      let f = opts.f0 * Math.pow(f1 / opts.f0, t);
      if (opts.vibrato) f *= 1 + Math.sin((i / sr) * Math.PI * 2 * (opts.vibratoRate ?? 6)) * opts.vibrato;
      ph += f / sr;
      ph -= Math.floor(ph);
      let v: number;
      switch (opts.wave ?? 'sine') {
        case 'square':
          v = ph < 0.5 ? 1 : -1;
          break;
        case 'saw':
          v = ph * 2 - 1;
          break;
        case 'tri':
          v = 1 - Math.abs(ph * 4 - 2);
          break;
        default:
          v = Math.sin(ph * Math.PI * 2);
      }
      l += (v - l) * lp;
      const env = Math.min(1, i / att) * Math.exp(-i / dec) * Math.min(1, (n - i) / (sr * 0.004));
      data[s0 + i]! += l * env * opts.gain;
    }
  }

  /** Inharmonic partials (bells, metal, glass). */
  bell(opts: { start?: number; f: number; ratios: number[]; gain: number; decay: number; dur: number }): void {
    opts.ratios.forEach((r, i) => this.tone({ start: opts.start, dur: opts.dur, gain: opts.gain / (1 + i * 0.7), f0: opts.f * r, attack: 0.001, decay: opts.decay / (1 + i * 0.4) }));
  }

  /** Resonant knock (wood, doors): filtered click driving a decaying resonator. */
  knock(opts: { start?: number; f: number; gain: number; decay: number; noise?: number }): void {
    this.tone({ start: opts.start, dur: opts.decay * 4, gain: opts.gain, f0: opts.f * 1.3, f1: opts.f, attack: 0.001, decay: opts.decay });
    this.tone({ start: opts.start, dur: opts.decay * 3, gain: opts.gain * 0.4, f0: opts.f * 2.7, attack: 0.001, decay: opts.decay * 0.5 });
    this.noise({ start: opts.start, dur: 0.03, gain: opts.gain * (opts.noise ?? 0.6), decay: 0.006, lp: opts.f * 8 });
  }

  /** Formant-like voice: sawtooth through two bandpass filters. */
  voice(opts: { start?: number; dur: number; gain: number; f0: number; f1?: number; formants: [number, number]; rough?: number; vibrato?: number }): void {
    const { sr, data, rng } = this;
    const s0 = Math.floor((opts.start ?? 0) * sr);
    const n = Math.min(data.length - s0, Math.floor(opts.dur * sr));
    const b1 = new Biquad('bandpass', opts.formants[0], 5, sr);
    const b2 = new Biquad('bandpass', opts.formants[1], 7, sr);
    const f1 = opts.f1 ?? opts.f0;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      let f = opts.f0 * Math.pow(f1 / opts.f0, t);
      if (opts.vibrato) f *= 1 + Math.sin(i / sr * 38) * opts.vibrato;
      if (opts.rough) f *= 1 + (rng.next() - 0.5) * opts.rough;
      ph += f / sr;
      ph -= Math.floor(ph);
      const src = ph * 2 - 1;
      const v = b1.process(src) * 1.4 + b2.process(src) * 0.9;
      const env = Math.min(1, i / (sr * 0.02)) * Math.min(1, (n - i) / (sr * 0.05));
      data[s0 + i]! += v * env * opts.gain;
    }
  }

  /** Reduces bit depth / sample rate (glitch effects). */
  crush(bits: number, hold: number): void {
    const q = Math.pow(2, bits - 1);
    let last = 0;
    for (let i = 0; i < this.data.length; i++) {
      if (i % hold === 0) last = Math.round(this.data[i]! * q) / q;
      this.data[i] = last;
    }
  }

  normalize(peak = 0.9): Float32Array {
    let m = 0;
    for (const v of this.data) m = Math.max(m, Math.abs(v));
    if (m > 0) {
      const k = peak / m;
      for (let i = 0; i < this.data.length; i++) this.data[i]! *= k;
    }
    return this.data;
  }
}

function onePoleCoef(freq: number, sr: number): number {
  return 1 - Math.exp((-2 * Math.PI * freq) / sr);
}

/** RBJ biquad filter. */
export class Biquad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: 'bandpass' | 'lowpass' | 'highpass', freq: number, q: number, sr: number) {
    const w = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    let b0: number, b1: number, b2: number;
    if (type === 'bandpass') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    } else if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// ---------------------------------------------------------------------------
// Material sound groups
// ---------------------------------------------------------------------------
interface Material {
  /** Noise band center/brightness. */
  lp: number;
  hp: number;
  grain?: number;
  body?: number;
  ring?: number[];
  gain: number;
  crush?: boolean;
  bubbly?: boolean;
}

const MATERIALS: Record<string, Material> = {
  stone: { lp: 3200, hp: 300, grain: 3, body: 180, gain: 1 },
  deepslate: { lp: 2200, hp: 200, grain: 4, body: 120, gain: 1 },
  netherrack: { lp: 2600, hp: 250, grain: 5, body: 140, gain: 0.9 },
  bone: { lp: 3500, hp: 600, grain: 2, body: 400, gain: 0.8 },
  wood: { lp: 1800, hp: 120, body: 260, gain: 1 },
  gravel: { lp: 2600, hp: 400, grain: 9, gain: 1 },
  grass: { lp: 5200, hp: 1200, grain: 2, gain: 0.7 },
  plant: { lp: 6000, hp: 1600, grain: 2, gain: 0.55 },
  crop: { lp: 6000, hp: 1600, grain: 2, gain: 0.5 },
  moss: { lp: 2400, hp: 500, grain: 3, gain: 0.6 },
  nylium: { lp: 3000, hp: 500, grain: 4, gain: 0.7 },
  sand: { lp: 3800, hp: 900, grain: 1, gain: 0.6 },
  soul: { lp: 1600, hp: 300, grain: 6, gain: 0.7 },
  snow: { lp: 2200, hp: 400, grain: 7, gain: 0.6 },
  mud: { lp: 900, hp: 80, grain: 5, gain: 0.8 },
  wool: { lp: 700, hp: 60, gain: 0.8 },
  glass: { lp: 4000, hp: 800, grain: 2, ring: [1, 2.76, 5.4], gain: 0.7 },
  metal: { lp: 3000, hp: 400, ring: [1, 2.41, 3.93, 5.2], body: 520, gain: 0.8 },
  liquid: { lp: 1200, hp: 100, bubbly: true, gain: 0.6 },
  glitch: { lp: 5000, hp: 300, grain: 3, crush: true, ring: [1, 1.5], gain: 0.8 },
  none: { lp: 2000, hp: 200, gain: 0.3 },
};

function material(name: string): Material {
  return MATERIALS[name] ?? MATERIALS.stone!;
}

/** Break/place/hit/step for a material. */
function materialSound(kind: 'break' | 'place' | 'hit' | 'step' | 'fall', m: Material): { dur: number; recipe: Recipe } {
  const dur = kind === 'break' ? 0.5 : kind === 'place' ? 0.28 : kind === 'fall' ? 0.35 : 0.18;
  return {
    dur,
    recipe: (s) => {
      const r = s.rng;
      const lp = m.lp * (0.85 + r.next() * 0.3);
      if (kind === 'break') {
        // Several crunchy bursts
        const bursts = 3 + r.int(3);
        for (let i = 0; i < bursts; i++) s.noise({ start: i * 0.045 + r.next() * 0.02, dur: 0.25, gain: m.gain * (1 - i * 0.15), decay: 0.05 + r.next() * 0.03, lp, hp: m.hp, grain: m.grain });
        if (m.body) s.knock({ f: m.body * (0.9 + r.next() * 0.2), gain: m.gain * 0.5, decay: 0.03 });
        if (m.ring) for (let i = 0; i < 5; i++) s.bell({ start: r.next() * 0.2, f: 1800 + r.next() * 2600, ratios: m.ring, gain: 0.25, decay: 0.08, dur: 0.3 });
      } else if (kind === 'place') {
        s.noise({ dur: 0.2, gain: m.gain, decay: 0.035, lp, hp: m.hp, grain: m.grain });
        if (m.body) s.knock({ f: m.body * (0.8 + r.next() * 0.3), gain: m.gain * 0.7, decay: 0.04 });
        if (m.ring) s.bell({ f: 900 + r.next() * 500, ratios: m.ring, gain: 0.2, decay: 0.06, dur: 0.25 });
      } else if (kind === 'hit') {
        s.noise({ dur: 0.12, gain: m.gain * 0.8, decay: 0.02, lp: lp * 0.8, hp: m.hp, grain: m.grain });
        if (m.body) s.knock({ f: m.body * 1.1, gain: m.gain * 0.4, decay: 0.02 });
      } else if (kind === 'fall') {
        s.noise({ dur: 0.3, gain: m.gain, decay: 0.06, lp: lp * 0.5, hp: 40, grain: m.grain });
        s.tone({ dur: 0.25, gain: 0.6, f0: 120, f1: 60, decay: 0.06 });
      } else {
        s.noise({ dur: 0.15, gain: m.gain * 0.7, attack: 0.004, decay: 0.03, lp: lp * 0.75, hp: m.hp, grain: m.grain });
        if (m.body) s.knock({ f: m.body * (0.9 + r.next() * 0.2), gain: m.gain * 0.25, decay: 0.015, noise: 0.2 });
      }
      if (m.bubbly) for (let i = 0; i < 4; i++) s.tone({ start: r.next() * 0.1, dur: 0.08, gain: 0.3, f0: 300 + r.next() * 400, f1: 900 + r.next() * 600, decay: 0.03 });
      if (m.crush) s.crush(5, 3);
    },
  };
}

// ---------------------------------------------------------------------------
// Named effects
// ---------------------------------------------------------------------------
const EFFECTS: Record<string, { dur: number; recipe: Recipe }> = {
  click: { dur: 0.06, recipe: (s) => s.tone({ dur: 0.05, gain: 0.8, f0: 1400, f1: 900, wave: 'square', decay: 0.01, lp: 5000 }) },
  'ui.click': { dur: 0.08, recipe: (s) => (s.tone({ dur: 0.06, gain: 0.7, f0: 900, f1: 600, wave: 'square', decay: 0.012, lp: 3000 }), s.noise({ dur: 0.02, gain: 0.3, decay: 0.004, lp: 6000 })) },
  pop: { dur: 0.12, recipe: (s) => s.tone({ dur: 0.1, gain: 1, f0: 500, f1: 1600, decay: 0.03 }) },
  orb: { dur: 0.35, recipe: (s) => s.bell({ f: 1600, ratios: [1, 2, 3.01], gain: 0.6, decay: 0.1, dur: 0.33 }) },
  levelup: {
    dur: 1.4,
    recipe: (s) => {
      [523, 659, 784, 1047].forEach((f, i) => s.bell({ start: i * 0.1, f, ratios: [1, 2, 3], gain: 0.5, decay: 0.35, dur: 1.2 - i * 0.1 }));
    },
  },
  'hurt.player': {
    dur: 0.3,
    recipe: (s) => {
      s.voice({ dur: 0.22, gain: 0.9, f0: 260, f1: 150, formants: [650, 1100], rough: 0.08 });
      s.noise({ dur: 0.08, gain: 0.25, decay: 0.02, lp: 2000 });
    },
  },
  'hurt.generic': { dur: 0.2, recipe: (s) => s.noise({ dur: 0.18, gain: 0.7, decay: 0.05, lp: 1500, hp: 200 }) },
  eat: {
    dur: 0.35,
    recipe: (s) => {
      for (let i = 0; i < 3; i++) s.noise({ start: i * 0.09, dur: 0.1, gain: 0.8, decay: 0.025, lp: 3000, hp: 500, grain: 4 });
    },
  },
  burp: { dur: 0.45, recipe: (s) => s.voice({ dur: 0.4, gain: 1, f0: 95, f1: 80, formants: [400, 800], rough: 0.3 }) },
  drink: {
    dur: 0.3,
    recipe: (s) => {
      for (let i = 0; i < 3; i++) s.tone({ start: i * 0.08, dur: 0.08, gain: 0.5, f0: 250, f1: 700, decay: 0.03 });
    },
  },
  equip: { dur: 0.3, recipe: (s) => (s.noise({ dur: 0.25, gain: 0.6, decay: 0.05, lp: 3500, hp: 800, grain: 3 }), s.bell({ start: 0.02, f: 700, ratios: [1, 2.4], gain: 0.2, decay: 0.08, dur: 0.25 })) },
  'item.break': {
    dur: 0.5,
    recipe: (s) => {
      s.noise({ dur: 0.2, gain: 0.8, decay: 0.04, lp: 4000, hp: 600, grain: 2 });
      s.bell({ f: 1300, ratios: [1, 2.7], gain: 0.4, decay: 0.12, dur: 0.45 });
    },
  },
  fizz: { dur: 0.6, recipe: (s) => s.noise({ dur: 0.6, gain: 0.8, attack: 0.01, decay: 0.2, lp: 9000, hp: 2500 }) },
  ignite: { dur: 0.5, recipe: (s) => (s.noise({ dur: 0.03, gain: 1, decay: 0.006, lp: 8000 }), s.noise({ start: 0.02, dur: 0.45, gain: 0.5, attack: 0.05, decay: 0.12, lp: 1600, hp: 150 })) },
  teleport: {
    dur: 0.7,
    recipe: (s) => {
      s.tone({ dur: 0.6, gain: 0.5, f0: 200, f1: 1400, wave: 'tri', decay: 0.25, vibrato: 0.05, vibratoRate: 30 });
      s.noise({ dur: 0.5, gain: 0.3, decay: 0.15, bp: [2000, 2] });
    },
  },
  'door.open': { dur: 0.5, recipe: (s) => (s.voice({ dur: 0.3, gain: 0.25, f0: 90, f1: 140, formants: [900, 2400], rough: 0.4 }), s.knock({ start: 0.25, f: 180, gain: 0.8, decay: 0.05 })) },
  'door.close': { dur: 0.35, recipe: (s) => s.knock({ f: 150, gain: 1, decay: 0.06 }) },
  'chest.open': { dur: 0.6, recipe: (s) => (s.voice({ dur: 0.45, gain: 0.3, f0: 70, f1: 120, formants: [700, 1900], rough: 0.5 }), s.knock({ start: 0.4, f: 220, gain: 0.5, decay: 0.04 })) },
  'chest.close': { dur: 0.35, recipe: (s) => s.knock({ f: 170, gain: 1, decay: 0.05 }) },
  'bucket.fill': {
    dur: 0.5,
    recipe: (s) => {
      for (let i = 0; i < 6; i++) s.tone({ start: i * 0.05, dur: 0.1, gain: 0.35, f0: 300 + i * 60, f1: 800 + i * 80, decay: 0.04 });
      s.noise({ dur: 0.4, gain: 0.3, decay: 0.1, lp: 1500 });
    },
  },
  'bucket.empty': {
    dur: 0.5,
    recipe: (s) => {
      for (let i = 0; i < 6; i++) s.tone({ start: i * 0.05, dur: 0.1, gain: 0.35, f0: 900 - i * 80, f1: 400 - i * 40, decay: 0.04 });
      s.noise({ dur: 0.45, gain: 0.35, decay: 0.12, lp: 1400 });
    },
  },
  'axe.strip': { dur: 0.35, recipe: (s) => (s.noise({ dur: 0.3, gain: 0.8, attack: 0.02, decay: 0.08, lp: 2500, hp: 400, grain: 2 }), s.knock({ f: 240, gain: 0.3, decay: 0.03 })) },
  'hoe.till': { dur: 0.3, recipe: (s) => s.noise({ dur: 0.28, gain: 0.8, decay: 0.07, lp: 1800, hp: 200, grain: 5 }) },
  'shovel.flatten': { dur: 0.3, recipe: (s) => s.noise({ dur: 0.28, gain: 0.8, decay: 0.07, lp: 2400, hp: 300, grain: 4 }) },
  note: { dur: 1, recipe: (s) => s.bell({ f: 440, ratios: [1, 2, 3, 4.2], gain: 0.5, decay: 0.3, dur: 1 }) },
  smithing: { dur: 0.6, recipe: (s) => s.bell({ f: 800, ratios: [1, 2.41, 3.93, 5.4], gain: 0.5, decay: 0.15, dur: 0.6 }) },
  'anvil.land': { dur: 0.8, recipe: (s) => (s.bell({ f: 420, ratios: [1, 2.41, 3.93, 5.4, 6.8], gain: 0.6, decay: 0.2, dur: 0.8 }), s.noise({ dur: 0.1, gain: 0.8, decay: 0.02, lp: 3000 })) },
  'fall.small': materialSound('fall', MATERIALS.stone!),
  'fall.big': { dur: 0.5, recipe: (s) => (s.noise({ dur: 0.45, gain: 1, decay: 0.1, lp: 600, hp: 30 }), s.tone({ dur: 0.4, gain: 0.9, f0: 110, f1: 45, decay: 0.1 })) },
  explode: {
    dur: 2.5,
    recipe: (s) => {
      s.noise({ dur: 2.4, gain: 1, attack: 0.005, decay: 0.45, lp: 700, hp: 20 });
      s.noise({ dur: 0.4, gain: 0.8, decay: 0.08, lp: 3000, grain: 6 });
      s.tone({ dur: 1.2, gain: 1, f0: 70, f1: 30, decay: 0.35 });
    },
  },
  thunder: {
    dur: 5,
    recipe: (s) => {
      s.noise({ dur: 0.3, gain: 1, decay: 0.08, lp: 3000, hp: 200 });
      for (let i = 0; i < 6; i++) s.noise({ start: 0.1 + i * 0.5 + s.rng.next() * 0.3, dur: 2.5, gain: 0.8 - i * 0.1, attack: 0.1, decay: 0.6, lp: 380, hp: 20 });
    },
  },
  splash: {
    dur: 0.8,
    recipe: (s) => {
      s.noise({ dur: 0.7, gain: 0.8, attack: 0.01, decay: 0.18, lp: 2500, hp: 200 });
      for (let i = 0; i < 8; i++) s.tone({ start: s.rng.next() * 0.4, dur: 0.07, gain: 0.25, f0: 400 + s.rng.next() * 600, f1: 1200 + s.rng.next() * 800, decay: 0.025 });
    },
  },
  swim: { dur: 0.4, recipe: (s) => s.noise({ dur: 0.35, gain: 0.5, attack: 0.05, decay: 0.1, lp: 1200, hp: 150 }) },
  'bow.shoot': { dur: 0.35, recipe: (s) => (s.tone({ dur: 0.2, gain: 0.6, f0: 180, f1: 90, wave: 'tri', decay: 0.05 }), s.noise({ dur: 0.3, gain: 0.4, attack: 0.02, decay: 0.1, bp: [1800, 1.5] })) },
  'arrow.hit': { dur: 0.2, recipe: (s) => s.knock({ f: 300, gain: 0.8, decay: 0.03 }) },
  'attack.strong': { dur: 0.25, recipe: (s) => (s.noise({ dur: 0.2, gain: 0.8, decay: 0.05, lp: 1800, hp: 100 }), s.tone({ dur: 0.15, gain: 0.5, f0: 160, f1: 80, decay: 0.04 })) },
  'attack.weak': { dur: 0.15, recipe: (s) => s.noise({ dur: 0.12, gain: 0.5, decay: 0.03, lp: 1400, hp: 150 }) },
  'attack.crit': { dur: 0.3, recipe: (s) => (s.noise({ dur: 0.25, gain: 0.8, decay: 0.05, lp: 4000, hp: 600 }), s.bell({ f: 1500, ratios: [1, 1.5], gain: 0.25, decay: 0.07, dur: 0.25 })) },
  'attack.sweep': { dur: 0.35, recipe: (s) => s.noise({ dur: 0.3, gain: 0.8, attack: 0.05, decay: 0.08, bp: [1200, 1] }) },
  'saddle.equip': { dur: 0.4, recipe: (s) => (s.noise({ dur: 0.35, gain: 0.6, attack: 0.02, decay: 0.08, lp: 1500, hp: 150, grain: 3 }), s.bell({ start: 0.15, f: 1600, ratios: [1, 2.3], gain: 0.15, decay: 0.08, dur: 0.2 })) },
  'lead.tie': { dur: 0.35, recipe: (s) => s.noise({ dur: 0.3, gain: 0.6, attack: 0.02, decay: 0.07, bp: [1400, 1.5], grain: 2 }) },
  'lead.break': { dur: 0.3, recipe: (s) => (s.knock({ f: 500, gain: 0.6, decay: 0.02 }), s.noise({ dur: 0.2, gain: 0.4, decay: 0.05, hp: 1500 })) },
  'beacon.power': { dur: 2.5, recipe: (s) => (s.tone({ dur: 2.4, gain: 0.5, f0: 110, f1: 330, wave: 'saw', lp: 1500, attack: 0.4, decay: 1.4, vibrato: 0.02, vibratoRate: 5 }), s.bell({ start: 0.3, f: 660, ratios: [1, 1.5, 2], gain: 0.25, decay: 0.8, dur: 2 })) },
  'bell.ring': { dur: 3, recipe: (s) => s.bell({ f: 880, ratios: [1, 2.0, 2.76, 5.4, 8.9], gain: 0.8, decay: 1.2, dur: 2.9 }) },
  'respawn_anchor.charge': { dur: 0.8, recipe: (s) => (s.tone({ dur: 0.7, gain: 0.5, f0: 160, f1: 420, wave: 'saw', lp: 1200, decay: 0.3 }), s.noise({ dur: 0.5, gain: 0.3, decay: 0.15, bp: [900, 2] })) },
  'respawn_anchor.set': { dur: 1.5, recipe: (s) => (s.tone({ dur: 1.4, gain: 0.5, f0: 110, f1: 70, wave: 'saw', lp: 700, attack: 0.2, decay: 0.8, vibrato: 0.04, vibratoRate: 4 }), s.bell({ f: 330, ratios: [1, 1.5], gain: 0.3, decay: 0.6, dur: 1.2 })) },
  'spyglass.use': { dur: 0.35, recipe: (s) => (s.tone({ dur: 0.3, gain: 0.3, f0: 1800, f1: 2600, wave: 'tri', decay: 0.1 }), s.knock({ f: 700, gain: 0.3, decay: 0.02 })) },
  'lodestone.lock': { dur: 1, recipe: (s) => (s.bell({ f: 520, ratios: [1, 2.02, 3.1], gain: 0.4, decay: 0.4, dur: 0.9 }), s.tone({ dur: 0.8, gain: 0.25, f0: 90, wave: 'tri', decay: 0.5 })) },
  'fishing.cast': { dur: 0.5, recipe: (s) => (s.noise({ dur: 0.45, gain: 0.5, attack: 0.05, decay: 0.12, bp: [1600, 1.2] }), s.tone({ dur: 0.35, gain: 0.25, f0: 900, f1: 400, wave: 'tri', decay: 0.1 })) },
  'fishing.reel': { dur: 0.45, recipe: (s) => { for (let i = 0; i < 8; i++) s.knock({ start: i * 0.045, f: 900 + i * 40, gain: 0.3, decay: 0.01, noise: 0.3 }); } },
  'shulker.open': { dur: 0.5, recipe: (s) => (s.tone({ dur: 0.45, gain: 0.35, f0: 180, f1: 320, wave: 'tri', decay: 0.15 }), s.noise({ dur: 0.3, gain: 0.25, decay: 0.08, bp: [700, 2] })) },
  'shulker.close': { dur: 0.45, recipe: (s) => (s.tone({ dur: 0.4, gain: 0.35, f0: 320, f1: 160, wave: 'tri', decay: 0.12 }), s.knock({ start: 0.3, f: 240, gain: 0.4, decay: 0.03 })) },
  ink: { dur: 0.35, recipe: (s) => s.noise({ dur: 0.3, gain: 0.5, attack: 0.02, decay: 0.08, lp: 900, hp: 80, grain: 2 }) },
  glow_ink: { dur: 0.6, recipe: (s) => (s.noise({ dur: 0.3, gain: 0.45, attack: 0.02, decay: 0.08, lp: 900, hp: 80, grain: 2 }), s.bell({ start: 0.08, f: 1760, ratios: [1, 1.5, 2.01], gain: 0.2, decay: 0.2, dur: 0.5 })) },
  'fire.extinguish': { dur: 0.5, recipe: (s) => s.noise({ dur: 0.45, gain: 0.5, attack: 0.01, decay: 0.15, hp: 2500 }) },
  'shield.block': { dur: 0.3, recipe: (s) => s.knock({ f: 210, gain: 1, decay: 0.05 }) },
  'shield.break': { dur: 0.5, recipe: (s) => (s.knock({ f: 160, gain: 1, decay: 0.07 }), s.noise({ start: 0.02, dur: 0.4, gain: 0.6, decay: 0.1, lp: 3000, hp: 300, grain: 3 })) },
  'trident.throw': { dur: 0.5, recipe: (s) => (s.noise({ dur: 0.45, gain: 0.7, attack: 0.03, decay: 0.12, bp: [900, 1.2] }), s.tone({ dur: 0.3, gain: 0.3, f0: 600, f1: 300, wave: 'tri', decay: 0.1 })) },
  'trident.hit': { dur: 0.35, recipe: (s) => (s.knock({ f: 260, gain: 0.9, decay: 0.04 }), s.bell({ f: 1400, ratios: [1, 2.3], gain: 0.2, decay: 0.08, dur: 0.3 })) },
  'trident.hit_ground': { dur: 0.3, recipe: (s) => s.knock({ f: 320, gain: 0.8, decay: 0.03 }) },
  'trident.return': { dur: 0.8, recipe: (s) => (s.tone({ dur: 0.7, gain: 0.4, f0: 300, f1: 900, wave: 'tri', decay: 0.3, vibrato: 0.03, vibratoRate: 12 }), s.noise({ dur: 0.6, gain: 0.25, attack: 0.1, decay: 0.2, bp: [2400, 3] })) },
  'portal.ambient': { dur: 3, recipe: (s) => (s.tone({ dur: 3, gain: 0.3, f0: 90, f1: 110, wave: 'saw', vibrato: 0.04, vibratoRate: 3, lp: 600, decay: 3 }), s.noise({ dur: 3, gain: 0.2, attack: 0.5, decay: 2, bp: [700, 3] })) },
  'portal.travel': {
    dur: 3.5,
    recipe: (s) => {
      s.tone({ dur: 3.4, gain: 0.5, f0: 80, f1: 600, wave: 'saw', vibrato: 0.08, vibratoRate: 5, lp: 1500, attack: 1.5, decay: 3 });
      s.noise({ dur: 3.4, gain: 0.3, attack: 1.4, decay: 2, bp: [1200, 2] });
    },
  },
  'portal.trigger': { dur: 2, recipe: (s) => s.tone({ dur: 2, gain: 0.4, f0: 60, f1: 200, wave: 'saw', vibrato: 0.05, vibratoRate: 4, lp: 800, attack: 0.8, decay: 1.5 }) },
  'glitch.zap': {
    dur: 0.4,
    recipe: (s) => {
      for (let i = 0; i < 5; i++) s.tone({ start: i * 0.06, dur: 0.06, gain: 0.5, f0: 200 + s.rng.next() * 2000, wave: 'square', decay: 0.05 });
      s.crush(3, 6);
    },
  },
  'ender_eye.launch': { dur: 0.6, recipe: (s) => s.tone({ dur: 0.55, gain: 0.5, f0: 300, f1: 1200, wave: 'tri', decay: 0.2, vibrato: 0.05, vibratoRate: 20 }) },
  'end_portal.open': {
    dur: 4,
    recipe: (s) => {
      [220, 277, 330, 440, 554].forEach((f, i) => s.bell({ start: i * 0.25, f, ratios: [1, 2, 3], gain: 0.4, decay: 1.2, dur: 3.5 - i * 0.25 }));
      s.noise({ dur: 3.5, gain: 0.2, attack: 0.5, decay: 1.5, lp: 500 });
    },
  },
  'dragon.growl': { dur: 2, recipe: (s) => (s.voice({ dur: 1.9, gain: 1, f0: 70, f1: 55, formants: [380, 900], rough: 0.5, vibrato: 0.05 }), s.noise({ dur: 1.8, gain: 0.3, attack: 0.2, decay: 0.8, lp: 600 })) },
  'dragon.wings': { dur: 0.6, recipe: (s) => s.noise({ dur: 0.55, gain: 0.8, attack: 0.1, decay: 0.15, lp: 400, hp: 30 }) },
  'dragon.death': {
    dur: 6,
    recipe: (s) => {
      s.voice({ dur: 5.8, gain: 0.9, f0: 120, f1: 40, formants: [420, 1100], rough: 0.3, vibrato: 0.1 });
      s.noise({ dur: 5.5, gain: 0.4, attack: 1, decay: 3, lp: 900 });
    },
  },
  toast: {
    dur: 1.2,
    recipe: (s) => {
      [784, 988, 1175].forEach((f, i) => s.bell({ start: i * 0.08, f, ratios: [1, 2], gain: 0.35, decay: 0.4, dur: 1 }));
    },
  },
  'challenge.complete': {
    dur: 2.4,
    recipe: (s) => {
      [523, 659, 784, 1047, 1319].forEach((f, i) => s.bell({ start: i * 0.12, f, ratios: [1, 2, 3], gain: 0.4, decay: 0.6, dur: 2 }));
    },
  },
  'totem.use': {
    dur: 2,
    recipe: (s) => {
      for (let i = 0; i < 10; i++) s.bell({ start: i * 0.08, f: 800 + i * 120, ratios: [1, 2.01], gain: 0.25, decay: 0.3, dur: 1 });
    },
  },
  'cave.ambient': {
    dur: 6,
    recipe: (s) => {
      const r = s.rng;
      const mood = r.int(3);
      if (mood === 0) s.tone({ dur: 5.5, gain: 0.5, f0: 110 + r.next() * 60, f1: 70 + r.next() * 40, wave: 'tri', attack: 1.5, decay: 2.5, vibrato: 0.02, vibratoRate: 1.5 });
      else if (mood === 1) {
        s.noise({ dur: 5.5, gain: 0.5, attack: 2, decay: 2, bp: [300 + r.next() * 400, 8] });
        s.tone({ start: 1, dur: 4, gain: 0.3, f0: 440 + r.next() * 300, f1: 300, attack: 1, decay: 1.2, vibrato: 0.01 });
      } else {
        for (let i = 0; i < 4; i++) s.bell({ start: i * 0.9 + r.next() * 0.5, f: 200 + r.next() * 500, ratios: [1, 2.3], gain: 0.3, decay: 0.8, dur: 2.5 });
      }
    },
  },
  'farlands.ambient': {
    dur: 5,
    recipe: (s) => {
      const r = s.rng;
      s.tone({ dur: 4.8, gain: 0.4, f0: 55 + r.next() * 30, wave: 'square', attack: 1.5, decay: 2.5, lp: 400, vibrato: 0.03, vibratoRate: 0.7 });
      for (let i = 0; i < 6; i++) s.tone({ start: r.next() * 4, dur: 0.1, gain: 0.25, f0: 800 + r.next() * 3000, wave: 'square', decay: 0.05 });
      s.crush(4, 5);
    },
  },
  'nether.ambient': {
    dur: 6,
    recipe: (s) => {
      s.noise({ dur: 5.8, gain: 0.6, attack: 1.5, decay: 3, lp: 250, hp: 20 });
      s.tone({ dur: 5.5, gain: 0.3, f0: 49, f1: 44, wave: 'saw', attack: 1.5, decay: 3, lp: 300 });
    },
  },
  'lava.pop': { dur: 0.15, recipe: (s) => s.tone({ dur: 0.12, gain: 0.8, f0: 200, f1: 700, decay: 0.03 }) },
  'fire.crackle': { dur: 0.6, recipe: (s) => (s.noise({ dur: 0.55, gain: 0.3, attack: 0.1, decay: 0.2, lp: 1200, hp: 200 }), s.noise({ start: 0.1 + s.rng.next() * 0.3, dur: 0.02, gain: 0.6, decay: 0.004, lp: 6000 })) },
  'block.chime': { dur: 1.5, recipe: (s) => s.bell({ f: 1200 + s.rng.next() * 800, ratios: [1, 2.76, 5.4], gain: 0.3, decay: 0.5, dur: 1.4 }) },
  'firework.launch': { dur: 0.8, recipe: (s) => s.noise({ dur: 0.75, gain: 0.7, attack: 0.02, decay: 0.3, hp: 1500, lp: 8000 }) },
  'firework.blast': { dur: 1.5, recipe: (s) => (s.noise({ dur: 1.4, gain: 1, decay: 0.3, lp: 1200 }), s.noise({ start: 0.3, dur: 1, gain: 0.3, decay: 0.3, hp: 3000, grain: 2 })) },
};

/** Parameters for generic creature voices, keyed by mob type. */
const VOICES: Record<string, { f: number; formants: [number, number]; rough: number; dur: number; gain?: number; crush?: boolean; bell?: boolean }> = {
  zombie: { f: 95, formants: [450, 900], rough: 0.25, dur: 0.9 },
  husk: { f: 80, formants: [400, 800], rough: 0.35, dur: 1 },
  drowned: { f: 90, formants: [350, 700], rough: 0.3, dur: 0.9 },
  skeleton: { f: 400, formants: [1800, 3200], rough: 0.6, dur: 0.35 },
  spider: { f: 180, formants: [1500, 3000], rough: 0.9, dur: 0.5 },
  creeper: { f: 60, formants: [2000, 4000], rough: 1, dur: 0.6 },
  enderman: { f: 140, formants: [700, 1600], rough: 0.2, dur: 1, gain: 0.8 },
  cow: { f: 120, formants: [600, 1100], rough: 0.08, dur: 1.1 },
  pig: { f: 220, formants: [900, 1800], rough: 0.4, dur: 0.45 },
  sheep: { f: 330, formants: [800, 1600], rough: 0.25, dur: 0.8 },
  chicken: { f: 700, formants: [1500, 2800], rough: 0.2, dur: 0.25 },
  wolf: { f: 380, formants: [800, 1500], rough: 0.1, dur: 0.4 },
  villager: { f: 170, formants: [500, 1400], rough: 0.05, dur: 0.5 },
  slime: { f: 90, formants: [300, 600], rough: 0.05, dur: 0.3 },
  blaze: { f: 150, formants: [900, 2200], rough: 0.5, dur: 0.8 },
  ghast: { f: 520, formants: [900, 1800], rough: 0.08, dur: 1.4 },
  piglin: { f: 180, formants: [700, 1400], rough: 0.35, dur: 0.6 },
  hoglin: { f: 110, formants: [500, 1000], rough: 0.5, dur: 0.7 },
  cave_stalker: { f: 70, formants: [300, 1200], rough: 0.7, dur: 1.2 },
  sky_ray: { f: 600, formants: [1200, 2500], rough: 0.05, dur: 1, bell: true },
  ember_beast: { f: 85, formants: [500, 900], rough: 0.6, dur: 1 },
  rift_walker: { f: 200, formants: [800, 2000], rough: 0.3, dur: 0.9, crush: true },
  glitch_beast: { f: 130, formants: [1000, 3000], rough: 0.8, dur: 0.8, crush: true },
  farlands_wanderer: { f: 110, formants: [600, 1500], rough: 0.15, dur: 1.2, crush: true },
  ender_dragon: { f: 70, formants: [380, 900], rough: 0.5, dur: 1.8, gain: 1 },
  player: { f: 240, formants: [650, 1100], rough: 0.08, dur: 0.2 },
};

function mobSound(type: string, kind: string): { dur: number; recipe: Recipe } {
  const v = VOICES[type] ?? { f: 150, formants: [600, 1300] as [number, number], rough: 0.3, dur: 0.6 };
  const hurt = kind === 'hurt';
  const death = kind === 'death';
  const dur = hurt ? Math.min(0.35, v.dur * 0.5) : death ? v.dur * 1.4 : v.dur;
  return {
    dur: dur + 0.1,
    recipe: (s) => {
      const r = s.rng;
      const f = v.f * (0.9 + r.next() * 0.2) * (hurt ? 1.3 : 1);
      const f1 = death ? f * 0.5 : hurt ? f * 0.8 : f * (0.85 + r.next() * 0.3);
      if (v.bell) s.bell({ f: f * 2, ratios: [1, 1.5, 2.01], gain: 0.5, decay: dur * 0.4, dur });
      else s.voice({ dur, gain: v.gain ?? 0.9, f0: f, f1, formants: v.formants, rough: v.rough, vibrato: death ? 0.04 : 0 });
      if (hurt) s.noise({ dur: 0.08, gain: 0.3, decay: 0.02, lp: 2500 });
      if (v.crush) s.crush(4, 4);
    },
  };
}

/** Resolves a sound name to a recipe. */
export function recipeFor(name: string): { dur: number; recipe: Recipe } | null {
  const fx = EFFECTS[name];
  if (fx) return fx;
  const dot = name.indexOf('.');
  if (dot > 0) {
    const kind = name.slice(0, dot);
    const rest = name.slice(dot + 1);
    if (kind === 'break' || kind === 'place' || kind === 'hit' || kind === 'step' || kind === 'fall') {
      if (rest === 'none') return null;
      return materialSound(kind, material(rest));
    }
    if (kind === 'mob') {
      const d2 = rest.lastIndexOf('.');
      return mobSound(rest.slice(0, d2), rest.slice(d2 + 1));
    }
    if (kind === 'hurt') return mobSound(rest, 'hurt');
  }
  return null;
}
