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

  /**
   * V6: a sustained tone for ambient beds: constant level (no decay) with a
   * slow swell, and an optional second voice detuned by `beat` Hz.
   */
  drone(opts: { f: number; gain: number; wave?: 'sine' | 'tri' | 'saw'; beat?: number; swell?: number; lp?: number }): void {
    const { sr, data } = this;
    const lp = opts.lp ? onePoleCoef(opts.lp, sr) : 1;
    const swell = opts.swell ?? 0;
    const fs = [opts.f, ...(opts.beat ? [opts.f + opts.beat] : [])];
    for (const f of fs) {
      let ph = this.rng.next();
      let l = 0;
      for (let i = 0; i < data.length; i++) {
        ph += f / sr;
        ph -= Math.floor(ph);
        const w = opts.wave ?? 'sine';
        const v = w === 'tri' ? 1 - Math.abs(ph * 4 - 2) : w === 'saw' ? ph * 2 - 1 : Math.sin(ph * Math.PI * 2);
        l += (v - l) * lp;
        // The swell completes whole cycles over the buffer so the loop stays smooth
        const env = swell ? 1 - swell * 0.5 * (1 - Math.cos((i / data.length) * Math.PI * 4)) : 1;
        data[i]! += l * env * (opts.gain / fs.length);
      }
    }
  }

  /** V6: sustained filtered noise for ambient beds (wind, hiss, rumble), with a slow swell. */
  wash(opts: { gain: number; lp?: number; hp?: number; bp?: [number, number]; swell?: number }): void {
    const { sr, data, rng } = this;
    const lp = opts.lp ? onePoleCoef(opts.lp, sr) : 1;
    const hp = opts.hp ? onePoleCoef(opts.hp, sr) : 0;
    const bp = opts.bp ? new Biquad('bandpass', opts.bp[0], opts.bp[1], sr) : null;
    const swell = opts.swell ?? 0;
    let l = 0;
    let h = 0;
    for (let i = 0; i < data.length; i++) {
      l += (rng.next() * 2 - 1 - l) * lp;
      h += (l - h) * hp;
      let out = l - (hp ? h : 0);
      if (bp) out = bp.process(out);
      const env = 1 - swell * 0.5 * (1 - Math.cos((i / data.length) * Math.PI * 6));
      data[i]! += out * env * opts.gain;
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
  // V5 engineering
  'machine.done': { dur: 0.3, recipe: (s) => (s.tone({ dur: 0.12, gain: 0.35, f0: 880, f1: 880, wave: 'sine', decay: 0.08 }), s.tone({ start: 0.1, dur: 0.18, gain: 0.3, f0: 1320, f1: 1320, wave: 'sine', decay: 0.12 })) },
  'machine.switch': { dur: 0.15, recipe: (s) => (s.knock({ f: 900, gain: 0.6, decay: 0.02 }), s.tone({ dur: 0.08, gain: 0.25, f0: 500, f1: 300, wave: 'square', decay: 0.03, lp: 2000 })) },
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
  'llama.spit': { dur: 0.3, recipe: (s) => (s.noise({ dur: 0.25, gain: 0.7, attack: 0.01, decay: 0.06, bp: [1800, 1.2] }), s.knock({ f: 400, gain: 0.3, decay: 0.02 })) },
  'frog.eat': { dur: 0.35, recipe: (s) => (s.tone({ dur: 0.12, gain: 0.5, f0: 900, f1: 200, wave: 'tri', decay: 0.04 }), s.knock({ start: 0.12, f: 150, gain: 0.6, decay: 0.05 })) },
  'pufferfish.blow_up': { dur: 0.4, recipe: (s) => s.tone({ dur: 0.35, gain: 0.5, f0: 200, f1: 600, wave: 'sine', decay: 0.15, vibrato: 0.05, vibratoRate: 12 }) },
  'pufferfish.blow_out': { dur: 0.4, recipe: (s) => s.tone({ dur: 0.35, gain: 0.4, f0: 600, f1: 180, wave: 'sine', decay: 0.15 }) },
  'pufferfish.sting': { dur: 0.25, recipe: (s) => (s.knock({ f: 900, gain: 0.5, decay: 0.02 }), s.noise({ dur: 0.15, gain: 0.3, decay: 0.04, hp: 2500 })) },
  'panda.sneeze': { dur: 0.5, recipe: (s) => (s.noise({ dur: 0.15, gain: 0.3, attack: 0.1, decay: 0.05, bp: [900, 2] }), s.noise({ start: 0.2, dur: 0.25, gain: 0.8, attack: 0.005, decay: 0.07, lp: 3000, hp: 300 })) },
  'dripleaf.tilt': { dur: 0.35, recipe: (s) => (s.noise({ dur: 0.3, gain: 0.5, attack: 0.02, decay: 0.08, bp: [700, 1.5], grain: 2 }), s.knock({ start: 0.05, f: 180, gain: 0.3, decay: 0.04 })) },
  'sculk.click': { dur: 0.35, recipe: (s) => { for (let i = 0; i < 4; i++) s.knock({ start: i * 0.06, f: 1400 + i * 120, gain: 0.35, decay: 0.012, noise: 0.4 }); s.tone({ dur: 0.3, gain: 0.15, f0: 220, f1: 330, wave: 'sine', decay: 0.2 }); } },
  'shrieker.shriek': { dur: 2.2, recipe: (s) => (s.voice({ dur: 2.1, gain: 0.8, f0: 520, f1: 780, formants: [1200, 2600], rough: 0.35, vibrato: 0.08 }), s.tone({ start: 0.1, dur: 1.9, gain: 0.3, f0: 1040, f1: 1560, wave: 'saw', lp: 3000, attack: 0.2, decay: 1.2, vibrato: 0.06, vibratoRate: 9 })) },
  'catalyst.bloom': { dur: 1.2, recipe: (s) => (s.tone({ dur: 1.1, gain: 0.35, f0: 180, f1: 90, wave: 'sine', attack: 0.3, decay: 0.7 }), s.noise({ dur: 0.9, gain: 0.25, attack: 0.3, decay: 0.4, lp: 900 })) },
  'warden.heartbeat': { dur: 0.6, recipe: (s) => (s.tone({ dur: 0.18, gain: 0.9, f0: 60, f1: 40, wave: 'sine', decay: 0.1 }), s.tone({ start: 0.22, dur: 0.2, gain: 0.7, f0: 55, f1: 35, wave: 'sine', decay: 0.12 })) },
  'warden.roar': { dur: 2.6, recipe: (s) => (s.voice({ dur: 2.5, gain: 1, f0: 80, f1: 50, formants: [320, 820], rough: 0.8, vibrato: 0.06 }), s.noise({ dur: 2.4, gain: 0.5, attack: 0.1, decay: 1.4, lp: 700 }), s.crush(5, 3)) },
  'warden.sniff': { dur: 0.9, recipe: (s) => { for (let i = 0; i < 3; i++) s.noise({ start: i * 0.25, dur: 0.18, gain: 0.5, attack: 0.03, decay: 0.08, bp: [900, 2] }); } },
  'warden.listen': { dur: 0.5, recipe: (s) => { for (let i = 0; i < 6; i++) s.knock({ start: i * 0.05, f: 900 + (i % 2) * 300, gain: 0.3, decay: 0.01, noise: 0.5 }); } },
  'warden.emerge': { dur: 4, recipe: (s) => (s.noise({ dur: 3.8, gain: 0.8, attack: 0.5, decay: 2.5, lp: 300 }), s.tone({ dur: 3.6, gain: 0.5, f0: 40, f1: 70, wave: 'saw', lp: 200, attack: 0.8, decay: 2 })) },
  'warden.dig': { dur: 3, recipe: (s) => (s.noise({ dur: 2.8, gain: 0.7, attack: 0.3, decay: 2, lp: 350 }), s.tone({ dur: 2.6, gain: 0.4, f0: 70, f1: 35, wave: 'saw', lp: 200, attack: 0.3, decay: 1.8 })) },
  'warden.sonic_charge': { dur: 1.8, recipe: (s) => (s.tone({ dur: 1.7, gain: 0.6, f0: 90, f1: 700, wave: 'saw', lp: 2200, attack: 0.3, decay: 0.3, vibrato: 0.05, vibratoRate: 14 }), s.noise({ dur: 1.6, gain: 0.3, attack: 1, decay: 0.3, bp: [1500, 1] })) },
  'warden.sonic_boom': { dur: 1.2, recipe: (s) => (s.noise({ dur: 1.1, gain: 1, attack: 0.005, decay: 0.4, lp: 1600 }), s.tone({ dur: 1, gain: 0.9, f0: 160, f1: 40, wave: 'saw', lp: 800, decay: 0.5 }), s.crush(4, 2)) },
  'warden.attack': { dur: 0.5, recipe: (s) => (s.knock({ f: 90, gain: 1, decay: 0.08 }), s.noise({ dur: 0.35, gain: 0.7, decay: 0.1, lp: 1200 })) },
  'warden.warning1': { dur: 2, recipe: (s) => s.tone({ dur: 1.9, gain: 0.3, f0: 50, f1: 45, wave: 'sine', attack: 0.5, decay: 1.2 }) },
  'warden.warning2': { dur: 2.5, recipe: (s) => (s.tone({ dur: 2.4, gain: 0.45, f0: 48, f1: 40, wave: 'sine', attack: 0.4, decay: 1.4 }), s.noise({ dur: 2, gain: 0.2, attack: 0.6, decay: 1, lp: 250 })) },
  'warden.warning3': { dur: 3, recipe: (s) => (s.voice({ dur: 2.8, gain: 0.5, f0: 55, f1: 45, formants: [300, 700], rough: 0.7 }), s.noise({ dur: 2.6, gain: 0.35, attack: 0.5, decay: 1.4, lp: 300 })) },
  'sporeling.puff': { dur: 0.6, recipe: (s) => s.noise({ dur: 0.55, gain: 0.6, attack: 0.02, decay: 0.2, bp: [700, 0.8] }) },
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
  // V3: the hidden endgame
  'enderman.voidbound': {
    dur: 2.6,
    recipe: (s) => {
      s.noise({ dur: 2.3, gain: 0.55, attack: 1.2, decay: 0.8, bp: [520, 1.5] });
      s.tone({ start: 0.2, dur: 2.2, gain: 0.35, f0: 55, f1: 220, wave: 'saw', lp: 900, attack: 1.2, decay: 0.8 });
      s.voice({ start: 0.95, dur: 1.5, gain: 0.8, f0: 190, f1: 85, formants: [620, 1450], rough: 0.7, vibrato: 0.12 });
      s.crush(5, 3);
    },
  },
  'voidbound.strike': { dur: 0.5, recipe: (s) => (s.knock({ f: 130, gain: 0.9, decay: 0.05 }), s.tone({ dur: 0.35, gain: 0.4, f0: 1500, f1: 180, wave: 'square', decay: 0.1 }), s.crush(4, 4)) },
  /** Harsh digital static (WORLD INTEGRITY FAILURE, glitch hits). */
  'glitch.static': {
    dur: 1.3,
    recipe: (s) => {
      s.noise({ dur: 1.25, gain: 0.8, attack: 0.005, decay: 0.5, hp: 400 });
      for (let i = 0; i < 7; i++) s.tone({ start: s.rng.next() * 1.1, dur: 0.05 + s.rng.next() * 0.08, gain: 0.4, f0: 200 + s.rng.next() * 3000, wave: 'square', decay: 0.03 });
      s.crush(3, 8);
    },
  },
  /** The warning before one of The Error's big attacks. */
  'glitch.warn': {
    dur: 1,
    recipe: (s) => {
      for (let i = 0; i < 3; i++) s.tone({ start: i * 0.28, dur: 0.18, gain: 0.45, f0: 740, f1: 700, wave: 'square', lp: 2500, decay: 0.08 });
      s.crush(5, 2);
    },
  },
  /** A low, uneasy hum around a glitched portal. */
  'glitch.hum': {
    dur: 3.2,
    recipe: (s) => {
      s.tone({ dur: 3.1, gain: 0.35, f0: 47, f1: 51, wave: 'saw', lp: 260, attack: 0.8, decay: 1.6, vibrato: 0.03, vibratoRate: 2 });
      for (let i = 0; i < 5; i++) s.knock({ start: 0.3 + s.rng.next() * 2.6, f: 1800 + s.rng.next() * 1800, gain: 0.12, decay: 0.008, noise: 0.6 });
      s.crush(6, 2);
    },
  },
  'glitch.portal_on': {
    dur: 3.2,
    recipe: (s) => {
      [110, 165, 220, 330].forEach((f, i) => s.tone({ start: i * 0.25, dur: 2.8 - i * 0.25, gain: 0.3, f0: f, f1: f * 1.02, wave: 'saw', lp: 1400, attack: 0.4, decay: 1.4, vibrato: 0.04, vibratoRate: 7 }));
      s.noise({ dur: 3, gain: 0.35, attack: 1.2, decay: 1.4, bp: [1800, 1] });
      s.crush(4, 3);
    },
  },
  'farlands.entry': {
    dur: 3,
    recipe: (s) => {
      s.noise({ dur: 2.9, gain: 0.6, attack: 1.6, decay: 1, hp: 300 });
      s.tone({ dur: 2.8, gain: 0.4, f0: 40, f1: 400, wave: 'square', lp: 1200, attack: 1.4, decay: 1 });
      s.crush(3, 6);
    },
  },
  // The Error
  'error.roar': {
    dur: 2.6,
    recipe: (s) => {
      s.voice({ dur: 2.4, gain: 1, f0: 70, f1: 40, formants: [300, 900], rough: 0.9, vibrato: 0.1 });
      s.noise({ dur: 2.3, gain: 0.5, attack: 0.1, decay: 1.2, lp: 900 });
      s.crush(3, 6);
    },
  },
  'error.charge': { dur: 1.7, recipe: (s) => (s.tone({ dur: 1.6, gain: 0.55, f0: 70, f1: 900, wave: 'square', lp: 2400, attack: 0.4, decay: 0.2, vibrato: 0.08, vibratoRate: 16 }), s.noise({ dur: 1.5, gain: 0.3, attack: 1, decay: 0.3, bp: [1600, 1] }), s.crush(4, 3)) },
  'error.laser': {
    dur: 1.6,
    recipe: (s) => {
      s.tone({ dur: 1.5, gain: 0.8, f0: 90, f1: 60, wave: 'saw', lp: 1800, attack: 0.02, decay: 0.6 });
      s.tone({ dur: 1.5, gain: 0.4, f0: 181, f1: 121, wave: 'square', lp: 2200, attack: 0.02, decay: 0.6 });
      s.noise({ dur: 1.5, gain: 0.6, attack: 0.01, decay: 0.7, lp: 3000 });
      s.crush(3, 5);
    },
  },
  'error.teleport': { dur: 0.8, recipe: (s) => (s.tone({ dur: 0.35, gain: 0.5, f0: 200, f1: 2400, wave: 'square', decay: 0.1 }), s.noise({ start: 0.25, dur: 0.5, gain: 0.5, decay: 0.2, hp: 800 }), s.crush(3, 6)) },
  'error.pulse': { dur: 1.4, recipe: (s) => (s.knock({ f: 55, gain: 1, decay: 0.35 }), s.noise({ dur: 1.3, gain: 0.6, attack: 0.01, decay: 0.8, lp: 600 }), s.tone({ dur: 1.2, gain: 0.4, f0: 120, f1: 30, wave: 'saw', lp: 500, decay: 0.6 }), s.crush(5, 2)) },
  'error.meteor': { dur: 1.1, recipe: (s) => (s.tone({ dur: 0.7, gain: 0.35, f0: 1800, f1: 300, wave: 'sine', decay: 0.4 }), s.knock({ start: 0.7, f: 70, gain: 1, decay: 0.2 }), s.noise({ start: 0.7, dur: 0.4, gain: 0.6, decay: 0.15, lp: 1500 }), s.crush(4, 3)) },
  'error.zone': { dur: 1.2, recipe: (s) => (s.noise({ dur: 1.1, gain: 0.4, attack: 0.3, decay: 0.5, bp: [900, 3] }), s.tone({ dur: 1, gain: 0.3, f0: 330, f1: 310, wave: 'square', lp: 1400, attack: 0.2, decay: 0.5 }), s.crush(5, 3)) },
  'error.phase': {
    dur: 3,
    recipe: (s) => {
      s.voice({ dur: 2.2, gain: 0.9, f0: 60, f1: 120, formants: [350, 1100], rough: 0.9, vibrato: 0.2 });
      s.noise({ dur: 2.8, gain: 0.5, attack: 0.05, decay: 1.5, hp: 200 });
      s.crush(3, 8);
    },
  },
  'error.death': {
    dur: 6,
    recipe: (s) => {
      s.voice({ dur: 3, gain: 1, f0: 140, f1: 30, formants: [420, 1200], rough: 1, vibrato: 0.25 });
      s.noise({ dur: 5.8, gain: 0.7, attack: 0.3, decay: 3, lp: 1800 });
      for (let i = 0; i < 12; i++) s.tone({ start: 2 + s.rng.next() * 3.5, dur: 0.1, gain: 0.4, f0: 100 + s.rng.next() * 2500, wave: 'square', decay: 0.05 });
      s.crush(3, 10);
    },
  },
  // Cave biome ambience: one-shots scattered around the listener
  'cave.drip': { dur: 0.7, recipe: (s) => (s.tone({ dur: 0.09, gain: 0.5, f0: 1400 + s.rng.next() * 900, f1: 2600, wave: 'sine', decay: 0.03 }), s.bell({ start: 0.08, f: 900 + s.rng.next() * 500, ratios: [1, 2.4], gain: 0.12, decay: 0.25, dur: 0.6 })) },
  'cave.rumble': { dur: 3.5, recipe: (s) => (s.noise({ dur: 3.3, gain: 0.55, attack: 0.8, decay: 2, lp: 160, hp: 20 }), s.knock({ start: 0.4 + s.rng.next(), f: 70, gain: 0.4, decay: 0.2 })) },
  'lush.chirp': {
    dur: 0.9,
    recipe: (s) => {
      const f = 2400 + s.rng.next() * 1400;
      const n = 2 + s.rng.int(3);
      for (let i = 0; i < n; i++) s.tone({ start: i * 0.13, dur: 0.08, gain: 0.25, f0: f, f1: f * 1.25, wave: 'sine', decay: 0.04 });
    },
  },
  'mushroom.pop': { dur: 0.5, recipe: (s) => (s.tone({ dur: 0.08, gain: 0.45, f0: 380, f1: 820, wave: 'sine', decay: 0.03 }), s.noise({ start: 0.05, dur: 0.4, gain: 0.18, attack: 0.02, decay: 0.2, bp: [600, 1] })) },
  'crystal.chime': {
    dur: 2.4,
    recipe: (s) => {
      const base = [880, 988, 1175, 1319, 1568][s.rng.int(5)]!;
      s.bell({ f: base, ratios: [1, 2.76, 5.4], gain: 0.25, decay: 0.9, dur: 2.2 });
      s.bell({ start: 0.35, f: base * 1.5, ratios: [1, 2.76], gain: 0.12, decay: 0.7, dur: 1.8 });
    },
  },
  'frozen.wind': { dur: 4, recipe: (s) => s.noise({ dur: 3.8, gain: 0.35, attack: 1.4, decay: 2, bp: [700 + s.rng.next() * 900, 6] }) },
  'deep_dark.hum': { dur: 5, recipe: (s) => (s.tone({ dur: 4.8, gain: 0.35, f0: 41, f1: 38, wave: 'sine', attack: 1.6, decay: 2.8 }), s.noise({ dur: 4.6, gain: 0.15, attack: 1.8, decay: 2.2, lp: 220 }), s.knock({ start: 1.5 + s.rng.next() * 2, f: 1300, gain: 0.08, decay: 0.01, noise: 0.5 })) },
  'lava.pop': { dur: 0.15, recipe: (s) => s.tone({ dur: 0.12, gain: 0.8, f0: 200, f1: 700, decay: 0.03 }) },
  'fire.crackle': { dur: 0.6, recipe: (s) => (s.noise({ dur: 0.55, gain: 0.3, attack: 0.1, decay: 0.2, lp: 1200, hp: 200 }), s.noise({ start: 0.1 + s.rng.next() * 0.3, dur: 0.02, gain: 0.6, decay: 0.004, lp: 6000 })) },
  'block.chime': { dur: 1.5, recipe: (s) => s.bell({ f: 1200 + s.rng.next() * 800, ratios: [1, 2.76, 5.4], gain: 0.3, decay: 0.5, dur: 1.4 }) },
  'firework.launch': { dur: 0.8, recipe: (s) => s.noise({ dur: 0.75, gain: 0.7, attack: 0.02, decay: 0.3, hp: 1500, lp: 8000 }) },
  'firework.blast': { dur: 1.5, recipe: (s) => (s.noise({ dur: 1.4, gain: 1, decay: 0.3, lp: 1200 }), s.noise({ start: 0.3, dur: 1, gain: 0.3, decay: 0.3, hp: 3000, grain: 2 })) },
  // V5.5: computers
  /** The start-up chime: a fan spinning up, then three rising notes. */
  'computer.boot': {
    dur: 1.6,
    recipe: (s) => {
      s.noise({ dur: 1.5, gain: 0.15, attack: 0.5, decay: 0.8, bp: [900, 2] });
      [523, 659, 988].forEach((f, i) => s.tone({ start: 0.35 + i * 0.16, dur: 0.6, gain: 0.25, f0: f, wave: 'tri', decay: 0.3, lp: 3000 }));
    },
  },
  'computer.alert': { dur: 0.8, recipe: (s) => [0, 0.22, 0.44].forEach((t) => s.tone({ start: t, dur: 0.14, gain: 0.35, f0: 1320, wave: 'square', lp: 2600, decay: 0.07 })) },
  /** A computer breaking up: stuttering beeps over crackle. */
  'computer.glitch': {
    dur: 0.7,
    recipe: (s) => {
      for (let i = 0; i < 6; i++) s.tone({ start: i * 0.09 + s.rng.next() * 0.03, dur: 0.05, gain: 0.35, f0: 300 + s.rng.next() * 2800, wave: 'square', decay: 0.03 });
      s.noise({ dur: 0.65, gain: 0.25, decay: 0.3, hp: 1200, grain: 3 });
      s.crush(4, 5);
    },
  },
  /** Falling into the screen: a rising sweep that tears into static. */
  'computer.enter': {
    dur: 2.4,
    recipe: (s) => {
      s.tone({ dur: 1.8, gain: 0.5, f0: 60, f1: 2400, wave: 'saw', lp: 4000, attack: 0.6, decay: 1.2, vibrato: 0.04, vibratoRate: 9 });
      s.noise({ start: 1.2, dur: 1.1, gain: 0.6, attack: 0.3, decay: 0.4, hp: 600 });
      s.crush(3, 6);
    },
  },
  /** The digital world switching off: a falling whine and a click. */
  'computer.shutdown': {
    dur: 3,
    recipe: (s) => {
      s.tone({ dur: 2.6, gain: 0.5, f0: 1800, f1: 40, wave: 'sine', decay: 1.6 });
      s.noise({ dur: 2, gain: 0.3, attack: 0.05, decay: 0.9, lp: 1500 });
      s.knock({ start: 2.6, f: 300, gain: 0.5, decay: 0.03 });
    },
  },
  'computer.ambient': {
    dur: 6,
    recipe: (s) => {
      const r = s.rng;
      s.tone({ dur: 5.8, gain: 0.25, f0: 60, f1: 60.5, wave: 'saw', lp: 220, attack: 1.5, decay: 3, vibrato: 0.005, vibratoRate: 0.5 });
      for (let i = 0; i < 5; i++) s.tone({ start: r.next() * 5, dur: 0.04, gain: 0.12, f0: 1500 + r.next() * 3000, wave: 'square', decay: 0.02 });
      s.noise({ dur: 5.8, gain: 0.08, attack: 2, decay: 3, bp: [3000, 4] });
    },
  },
  // V5.5: the dragon's malware and the Corrupted Flash Drive
  'malware.spit': { dur: 1.2, recipe: (s) => (s.noise({ dur: 0.9, gain: 0.7, attack: 0.02, decay: 0.35, bp: [700, 1.5] }), s.tone({ dur: 1, gain: 0.35, f0: 900, f1: 120, wave: 'square', lp: 2000, decay: 0.4 }), s.crush(3, 7)) },
  'malware.burst': { dur: 1.4, recipe: (s) => (s.noise({ dur: 1.3, gain: 0.6, attack: 0.005, decay: 0.6, hp: 300, grain: 4 }), s.tone({ dur: 0.8, gain: 0.3, f0: 2200, f1: 200, wave: 'square', decay: 0.3 }), s.crush(3, 8)) },
  'drive.corrupt': {
    dur: 1.6,
    recipe: (s) => {
      s.tone({ dur: 0.5, gain: 0.4, f0: 880, f1: 1760, wave: 'square', decay: 0.2, lp: 3000 });
      for (let i = 0; i < 10; i++) s.tone({ start: 0.4 + i * 0.08, dur: 0.06, gain: 0.3, f0: 200 + s.rng.next() * 3000, wave: 'square', decay: 0.04 });
      s.noise({ start: 0.4, dur: 1.1, gain: 0.4, decay: 0.5, hp: 800 });
      s.crush(3, 6);
    },
  },
  'book.page': { dur: 0.4, recipe: (s) => s.noise({ dur: 0.35, gain: 0.4, attack: 0.05, decay: 0.1, bp: [2400, 1] }) },
  // V5.5: Herobrine
  /** Coming out of the screen: a deep, rising tone through static, then nothing. */
  'herobrine.emerge': {
    dur: 3.5,
    recipe: (s) => {
      s.noise({ dur: 2.6, gain: 0.6, attack: 0.4, decay: 1.4, hp: 200, grain: 2 });
      s.tone({ dur: 3, gain: 0.5, f0: 30, f1: 110, wave: 'saw', lp: 700, attack: 1.4, decay: 1, vibrato: 0.03, vibratoRate: 3 });
      s.crush(3, 6);
    },
  },
  /** Something is near: a slow, cold drone. */
  'herobrine.presence': {
    dur: 5,
    recipe: (s) => {
      s.tone({ dur: 4.8, gain: 0.45, f0: 55, f1: 52, wave: 'tri', attack: 2, decay: 2.5, vibrato: 0.01, vibratoRate: 0.4 });
      s.tone({ dur: 4.6, gain: 0.25, f0: 77.8, f1: 73.4, wave: 'sine', attack: 2.2, decay: 2.4 });
      s.noise({ dur: 4.5, gain: 0.12, attack: 2.5, decay: 2, bp: [400, 3] });
    },
  },
  'herobrine.whisper': { dur: 1.4, recipe: (s) => (s.noise({ dur: 1.3, gain: 0.35, attack: 0.3, decay: 0.6, bp: [2200, 3] }), s.noise({ start: 0.2, dur: 0.8, gain: 0.2, attack: 0.2, decay: 0.4, bp: [1100, 4] })) },
  'herobrine.strike': { dur: 0.6, recipe: (s) => (s.tone({ dur: 0.12, gain: 0.5, f0: 2400, f1: 300, wave: 'square', decay: 0.05 }), s.knock({ start: 0.08, f: 110, gain: 0.8, decay: 0.05 }), s.crush(4, 4)) },
  'herobrine.charge': { dur: 1.5, recipe: (s) => (s.tone({ dur: 1.4, gain: 0.45, f0: 90, f1: 700, wave: 'square', lp: 1800, attack: 0.5, decay: 0.3, vibrato: 0.05, vibratoRate: 12 }), s.crush(4, 3)) },
  'herobrine.slam': { dur: 1.2, recipe: (s) => (s.knock({ f: 60, gain: 1, decay: 0.3 }), s.noise({ dur: 1.1, gain: 0.5, attack: 0.01, decay: 0.6, lp: 700 }), s.crush(5, 2)) },
  'herobrine.bolt': { dur: 0.5, recipe: (s) => (s.tone({ dur: 0.4, gain: 0.45, f0: 1600, f1: 400, wave: 'saw', lp: 4000, decay: 0.15 }), s.noise({ dur: 0.3, gain: 0.3, decay: 0.1, hp: 2000 })) },
  'herobrine.teleport': { dur: 0.7, recipe: (s) => (s.tone({ dur: 0.3, gain: 0.4, f0: 300, f1: 3000, wave: 'square', decay: 0.1 }), s.noise({ start: 0.2, dur: 0.45, gain: 0.4, decay: 0.15, hp: 1500 }), s.crush(3, 5)) },
  'herobrine.retreat': {
    dur: 3,
    recipe: (s) => {
      s.tone({ dur: 2.6, gain: 0.5, f0: 900, f1: 40, wave: 'saw', lp: 2000, attack: 0.1, decay: 1.4 });
      s.noise({ dur: 2.5, gain: 0.4, attack: 0.05, decay: 1.2, hp: 400, grain: 3 });
      s.crush(3, 6);
    },
  },
  'herobrine.unplug': { dur: 1.2, recipe: (s) => (s.knock({ f: 180, gain: 0.7, decay: 0.04 }), s.tone({ start: 0.05, dur: 1, gain: 0.4, f0: 1200, f1: 60, wave: 'square', lp: 2500, decay: 0.4 }), s.crush(4, 4)) },
  'herobrine.phase': {
    dur: 3,
    recipe: (s) => {
      for (let i = 0; i < 16; i++) s.tone({ start: i * 0.1, dur: 0.07, gain: 0.3, f0: 400 + s.rng.next() * 2500, wave: 'square', decay: 0.04 });
      s.tone({ dur: 2.8, gain: 0.45, f0: 50, f1: 160, wave: 'saw', lp: 900, attack: 0.6, decay: 1.4 });
      s.crush(3, 8);
    },
  },
  'herobrine.death': {
    dur: 7,
    recipe: (s) => {
      s.tone({ dur: 6.5, gain: 0.5, f0: 220, f1: 25, wave: 'saw', lp: 1500, attack: 0.05, decay: 3.5 });
      s.noise({ dur: 6.8, gain: 0.6, attack: 0.2, decay: 3.5, hp: 150, grain: 2 });
      for (let i = 0; i < 20; i++) s.tone({ start: s.rng.next() * 6, dur: 0.08, gain: 0.3, f0: 100 + s.rng.next() * 3000, wave: 'square', decay: 0.04 });
      s.crush(3, 10);
    },
  },
  /** Tesla coils: a crackling zap, and the rising hum before it. */
  'tesla.zap': {
    dur: 0.8,
    recipe: (s) => {
      s.noise({ dur: 0.7, gain: 0.9, attack: 0.002, decay: 0.15, hp: 1500, grain: 2 });
      s.tone({ dur: 0.5, gain: 0.35, f0: 120, wave: 'saw', lp: 3000, decay: 0.15, vibrato: 0.2, vibratoRate: 60 });
    },
  },
  'tesla.charge': { dur: 1.6, recipe: (s) => (s.tone({ dur: 1.5, gain: 0.4, f0: 100, f1: 400, wave: 'saw', lp: 2200, attack: 1, decay: 0.3, vibrato: 0.15, vibratoRate: 50 }), s.noise({ dur: 1.5, gain: 0.25, attack: 1, decay: 0.3, hp: 3000, grain: 3 })) },
  // V6 phase 2: the Expanded End's mobs. Wind-ups are clearly audible (they telegraph an attack).
  /** Endling: a quick bright chirp (scattering from a stalker) and the soft pop of its blink. */
  'mob.endling.chirp': { dur: 0.3, recipe: (s) => (s.tone({ dur: 0.09, gain: 0.35, f0: 1500, f1: 2300, decay: 0.05 }), s.tone({ start: 0.11, dur: 0.12, gain: 0.3, f0: 1900, f1: 2700, decay: 0.07 })) },
  'mob.endling.blink': { dur: 0.35, recipe: (s) => (s.tone({ dur: 0.3, gain: 0.25, f0: 900, f1: 1800, wave: 'tri', decay: 0.15 }), s.noise({ dur: 0.2, gain: 0.12, hp: 3000, decay: 0.1 })) },
  /** Void Stalker: a growl rising through the crouch, the leap, the slip, the void taking it, and the climb back. */
  'mob.void_stalker.windup': { dur: 1.3, recipe: (s) => (s.voice({ dur: 1.2, gain: 0.8, f0: 60, f1: 110, formants: [300, 1000], rough: 0.85 }), s.noise({ dur: 1.2, gain: 0.15, attack: 1, decay: 0.2, lp: 900 })) },
  'mob.void_stalker.leap': { dur: 0.4, recipe: (s) => (s.noise({ dur: 0.35, gain: 0.5, attack: 0.01, decay: 0.2, bp: [700, 2] }), s.voice({ dur: 0.3, gain: 0.6, f0: 130, f1: 80, formants: [400, 1300], rough: 0.9 })) },
  'mob.void_stalker.slip': { dur: 0.8, recipe: (s) => s.voice({ dur: 0.7, gain: 0.7, f0: 160, f1: 70, formants: [350, 1200], rough: 0.6 }) },
  'mob.void_stalker.vanish': { dur: 1.6, recipe: (s) => (s.tone({ dur: 1.5, gain: 0.5, f0: 220, f1: 40, wave: 'saw', lp: 900, decay: 0.8 }), s.noise({ dur: 1.4, gain: 0.3, decay: 0.8, lp: 600 })) },
  'mob.void_stalker.rise': { dur: 1.7, recipe: (s) => (s.tone({ dur: 1.6, gain: 0.55, f0: 38, f1: 120, wave: 'saw', lp: 500, attack: 1.2, decay: 0.2 }), s.noise({ dur: 1.6, gain: 0.25, attack: 1.2, decay: 0.2, lp: 400 })) },
  'mob.void_stalker.emerge': { dur: 0.6, recipe: (s) => (s.noise({ dur: 0.5, gain: 0.5, decay: 0.3, lp: 1200 }), s.voice({ dur: 0.45, gain: 0.7, f0: 95, f1: 70, formants: [320, 1100], rough: 0.85 })) },
  /** Chorus Beast: rearing up, the slam, winding up a throw, the throw, the splat, and settling down. */
  'mob.chorus_beast.rear': { dur: 1.5, recipe: (s) => (s.voice({ dur: 1.4, gain: 1, f0: 45, f1: 75, formants: [240, 600], rough: 0.6 }), s.noise({ dur: 1.4, gain: 0.2, attack: 1.2, decay: 0.1, lp: 300 })) },
  'mob.chorus_beast.slam': { dur: 1.2, recipe: (s) => (s.noise({ dur: 1.1, gain: 1, attack: 0.005, decay: 0.4, lp: 280 }), s.tone({ dur: 0.9, gain: 0.8, f0: 70, f1: 28, decay: 0.5 }), s.noise({ dur: 0.4, gain: 0.35, decay: 0.15, bp: [1400, 2] })) },
  'mob.chorus_beast.windup': { dur: 1.2, recipe: (s) => (s.voice({ dur: 1.1, gain: 0.8, f0: 55, f1: 90, formants: [260, 700], rough: 0.5 }), s.tone({ dur: 1.1, gain: 0.25, f0: 300, f1: 900, wave: 'tri', attack: 0.9, decay: 0.1 })) },
  'mob.chorus_beast.throw': { dur: 0.5, recipe: (s) => (s.noise({ dur: 0.4, gain: 0.5, decay: 0.2, bp: [500, 2] }), s.voice({ dur: 0.35, gain: 0.7, f0: 80, f1: 60, formants: [260, 640], rough: 0.6 })) },
  'mob.chorus_beast.splat': { dur: 0.5, recipe: (s) => (s.noise({ dur: 0.35, gain: 0.6, decay: 0.15, lp: 1800 }), s.tone({ dur: 0.4, gain: 0.3, f0: 600, f1: 1400, wave: 'tri', decay: 0.2 })) },
  'mob.chorus_beast.calm': { dur: 1.6, recipe: (s) => s.voice({ dur: 1.5, gain: 0.7, f0: 70, f1: 50, formants: [260, 620], rough: 0.25, vibrato: 0.03 }) },
  /** End Crystal Mite: a glassy shiver before it bites, and a tinkle as it burrows into a cluster. */
  'mob.end_crystal_mite.windup': { dur: 1.2, recipe: (s) => { for (let i = 0; i < 10; i++) s.bell({ start: i * 0.1, f: 2400 + s.rng.next() * 900, ratios: [1, 2.76], gain: 0.12 + i * 0.015, decay: 0.08, dur: 0.15 }); } },
  'mob.end_crystal_mite.burrow': { dur: 0.6, recipe: (s) => { for (let i = 0; i < 5; i++) s.bell({ start: i * 0.08, f: 3200 - i * 300, ratios: [1, 2.76], gain: 0.2, decay: 0.12, dur: 0.2 }); } },
  /** End Phantom: the screech before its dive, the rush of the dive, and the crack when it is stunned. */
  'mob.end_phantom.screech': { dur: 1.6, recipe: (s) => (s.voice({ dur: 1.5, gain: 0.9, f0: 900, f1: 1400, formants: [1600, 3400], rough: 0.4, vibrato: 0.05 }), s.noise({ dur: 1.4, gain: 0.2, attack: 0.3, decay: 0.3, hp: 4000 })) },
  'mob.end_phantom.dive': { dur: 1.2, recipe: (s) => s.noise({ dur: 1.1, gain: 0.7, attack: 0.15, decay: 0.5, bp: [900, 1.5] }) },
  // V6 phase 3: the Guardian Constructs: stone grinding on stone, crystal charging, heavy blows
  'mob.guardian_sentinel.windup': { dur: 1.3, recipe: (s) => (s.tone({ dur: 1.2, gain: 0.4, f0: 300, f1: 1400, wave: 'saw', lp: 2400, attack: 1, decay: 0.15 }), s.noise({ dur: 1.2, gain: 0.25, attack: 0.8, decay: 0.2, bp: [600, 3] })) },
  'mob.guardian_sentinel.punch': { dur: 0.6, recipe: (s) => (s.knock({ f: 90, gain: 1, decay: 0.25, noise: 0.6 }), s.noise({ dur: 0.4, gain: 0.5, decay: 0.15, lp: 900 })) },
  'mob.guardian_sentinel.charge': { dur: 1.6, recipe: (s) => (s.tone({ dur: 1.5, gain: 0.35, f0: 600, f1: 2600, wave: 'sine', attack: 1.3, decay: 0.15, vibrato: 0.02, vibratoRate: 14 }), s.bell({ start: 1.2, f: 1800, ratios: [1, 2.4], gain: 0.25, decay: 0.2, dur: 0.3 })) },
  'mob.guardian_sentinel.bolt': { dur: 0.6, recipe: (s) => (s.tone({ dur: 0.5, gain: 0.6, f0: 2400, f1: 500, wave: 'saw', lp: 4000, decay: 0.3 }), s.noise({ dur: 0.3, gain: 0.35, decay: 0.12, hp: 2500 })) },
  'mob.guardian_sentinel.hit': { dur: 0.5, recipe: (s) => { for (let i = 0; i < 4; i++) s.bell({ start: i * 0.04, f: 2600 + s.rng.next() * 1200, ratios: [1, 2.76], gain: 0.25, decay: 0.1, dur: 0.2 }); } },
  'mob.guardian_bulwark.wake': { dur: 2, recipe: (s) => (s.noise({ dur: 1.8, gain: 0.7, attack: 0.6, decay: 0.6, lp: 400 }), s.tone({ dur: 1.8, gain: 0.4, f0: 32, f1: 70, wave: 'saw', lp: 300, attack: 1, decay: 0.5 }), s.bell({ start: 1.4, f: 700, ratios: [1, 1.5, 2.01], gain: 0.3, decay: 0.4, dur: 0.6 })) },
  'mob.guardian_bulwark.sleep': { dur: 1.4, recipe: (s) => (s.noise({ dur: 1.3, gain: 0.5, decay: 0.6, lp: 350 }), s.tone({ dur: 1.2, gain: 0.3, f0: 70, f1: 30, wave: 'saw', lp: 300, decay: 0.6 })) },
  'mob.guardian_bulwark.windup': { dur: 1.8, recipe: (s) => (s.noise({ dur: 1.7, gain: 0.5, attack: 1.4, decay: 0.2, bp: [300, 2] }), s.tone({ dur: 1.7, gain: 0.35, f0: 40, f1: 120, wave: 'saw', lp: 600, attack: 1.4, decay: 0.2 })) },
  'mob.guardian_bulwark.pound': { dur: 1.5, recipe: (s) => (s.noise({ dur: 1.4, gain: 1, attack: 0.003, decay: 0.5, lp: 250 }), s.tone({ dur: 1.1, gain: 0.9, f0: 60, f1: 22, decay: 0.6 }), s.knock({ f: 140, gain: 0.8, decay: 0.3, noise: 0.8 })) },
  'mob.guardian_bulwark.shield': { dur: 1.2, recipe: (s) => (s.bell({ f: 900, ratios: [1, 1.5, 2.5], gain: 0.35, decay: 0.6, dur: 1.1 }), s.tone({ dur: 1.1, gain: 0.15, f0: 450, wave: 'sine', vibrato: 0.04, vibratoRate: 7, decay: 0.5 })) },
  // V6 phase 3: the ancient civilization and its weapons
  'block.glyph': { dur: 0.8, recipe: (s) => (s.noise({ dur: 0.5, gain: 0.25, decay: 0.3, bp: [1800, 3] }), s.bell({ f: 540, ratios: [1, 1.19, 1.5], gain: 0.2, decay: 0.5, dur: 0.7 })) },
  'block.dormant': { dur: 0.6, recipe: (s) => (s.knock({ f: 120, gain: 0.5, decay: 0.15, noise: 0.4 }), s.tone({ dur: 0.5, gain: 0.12, f0: 80, f1: 60, wave: 'saw', lp: 300, decay: 0.3 })) },
  'block.dead_portal': { dur: 1.2, recipe: (s) => (s.noise({ dur: 1.1, gain: 0.25, attack: 0.3, decay: 0.6, lp: 500 }), s.tone({ dur: 1, gain: 0.12, f0: 180, f1: 90, wave: 'tri', decay: 0.6 })) },
  'shardstaff.fire': { dur: 0.6, recipe: (s) => (s.bell({ f: 1600, ratios: [1, 2.4, 3.1], gain: 0.4, decay: 0.25, dur: 0.5 }), s.noise({ dur: 0.3, gain: 0.25, decay: 0.12, hp: 3000 })) },
  'shardstaff.hit': { dur: 0.5, recipe: (s) => { for (let i = 0; i < 5; i++) s.bell({ start: i * 0.03, f: 2200 + s.rng.next() * 1600, ratios: [1, 2.76], gain: 0.2, decay: 0.1, dur: 0.18 }); } },
  /** A giant structure found: a slow chord rising out of the dark, once. */
  'music.discovery': {
    dur: 6,
    recipe: (s) => {
      s.tone({ dur: 5.5, gain: 0.18, f0: 55, wave: 'saw', lp: 400, attack: 1.5, decay: 2.5 });
      for (const [i, f] of [220, 277.2, 329.6, 415.3].entries()) s.tone({ start: 0.4 + i * 0.5, dur: 5 - i * 0.5, gain: 0.12, f0: f, wave: 'tri', attack: 1, decay: 2.2, vibrato: 0.01, vibratoRate: 5 });
      s.bell({ start: 2.6, f: 880, ratios: [1, 1.5, 2.01], gain: 0.2, decay: 1.6, dur: 3 });
    },
  },
  'mob.end_phantom.stun': { dur: 0.6, recipe: (s) => (s.noise({ dur: 0.15, gain: 0.7, decay: 0.05, hp: 2000 }), s.voice({ dur: 0.5, gain: 0.6, f0: 1100, f1: 500, formants: [1500, 3000], rough: 0.3 })) },
  // V6: the Expanded End's ambient beds (looped by AudioEngine.setBed, one per biome)
  /** End Barrens: soft, open wind over a faint low tone. */
  'bed.end_barrens': {
    dur: 9,
    recipe: (s) => {
      s.wash({ gain: 0.5, lp: 900, hp: 120, swell: 0.6 });
      s.drone({ f: 110, gain: 0.06, beat: 0.3 });
    },
  },
  /** Shattered End: a deep hum with wind whistling between the spires. */
  'bed.shattered_end': {
    dur: 9,
    recipe: (s) => {
      s.drone({ f: 55, gain: 0.35, wave: 'saw', lp: 300, beat: 0.4, swell: 0.3 });
      s.wash({ gain: 0.25, bp: [1800, 8], swell: 0.8 });
    },
  },
  /** Astral End: an airy chord with soft chimes now and then. */
  'bed.astral_end': {
    dur: 10,
    recipe: (s) => {
      s.drone({ f: 220, gain: 0.14, wave: 'tri', beat: 0.5, lp: 1800 });
      s.drone({ f: 330, gain: 0.09, beat: 0.25 });
      s.wash({ gain: 0.15, lp: 1500, hp: 400, swell: 0.5 });
      for (let i = 0; i < 4; i++) s.bell({ start: 0.5 + i * 2.2 + s.rng.next() * 0.8, f: [880, 990, 1320, 1480][s.rng.int(4)]!, ratios: [1, 2.76], gain: 0.05, decay: 0.8, dur: 1.4 });
    },
  },
  /** End Highlands: a cave rumble with distant drips. */
  'bed.highlands': {
    dur: 9,
    recipe: (s) => {
      s.wash({ gain: 0.8, lp: 120, swell: 0.4 });
      s.drone({ f: 41, gain: 0.3, swell: 0.3 });
      for (let i = 0; i < 5; i++) s.tone({ start: 0.6 + i * 1.6 + s.rng.next(), dur: 0.08, gain: 0.08, f0: 1500 + s.rng.next() * 900, f1: 2600, decay: 0.03 });
    },
  },
  /** End Crystal Fields: a high shimmer of small bells over a thin tone. */
  'bed.end_crystal_fields': {
    dur: 9,
    recipe: (s) => {
      s.drone({ f: 660, gain: 0.05, beat: 1.2 });
      for (let i = 0; i < 14; i++) s.bell({ start: s.rng.next() * 8, f: [1568, 1760, 2093, 2349, 2637][s.rng.int(5)]!, ratios: [1, 2.76, 5.4], gain: 0.04, decay: 0.6, dur: 1 });
      s.wash({ gain: 0.08, hp: 3000, lp: 9000, swell: 0.5 });
    },
  },
  /** Chorus Forest: a soft rustle through the stalks, a warm low tone and a hollow knock now and then. */
  'bed.chorus_forest': {
    dur: 9,
    recipe: (s) => {
      s.wash({ gain: 0.22, hp: 300, lp: 1400, swell: 0.7 });
      s.drone({ f: 98, gain: 0.08, wave: 'tri', beat: 0.3, lp: 900 });
      for (let i = 0; i < 3; i++) s.tone({ start: 1 + i * 2.6 + s.rng.next(), dur: 0.12, gain: 0.07, f0: 260 + s.rng.next() * 80, f1: 180, decay: 0.06 });
    },
  },
  /** Void Wastes: a dark, slowly swelling hush over a very low tone. */
  'bed.void_wastes': {
    dur: 9,
    recipe: (s) => {
      s.wash({ gain: 0.45, lp: 500, hp: 60, swell: 0.5 });
      s.drone({ f: 41, gain: 0.26, wave: 'saw', lp: 160, beat: 0.15, swell: 0.6 });
    },
  },
};

/** Parameters for generic creature voices, keyed by mob type. */
const VOICES: Record<string, { f: number; formants: [number, number]; rough: number; dur: number; gain?: number; crush?: boolean; bell?: boolean; mech?: boolean }> = {
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
  glow_squid: { f: 200, formants: [500, 1100], rough: 0.2, dur: 0.5, gain: 0.4 },
  crystal_mite: { f: 1400, formants: [2400, 4200], rough: 0.7, dur: 0.2, bell: true },
  sporeling: { f: 320, formants: [700, 1500], rough: 0.1, dur: 0.4, gain: 0.5 },
  warden: { f: 60, formants: [300, 760], rough: 0.85, dur: 1.2, gain: 1 },
  ender_dragon: { f: 70, formants: [380, 900], rough: 0.5, dur: 1.8, gain: 1 },
  turtle: { f: 160, formants: [400, 900], rough: 0.4, dur: 0.4, gain: 0.5 },
  parrot: { f: 1100, formants: [1800, 3200], rough: 0.15, dur: 0.3 },
  ocelot: { f: 520, formants: [900, 1900], rough: 0.1, dur: 0.35 },
  panda: { f: 200, formants: [500, 1100], rough: 0.3, dur: 0.6 },
  llama: { f: 260, formants: [700, 1500], rough: 0.2, dur: 0.6 },
  camel: { f: 110, formants: [450, 900], rough: 0.45, dur: 0.9 },
  frog: { f: 180, formants: [500, 1200], rough: 0.6, dur: 0.35 },
  axolotl: { f: 900, formants: [1400, 2600], rough: 0.05, dur: 0.3, gain: 0.5 },
  tropical_fish: { f: 600, formants: [1200, 2400], rough: 0.05, dur: 0.15, gain: 0.3 },
  pufferfish: { f: 400, formants: [900, 1800], rough: 0.2, dur: 0.2, gain: 0.4 },
  player: { f: 240, formants: [650, 1100], rough: 0.08, dur: 0.2 },
  herobrine: { f: 150, formants: [480, 1250], rough: 0.5, dur: 0.6, crush: true },
  // V6 phase 2: the Expanded End (Endlings chirp, stalkers rasp, beasts rumble, mites tick, phantoms keen)
  endling: { f: 1250, formants: [2200, 3600], rough: 0.04, dur: 0.18, gain: 0.55 },
  void_stalker: { f: 75, formants: [320, 1100], rough: 0.8, dur: 1.1, gain: 0.85 },
  chorus_beast: { f: 52, formants: [260, 640], rough: 0.55, dur: 1.5, gain: 1 },
  end_crystal_mite: { f: 1800, formants: [2800, 4800], rough: 0.6, dur: 0.15, bell: true, gain: 0.5 },
  end_phantom: { f: 680, formants: [1400, 3000], rough: 0.25, dur: 1.1, gain: 0.7 },
  // V6 phase 3: the Guardian Constructs have no voice, only machinery
  guardian_sentinel: { f: 90, formants: [300, 900], rough: 0.5, dur: 0.8, gain: 0.7, mech: true },
  guardian_bulwark: { f: 45, formants: [200, 600], rough: 0.6, dur: 1.2, gain: 0.9, mech: true },
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
      if (v.mech) {
        // Stone grinding on stone, a crystal hum, and a clank (a crumble when it falls)
        s.noise({ dur, gain: (v.gain ?? 0.8) * 0.6, attack: 0.05, decay: dur * 0.5, bp: [f * 4, 2.5] });
        s.tone({ dur, gain: 0.15, f0: f * 6, f1: f * (death ? 2 : 6), wave: 'sine', vibrato: 0.03, vibratoRate: 9, decay: dur * 0.5 });
        s.knock({ f: f * 1.5, gain: hurt ? 0.8 : 0.4, decay: 0.15, noise: 0.5 });
        if (death) for (let i = 0; i < 5; i++) s.knock({ start: 0.15 + i * 0.12, f: f * (1 + r.next()), gain: 0.4, decay: 0.12, noise: 0.7 });
      } else if (v.bell) s.bell({ f: f * 2, ratios: [1, 1.5, 2.01], gain: 0.5, decay: dur * 0.4, dur });
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
