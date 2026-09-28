/**
 * Web Audio engine: positional sound effects, ambient beds, weather loops
 * and a generative music system. All sounds come from ./synth.
 */
import { SynthCtx, recipeFor } from './synth';
import { Random, hashString } from '../../common/math/rng';
import type { Settings } from '../settings';
import type { DimensionId } from '../../common/data/biomes';

const VARIANTS = 4;

export type SoundCategory = 'sound' | 'ambient' | 'music' | 'ui';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = new Map<SoundCategory, GainNode>();
  private underwaterFilter!: BiquadFilterNode;
  private readonly cache = new Map<string, AudioBuffer[] | null>();
  private rainNode: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private reverb: ConvolverNode | null = null;
  private listener = { x: 0, y: 0, z: 0 };
  private active = 0;
  readonly music: MusicPlayer;
  readonly discs: DiscPlayer;
  onSubtitle: ((text: string) => void) | null = null;

  constructor(private readonly settings: Settings) {
    this.music = new MusicPlayer(this);
    this.discs = new DiscPlayer(this);
  }

  /** Browsers only allow audio after a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.underwaterFilter = ctx.createBiquadFilter();
    this.underwaterFilter.type = 'lowpass';
    this.underwaterFilter.frequency.value = 22000;
    this.underwaterFilter.connect(this.master);
    for (const c of ['sound', 'ambient', 'music', 'ui'] as SoundCategory[]) {
      const g = ctx.createGain();
      g.connect(c === 'music' || c === 'ui' ? this.master : this.underwaterFilter);
      this.buses.set(c, g);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.5);
    const rg = ctx.createGain();
    rg.gain.value = 0.45;
    this.reverb.connect(rg);
    rg.connect(this.buses.get('music')!);
    this.applyVolumes();
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  bus(c: SoundCategory): GainNode | null {
    return this.buses.get(c) ?? null;
  }

  get reverbInput(): AudioNode | null {
    return this.reverb;
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.masterVolume;
    this.buses.get('sound')!.gain.value = s.soundVolume;
    this.buses.get('ui')!.gain.value = s.soundVolume;
    this.buses.get('ambient')!.gain.value = s.ambientVolume;
    this.buses.get('music')!.gain.value = s.musicVolume * 0.6;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** Renders (or fetches cached) variants of a named sound. */
  private buffers(name: string): AudioBuffer[] | null {
    if (this.cache.has(name)) return this.cache.get(name)!;
    const r = recipeFor(name);
    if (!r || !this.ctx) {
      this.cache.set(name, null);
      return null;
    }
    const out: AudioBuffer[] = [];
    const sr = this.ctx.sampleRate;
    let seed = 0;
    for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) | 0;
    for (let v = 0; v < VARIANTS; v++) {
      const s = new SynthCtx(sr, r.dur, seed + v * 7919);
      r.recipe(s);
      const data = s.normalize(0.8);
      const b = this.ctx.createBuffer(1, data.length, sr);
      b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      out.push(b);
    }
    this.cache.set(name, out);
    return out;
  }

  setListener(x: number, y: number, z: number, yaw: number, pitch: number, underwater: boolean): void {
    this.listener = { x, y, z };
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
    this.underwaterFilter.frequency.setTargetAtTime(underwater ? 600 : 22000, t, 0.1);
  }

  /** Plays a sound at a world position (or non-positional when x is NaN). */
  play(name: string, x = NaN, y = NaN, z = NaN, volume = 1, pitch = 1, category: SoundCategory = 'sound'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || volume <= 0) return;
    if (this.active > 48) return;
    const bufs = this.buffers(name);
    if (!bufs) return;
    const positional = !Number.isNaN(x);
    const range = 16 * Math.max(1, volume);
    if (positional) {
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      const dz = z - this.listener.z;
      if (dx * dx + dy * dy + dz * dz > range * range) return;
    }
    const src = ctx.createBufferSource();
    src.buffer = bufs[Math.floor(Math.random() * bufs.length)]!;
    src.playbackRate.value = Math.max(0.3, Math.min(3, pitch));
    const g = ctx.createGain();
    g.gain.value = Math.min(1, volume);
    src.connect(g);
    let tail: AudioNode = g;
    if (positional) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'linear';
      p.refDistance = 1;
      p.maxDistance = range;
      p.rolloffFactor = 1;
      if (p.positionX) {
        p.positionX.value = x;
        p.positionY.value = y;
        p.positionZ.value = z;
      } else p.setPosition(x, y, z);
      g.connect(p);
      tail = p;
    }
    tail.connect(this.buses.get(category)!);
    this.active++;
    src.onended = () => {
      this.active--;
      src.disconnect();
      tail.disconnect();
    };
    src.start();
    if (this.settings.subtitles && this.onSubtitle && category !== 'music') this.onSubtitle(subtitleFor(name));
  }

  ui(name = 'ui.click'): void {
    this.unlock();
    this.play(name, NaN, NaN, NaN, 0.5, 1, 'ui');
  }

  /** Continuous rain loop; `level` 0..1 scaled by exposure to the sky. */
  setRain(level: number, snowy: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.rainNode && level > 0.01) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let l = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        l += (w - l) * 0.3;
        d[i] = l + (Math.random() < 0.002 ? (Math.random() - 0.5) * 2 : 0);
      }
      // crossfade the loop seam
      const fade = 2000;
      for (let i = 0; i < fade; i++) d[len - fade + i] = d[len - fade + i]! * (1 - i / fade) + d[i]! * (i / fade);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = fade / ctx.sampleRate;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 3000;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.buses.get('ambient')!);
      src.start();
      this.rainNode = { src, gain, filter };
    }
    if (this.rainNode) {
      const t = ctx.currentTime;
      this.rainNode.gain.gain.setTargetAtTime(snowy ? level * 0.08 : level * 0.35, t, 0.5);
      this.rainNode.filter.frequency.setTargetAtTime(snowy ? 800 : 3000, t, 0.5);
    }
  }

  stopAll(): void {
    if (this.rainNode) {
      this.rainNode.src.stop();
      this.rainNode.src.disconnect();
      this.rainNode = null;
    }
    this.music.stop();
    this.discs.stopAll();
  }
}

function subtitleFor(name: string): string {
  const [a, b] = name.split('.');
  switch (a) {
    case 'break':
      return 'Block broken';
    case 'place':
      return 'Block placed';
    case 'step':
      return 'Footsteps';
    case 'hit':
      return 'Block breaking';
    case 'mob':
      return `${(b ?? '').replace(/_/g, ' ')} noise`;
    default:
      return name.replace(/[._]/g, ' ');
  }
}

// ---------------------------------------------------------------------------
// Generative music
// ---------------------------------------------------------------------------
type Mood = 'calm' | 'creative' | 'nether' | 'end' | 'farlands' | 'menu' | 'underwater' | 'boss';

const SCALES: Record<Mood, { root: number; scale: number[]; tempo: number; density: number; wave: 'piano' | 'pad' | 'glass' | 'square' }> = {
  calm: { root: 57, scale: [0, 2, 4, 7, 9], tempo: 0.9, density: 0.55, wave: 'piano' },
  creative: { root: 60, scale: [0, 2, 4, 5, 7, 9, 11], tempo: 0.75, density: 0.7, wave: 'piano' },
  menu: { root: 55, scale: [0, 2, 3, 7, 10], tempo: 1.1, density: 0.5, wave: 'piano' },
  underwater: { root: 52, scale: [0, 3, 5, 7, 10], tempo: 1.4, density: 0.4, wave: 'glass' },
  nether: { root: 45, scale: [0, 1, 3, 6, 7, 10], tempo: 1.2, density: 0.45, wave: 'pad' },
  end: { root: 50, scale: [0, 2, 5, 7, 9], tempo: 1.6, density: 0.35, wave: 'glass' },
  farlands: { root: 48, scale: [0, 1, 4, 6, 7, 11], tempo: 0.8, density: 0.6, wave: 'square' },
  boss: { root: 45, scale: [0, 1, 3, 5, 7, 8], tempo: 0.45, density: 0.85, wave: 'pad' },
};

export class MusicPlayer {
  private playingUntil = 0;
  private nextStart = 20;
  private voices: AudioScheduledSourceNode[] = [];
  mood: Mood = 'calm';

  constructor(private readonly engine: AudioEngine) {}

  /** Chooses a mood from the game state. */
  static moodFor(dim: DimensionId, creative: boolean, underwater: boolean, boss: boolean): Mood {
    if (boss) return 'boss';
    if (dim === 'nether') return 'nether';
    if (dim === 'end') return 'end';
    if (dim === 'farlands') return 'farlands';
    if (underwater) return 'underwater';
    return creative ? 'creative' : 'calm';
  }

  /** Called periodically; starts pieces with silent gaps between them. */
  update(mood: Mood, force = false): void {
    const ctx = this.engine.context;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (mood !== this.mood && (mood === 'boss' || this.mood === 'boss' || mood === 'menu' || this.mood === 'menu')) {
      this.stop();
      this.nextStart = now + (mood === 'boss' || mood === 'menu' ? 1 : 30);
    }
    this.mood = mood;
    if (now < this.playingUntil) return;
    if (!force && now < this.nextStart) return;
    const length = this.compose(now + 0.1, mood);
    this.playingUntil = now + length;
    this.nextStart = this.playingUntil + (mood === 'boss' || mood === 'menu' ? 2 : 60 + Math.random() * 180);
  }

  stop(): void {
    for (const v of this.voices)
      try {
        v.stop();
      } catch {
        /* already stopped */
      }
    this.voices = [];
    this.playingUntil = 0;
  }

  /** Composes and schedules one piece; returns its length in seconds. */
  private compose(t0: number, mood: Mood): number {
    const ctx = this.engine.context!;
    const bus = this.engine.bus('music')!;
    const rev = this.engine.reverbInput;
    const def = SCALES[mood];
    const beat = def.tempo;
    const bars = mood === 'boss' ? 16 : 12 + Math.floor(Math.random() * 10);
    const beatsPerBar = 4;
    const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
    const degree = (d: number): number => {
      const s = def.scale;
      const oct = Math.floor(d / s.length);
      return def.root + s[((d % s.length) + s.length) % s.length]! + oct * 12;
    };
    // Chord progression over scale degrees
    const progressions = [
      [0, 3, 4, 2],
      [0, 2, 3, 1],
      [0, 4, 3, 3],
      [0, 1, 3, 2],
    ];
    const prog = progressions[Math.floor(Math.random() * progressions.length)]!;
    let melodyDeg = 7 + Math.floor(Math.random() * 3);
    this.voices = [];
    for (let bar = 0; bar < bars; bar++) {
      const tb = t0 + bar * beatsPerBar * beat;
      const chordRoot = prog[bar % prog.length]!;
      // bass / chord
      const chord = [chordRoot, chordRoot + 2, chordRoot + 4].map((d) => degree(d) - 12);
      const chordLen = beatsPerBar * beat * (def.wave === 'pad' ? 1.05 : 0.95);
      chord.forEach((n, i) => this.note(ctx, bus, rev, midi(n), tb + i * 0.02, chordLen, 0.05, def.wave === 'piano' ? 'pad' : def.wave));
      if (bar % 2 === 0) this.note(ctx, bus, rev, midi(degree(chordRoot) - 24), tb, chordLen * 2, 0.07, 'pad');
      // melody
      for (let b = 0; b < beatsPerBar * 2; b++) {
        if (Math.random() > def.density * (bar === bars - 1 ? 0.3 : 1)) continue;
        const step = Math.random();
        melodyDeg += step < 0.35 ? -1 : step < 0.7 ? 1 : step < 0.8 ? 2 : step < 0.9 ? -2 : 0;
        melodyDeg = Math.max(4, Math.min(14, melodyDeg));
        const len = beat * (Math.random() < 0.3 ? 2 : 1);
        this.note(ctx, bus, rev, midi(degree(melodyDeg)), tb + (b * beat) / 2, len * 1.6, 0.09, def.wave);
      }
    }
    return bars * beatsPerBar * beat + 4;
  }

  private note(ctx: AudioContext, bus: AudioNode, rev: AudioNode | null, freq: number, t: number, len: number, vol: number, wave: Wave): void {
    this.voices.push(scheduleNote(ctx, bus, rev, freq, t, len, vol, wave));
  }
}

type Wave = 'piano' | 'pad' | 'glass' | 'square';

/** One synthesized note (shared by the ambient music and jukebox discs). */
export function scheduleNote(ctx: AudioContext, bus: AudioNode, rev: AudioNode | null, freq: number, t: number, len: number, vol: number, wave: Wave): OscillatorNode {
  const g = ctx.createGain();
  const o = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  o.frequency.value = freq;
  if (wave === 'piano') {
    o.type = 'triangle';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + len);
  } else if (wave === 'glass') {
    o.type = 'sine';
    f.frequency.value = 8000;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.9, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, t + len * 1.5);
  } else if (wave === 'square') {
    o.type = 'square';
    f.frequency.value = freq * 3;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    o.detune.setValueAtTime(0, t);
    o.detune.linearRampToValueAtTime((Math.random() - 0.5) * 60, t + len);
  } else {
    o.type = 'sawtooth';
    f.frequency.value = freq * 2;
    f.Q.value = 0.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.5, t + len * 0.3);
    g.gain.linearRampToValueAtTime(0, t + len);
  }
  o.connect(f);
  f.connect(g);
  g.connect(bus);
  if (rev) g.connect(rev);
  o.start(t);
  o.stop(t + len * 1.6 + 0.1);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
    f.disconnect();
  };
  return o;
}

/** Jukebox tracks: each disc is its own seeded composition. */
const DISC_TRACKS: Record<string, { title: string; root: number; scale: number[]; beat: number; wave: Wave; bass: Wave; density: number; bars: number }> = {
  meadow: { title: 'Meadow', root: 60, scale: [0, 2, 4, 7, 9], beat: 0.42, wave: 'piano', bass: 'pad', density: 0.6, bars: 36 },
  deepcave: { title: 'Deep Cave', root: 45, scale: [0, 2, 3, 7, 8], beat: 0.75, wave: 'glass', bass: 'pad', density: 0.45, bars: 28 },
  overflow: { title: 'Overflow', root: 52, scale: [0, 1, 4, 6, 7, 11], beat: 0.3, wave: 'square', bass: 'square', density: 0.7, bars: 44 },
  ember: { title: 'Ember', root: 43, scale: [0, 1, 3, 6, 7, 10], beat: 0.55, wave: 'pad', bass: 'pad', density: 0.5, bars: 32 },
  drift: { title: 'Drift', root: 50, scale: [0, 2, 5, 7, 9], beat: 0.95, wave: 'glass', bass: 'pad', density: 0.35, bars: 24 },
  skyward: { title: 'Skyward', root: 64, scale: [0, 2, 4, 6, 7, 9, 11], beat: 0.36, wave: 'piano', bass: 'glass', density: 0.65, bars: 40 },
  echo: { title: 'Echo', root: 38, scale: [0, 1, 3, 5, 7, 8], beat: 1.05, wave: 'glass', bass: 'pad', density: 0.3, bars: 26 },
  hollow: { title: 'Hollow', root: 38, scale: [0, 1, 5, 6, 10], beat: 0.9, wave: 'glass', bass: 'pad', density: 0.35, bars: 30 },
};

export function discTitle(track: string): string {
  return DISC_TRACKS[track]?.title ?? track;
}

/** Plays jukebox discs positionally around the jukebox. */
export class DiscPlayer {
  private readonly playing = new Map<string, { nodes: OscillatorNode[]; out: GainNode; panner: PannerNode }>();

  constructor(private readonly engine: AudioEngine) {}

  play(x: number, y: number, z: number, track: string): void {
    const key = `${x},${y},${z}`;
    this.stop(x, y, z);
    const ctx = this.engine.context;
    const bus = this.engine.bus('music');
    if (!ctx || !bus || ctx.state !== 'running') return;
    const def = DISC_TRACKS[track] ?? DISC_TRACKS.meadow!;
    const out = ctx.createGain();
    out.gain.value = 1.4;
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'linear';
    panner.refDistance = 4;
    panner.maxDistance = 64;
    panner.rolloffFactor = 1;
    if (panner.positionX) {
      panner.positionX.value = x + 0.5;
      panner.positionY.value = y + 0.5;
      panner.positionZ.value = z + 0.5;
    } else panner.setPosition(x + 0.5, y + 0.5, z + 0.5);
    out.connect(panner);
    panner.connect(bus);
    // Deterministic per track: the same disc always plays the same piece
    const rng = new Random(hashString('disc:' + track));
    const nodes: OscillatorNode[] = [];
    const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
    const degree = (d: number): number => {
      const sc = def.scale;
      const oct = Math.floor(d / sc.length);
      return def.root + sc[((d % sc.length) + sc.length) % sc.length]! + oct * 12;
    };
    const progs = [
      [0, 3, 4, 2],
      [0, 5, 3, 4],
      [0, 2, 3, 1],
      [0, 4, 5, 3],
    ];
    const prog = progs[rng.int(progs.length)]!;
    const motif: number[] = Array.from({ length: 8 }, () => rng.int(5) - 2);
    let mel = 7;
    const t0 = ctx.currentTime + 0.2;
    for (let bar = 0; bar < def.bars; bar++) {
      const tb = t0 + bar * 4 * def.beat;
      const root = prog[bar % prog.length]!;
      const chordLen = 4 * def.beat * 0.98;
      for (const d of [root, root + 2, root + 4]) nodes.push(scheduleNote(ctx, out, null, midi(degree(d) - 12), tb, chordLen, 0.045, def.bass));
      if (bar % 2 === 0) nodes.push(scheduleNote(ctx, out, null, midi(degree(root) - 24), tb, chordLen * 2, 0.06, 'pad'));
      // Melody: a motif varied a little every phrase, quieter towards the end
      const phrase = Math.floor(bar / 4);
      for (let b = 0; b < 8; b++) {
        if (rng.next() > def.density) continue;
        mel = Math.max(3, Math.min(14, mel + motif[(b + phrase) % motif.length]! + (rng.next() < 0.2 ? rng.int(3) - 1 : 0)));
        const fade = bar > def.bars - 4 ? 0.5 : 1;
        nodes.push(scheduleNote(ctx, out, null, midi(degree(mel)), tb + (b * def.beat) / 2, def.beat * (rng.next() < 0.3 ? 2 : 1.2), 0.08 * fade, def.wave));
      }
    }
    this.playing.set(key, { nodes, out, panner });
  }

  stop(x: number, y: number, z: number): void {
    const key = `${x},${y},${z}`;
    const p = this.playing.get(key);
    if (!p) return;
    for (const n of p.nodes)
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    p.out.disconnect();
    p.panner.disconnect();
    this.playing.delete(key);
  }

  stopAll(): void {
    for (const k of [...this.playing.keys()]) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      this.stop(x, y, z);
    }
  }
}
