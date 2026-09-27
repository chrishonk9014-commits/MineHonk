/**
 * Mob visuals: original blocky designs built with the model kit, with
 * walking/flying/swimming animations and metadata-driven variants (baby
 * scale, sheep wool colour, creeper fuse flash, sitting pets...).
 */
import * as THREE from 'three';
import { BoxModel } from './BoxModel';
import { registerVisual, boxVisual, animateHumanoid, type EntityVisual, type VisualContext } from './EntityRenderer';
import { kitModel, humanoidParts, quadParts, eyes, type KitPart, type FacePainter } from './modelKit';
import type { ClientEntity } from '../../game/ClientEntity';
import { MOB_DEFS } from '../../../common/data/mobs';
import { items } from '../../../common/registry/items';

type Anim = (m: BoxModel, e: ClientEntity, alpha: number, time: number) => void;

const DYE: Record<string, string> = {
  white: '#e9ecec',
  orange: '#f07613',
  magenta: '#bd44b3',
  light_blue: '#3aafd9',
  yellow: '#f8c627',
  lime: '#70b919',
  pink: '#ed8dac',
  gray: '#3e4447',
  light_gray: '#8e8e86',
  cyan: '#158991',
  purple: '#792aac',
  blue: '#35399d',
  brown: '#724728',
  green: '#546d1b',
  red: '#a12722',
  black: '#141519',
};

function walkPhase(e: ClientEntity, alpha: number): number {
  return e.prevWalkDist + (e.walkDist - e.prevWalkDist) * alpha;
}

function angle(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function lookHead(m: BoxModel, e: ClientEntity): void {
  const head = m.part('head');
  if (!head) return;
  head.rotation.y = Math.max(-1.2, Math.min(1.2, angle(e.headYaw - e.yaw)));
  head.rotation.x = e.pitch;
}

function babyScale(m: BoxModel, e: ClientEntity, headBoost = true): void {
  const baby = e.meta.baby === true;
  m.root.scale.setScalar(baby ? 0.5 : 1);
  const head = m.part('head');
  if (head && headBoost) head.scale.setScalar(baby ? 1.5 : 1);
}

const animQuad: Anim = (m, e, alpha) => {
  const w = walkPhase(e, alpha);
  const s = Math.sin(w * 0.6662) * 1.2 * e.limbSpeed;
  const set = (n: string, v: number): void => {
    const p = m.part(n);
    if (p) p.rotation.x = v;
  };
  set('leg0', s);
  set('leg1', -s);
  set('leg2', -s);
  set('leg3', s);
  lookHead(m, e);
  babyScale(m, e);
  // Grazing: head dips while eating
  if (e.anim === 'eat' && e.animTime < 40) {
    const head = m.part('head');
    if (head) head.rotation.x = 0.9 * Math.min(1, Math.sin((e.animTime / 40) * Math.PI) * 2);
  }
  const tail = m.part('tail');
  if (tail) tail.rotation.z = Math.sin(w * 0.6) * 0.2 * e.limbSpeed;
};

const animSitQuad: Anim = (m, e, alpha, time) => {
  animQuad(m, e, alpha, time);
  if (e.meta.sit === true) {
    const body = m.part('body');
    if (body) body.rotation.x = -0.6;
    for (const n of ['leg2', 'leg3']) {
      const p = m.part(n);
      if (p) p.rotation.x = -1.5;
    }
    m.root.position.y = -0.2;
  } else {
    const body = m.part('body');
    if (body) body.rotation.x = 0;
    m.root.position.y = 0;
  }
  const tail = m.part('tail');
  if (tail && e.meta.tame === true) tail.rotation.x = 0.9;
};

const animBiped: Anim = (m, e, alpha) => {
  animateHumanoid(m, e, alpha);
  babyScale(m, e);
};

const animZombie: Anim = (m, e, alpha) => {
  animateHumanoid(m, e, alpha, { armsForward: true });
  babyScale(m, e);
};

function isHolding(e: ClientEntity, ...ids: string[]): boolean {
  const h = Number(e.meta.held ?? 0);
  return !!h && ids.includes(items[h]?.id ?? '');
}

const animArcher: Anim = (m, e, alpha) => {
  animateHumanoid(m, e, alpha);
  if (e.meta.angry === true && isHolding(e, 'bow', 'crossbow')) {
    const ra = m.part('rightArm');
    const la = m.part('leftArm');
    if (ra) ra.rotation.set(-Math.PI / 2 + e.pitch, -0.1, 0);
    if (la) la.rotation.set(-Math.PI / 2 + e.pitch, 0.5, 0);
  }
};

const animFlyer: Anim = (m, e, alpha, time) => {
  const flap = Math.sin(time * 0.6 + e.id) * 0.7;
  const wl = m.part('wingL');
  const wr = m.part('wingR');
  if (wl) wl.rotation.z = flap;
  if (wr) wr.rotation.z = -flap;
  lookHead(m, e);
  m.root.position.y = Math.sin(time * 0.1 + e.id) * 0.05;
  void alpha;
};

const animSwim: Anim = (m, e, alpha, time) => {
  const tail = m.part('tail');
  if (tail) tail.rotation.y = Math.sin(time * 0.4 + e.id) * 0.5;
  m.root.rotation.x = -e.pitch * 0.5;
  void alpha;
};

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------
interface MobVisualDef {
  parts: (e: ClientEntity) => KitPart[];
  /** Cache key suffix from metadata (variants). */
  variant?: (e: ClientEntity) => string;
  anim: Anim;
  scale?: number;
  nameY?: number;
  /** Extra per-frame effects. */
  extra?: (m: BoxModel, e: ClientEntity, time: number) => void;
  glow?: boolean;
  transparent?: boolean;
}

const V: Record<string, MobVisualDef> = {};

// ---------------------------------------------------------------- farm animals
V.cow = {
  parts: (e) => {
    const glitched = e.type === 'glitched_cow';
    const base = glitched ? '#1f7d74' : '#4a3424';
    const spot = glitched ? '#e040e0' : '#e8e2d8';
    return quadParts({
      body: [12, 10, 18],
      legH: 12,
      legW: 4,
      head: [8, 8, 6],
      headOffset: [3, 0],
      bodyColors: { all: base },
      legColors: { all: base, bottom: '#2a2a2a' },
      headColors: { all: base },
      bodyPaint: (p) => {
        p.speckle('all', spot, 0.25);
      },
      face: (p) => {
        p.px('front', 1, 3, '#111111');
        p.px('front', 6, 3, '#111111');
        p.px('front', 2, 5, '#c89a8a', 4, 3);
        p.px('front', 2, 6, '#5a3a3a');
        p.px('front', 5, 6, '#5a3a3a');
      },
      horns: { all: '#d8d0b8' },
    });
  },
  anim: animQuad,
};
V.mooshroom = {
  parts: () => [
    ...quadParts({
      body: [12, 10, 18],
      legH: 12,
      legW: 4,
      head: [8, 8, 6],
      headOffset: [3, 0],
      bodyColors: { all: '#a4161a' },
      legColors: { all: '#a4161a', bottom: '#2a2a2a' },
      headColors: { all: '#a4161a' },
      bodyPaint: (p) => p.speckle('all', '#e8e2d8', 0.15),
      face: (p) => {
        p.px('front', 1, 3, '#111111');
        p.px('front', 6, 3, '#111111');
        p.px('front', 2, 5, '#e8c0b0', 4, 3);
      },
      horns: { all: '#d8d0b8' },
    }),
    { name: 'shroom1', parent: 'body', pivot: [2, 5, 3], from: [-2, 0, -2], size: [4, 3, 4], colors: { all: '#c81e1e', bottom: '#e8e0d0' }, paint: (p) => p.speckle('top', '#ffffff', 0.3) },
    { name: 'shroom2', parent: 'body', pivot: [-3, 5, -4], from: [-2, 0, -2], size: [4, 3, 4], colors: { all: '#c81e1e', bottom: '#e8e0d0' }, paint: (p) => p.speckle('top', '#ffffff', 0.3) },
  ],
  anim: animQuad,
};
V.pig = {
  parts: () =>
    quadParts({
      body: [10, 8, 16],
      legH: 6,
      legW: 4,
      head: [8, 8, 8],
      headOffset: [2, -1],
      bodyColors: { all: '#f0a0a0' },
      legColors: { all: '#e89090' },
      headColors: { all: '#f0a0a0' },
      face: (p) => {
        p.px('front', 1, 2, '#ffffff');
        p.px('front', 2, 2, '#1a1a1a');
        p.px('front', 5, 2, '#1a1a1a');
        p.px('front', 6, 2, '#ffffff');
      },
      snout: { size: [4, 3, 1], colors: { all: '#e87a8a' } },
      ears: { size: [2, 2, 1], colors: { all: '#e08888' } },
    }),
  anim: animQuad,
};
V.sheep = {
  variant: (e) => `${e.type}:${String(e.meta.color ?? 'white')}:${e.meta.sheared ? 1 : 0}`,
  parts: (e) => {
    const glitched = e.type === 'glitched_sheep';
    const wool = glitched ? '#7a3fe4' : DYE[String(e.meta.color ?? 'white')] ?? DYE.white!;
    const sheared = e.meta.sheared === true;
    const skin = glitched ? '#3ae0c0' : '#d8c8b0';
    const parts = quadParts({
      body: [8, 6, 14],
      legH: 12,
      legW: 4,
      head: [6, 6, 8],
      headOffset: [4, -1],
      bodyColors: { all: skin },
      legColors: { all: skin, bottom: '#5a4a3a' },
      headColors: { all: skin },
      face: (p) => {
        p.px('front', 1, 2, '#ffffff');
        p.px('front', 1, 2, '#2a2a2a');
        p.px('front', 4, 2, '#2a2a2a');
        p.px('front', 2, 4, '#c8a8a0', 2, 1);
      },
    });
    if (!sheared) {
      parts.push({ name: 'wool', parent: 'body', pivot: [0, 0, 0], from: [-5, -4, -8], size: [10, 8, 16], inflate: 0.5, colors: { all: wool }, noise: 0.2, paint: (p) => p.speckle('all', 'rgba(255,255,255,0.25)', 0.15) });
      parts.push({ name: 'woolHead', parent: 'head', pivot: [0, 0, 0], from: [-3.5, 0.5, 1], size: [7, 3.5, 5], colors: { all: wool }, noise: 0.2 });
    }
    return parts;
  },
  anim: animQuad,
};
V.chicken = {
  parts: () => [
    { name: 'body', pivot: [0, 8, 0], from: [-3, -3, -4], size: [6, 6, 8], colors: { all: '#f4f4ee' } },
    { name: 'head', pivot: [0, 10, 3], from: [-2, 0, -1], size: [4, 6, 3], colors: { all: '#f4f4ee' }, paint: (p) => {
      p.px('front', 0, 1, '#1a1a1a');
      p.px('front', 3, 1, '#1a1a1a');
    } },
    { name: 'beak', parent: 'head', pivot: [0, 3, 2], from: [-2, 0, 0], size: [4, 2, 2], colors: { all: '#f0b020' } },
    { name: 'wattle', parent: 'head', pivot: [0, 1, 2], from: [-1, 0, 0], size: [2, 2, 1], colors: { all: '#d82020' } },
    { name: 'wingL', parent: 'body', pivot: [3, 2, 0], from: [0, -4, -3], size: [1, 4, 6], colors: { all: '#e8e8e0' } },
    { name: 'wingR', parent: 'body', pivot: [-3, 2, 0], from: [-1, -4, -3], size: [1, 4, 6], colors: { all: '#e8e8e0' } },
    { name: 'leg0', pivot: [-1, 5, 0], from: [-1, -5, -1], size: [2, 5, 2], colors: { all: '#e0a020' } },
    { name: 'leg1', pivot: [1, 5, 0], from: [-1, -5, -1], size: [2, 5, 2], colors: { all: '#e0a020' } },
  ],
  anim: (m, e, alpha, time) => {
    animQuad(m, e, alpha, time);
    const fl = Math.abs(e.y - e.py) > 0.02 ? Math.sin(time * 1.2) * 0.8 : 0;
    const wl = m.part('wingL');
    const wr = m.part('wingR');
    if (wl) wl.rotation.z = -fl;
    if (wr) wr.rotation.z = fl;
  },
};
V.rabbit = {
  parts: () => [
    { name: 'body', pivot: [0, 4, 0], from: [-3, -2, -4], size: [6, 5, 8], colors: { all: '#9a6a48' } },
    { name: 'head', pivot: [0, 6, 3], from: [-2.5, 0, -1], size: [5, 4, 5], colors: { all: '#9a6a48' }, paint: (p) => {
      p.px('front', 0, 1, '#1a1a1a');
      p.px('front', 4, 1, '#1a1a1a');
      p.px('front', 2, 2, '#e8a0a0');
    } },
    { name: 'earL', parent: 'head', pivot: [1, 4, 1], from: [0, 0, 0], size: [1, 5, 2], colors: { all: '#9a6a48', front: '#e8a0a0' } },
    { name: 'earR', parent: 'head', pivot: [-2, 4, 1], from: [0, 0, 0], size: [1, 5, 2], colors: { all: '#9a6a48', front: '#e8a0a0' } },
    { name: 'leg0', pivot: [-2, 2, 3], from: [-1, -2, -1], size: [2, 2, 2], colors: { all: '#8a5a38' } },
    { name: 'leg1', pivot: [2, 2, 3], from: [-1, -2, -1], size: [2, 2, 2], colors: { all: '#8a5a38' } },
    { name: 'leg2', pivot: [-2, 2, -3], from: [-1, -2, -2], size: [2, 2, 4], colors: { all: '#8a5a38' } },
    { name: 'leg3', pivot: [2, 2, -3], from: [-1, -2, -2], size: [2, 2, 4], colors: { all: '#8a5a38' } },
    { name: 'tail', parent: 'body', pivot: [0, 1, -4], from: [-1, 0, -2], size: [2, 2, 2], colors: { all: '#f0e8e0' } },
  ],
  anim: (m, e, alpha, time) => {
    animQuad(m, e, alpha, time);
    m.root.position.y = e.limbSpeed > 0.1 ? Math.abs(Math.sin(walkPhase(e, alpha) * 0.8)) * 0.25 : 0;
  },
};
V.horse = {
  parts: () =>
    quadParts({
      body: [10, 10, 22],
      legH: 14,
      legW: 4,
      head: [6, 8, 12],
      headOffset: [12, -2],
      bodyColors: { all: '#8a5a30' },
      legColors: { all: '#7a4a28', bottom: '#2a2a2a' },
      headColors: { all: '#8a5a30' },
      face: (p) => {
        p.px('left', 2, 2, '#111111');
        p.px('right', 2, 2, '#111111');
      },
      tail: { size: [3, 12, 3], colors: { all: '#2a1a10' }, rot: 0.6 },
      ears: { size: [2, 3, 1], colors: { all: '#8a5a30' } },
    }).concat([{ name: 'mane', parent: 'head', pivot: [0, 4, -1], from: [-1, -2, -4], size: [2, 10, 6], colors: { all: '#2a1a10' } }]),
  anim: animQuad,
};
V.goat = {
  parts: () =>
    quadParts({
      body: [9, 10, 14],
      legH: 10,
      legW: 3,
      head: [5, 7, 8],
      headOffset: [5, -1],
      bodyColors: { all: '#d8d0c0' },
      legColors: { all: '#c8c0b0', bottom: '#4a3a2a' },
      headColors: { all: '#d8d0c0' },
      bodyPaint: (p) => p.speckle('all', '#b8b0a0', 0.2),
      face: (p) => {
        p.px('front', 1, 2, '#2a2a2a');
        p.px('front', 3, 2, '#2a2a2a');
      },
      horns: { all: '#a89878' },
    }).concat([{ name: 'beard', parent: 'head', pivot: [0, -3, 6], from: [-0.5, -3, 0], size: [1, 3, 1], colors: { all: '#b8b0a0' } }]),
  anim: animQuad,
};
V.fox = {
  parts: () =>
    quadParts({
      body: [6, 6, 12],
      legH: 6,
      legW: 2,
      head: [8, 6, 6],
      headOffset: [2, -1],
      bodyColors: { all: '#e07820', bottom: '#f4f0e8' },
      legColors: { all: '#2a1a10' },
      headColors: { all: '#e07820' },
      face: (p) => {
        p.px('front', 1, 2, '#1a1a1a');
        p.px('front', 6, 2, '#1a1a1a');
        p.px('front', 2, 4, '#f4f0e8', 4, 2);
      },
      snout: { size: [4, 2, 3], colors: { all: '#f4f0e8' } },
      ears: { size: [2, 2, 1], colors: { all: '#e07820' } },
      tail: { size: [4, 9, 4], colors: { all: '#e07820', bottom: '#f4f0e8' }, rot: 1.1 },
    }),
  anim: animQuad,
};
V.wolf = {
  variant: (e) => (e.meta.tame ? 'tame' : e.meta.angry ? 'angry' : 'wild'),
  parts: (e) =>
    quadParts({
      body: [6, 6, 12],
      legH: 8,
      legW: 2,
      head: [6, 6, 4],
      headOffset: [2, 0],
      bodyColors: { all: '#d8d4cc' },
      legColors: { all: '#c8c4bc' },
      headColors: { all: '#d8d4cc' },
      bodyPaint: (p) => p.speckle('all', '#b8b4ac', 0.15),
      face: (p) => {
        const col = e.meta.angry ? '#c01010' : '#1a1a1a';
        p.px('front', 1, 2, col);
        p.px('front', 4, 2, col);
      },
      snout: { size: [3, 3, 4], colors: { all: '#c8c4bc' }, y: -1 },
      ears: { size: [2, 2, 1], colors: { all: '#d8d4cc' } },
      tail: { size: [2, 8, 2], colors: { all: '#d8d4cc' }, rot: 0.6 },
    }).concat(e.meta.tame ? [{ name: 'collar', parent: 'body', pivot: [0, 0, 6], from: [-3.5, -3.5, -1], size: [7, 7, 1], colors: { all: '#c01010' } }] : []),
  anim: animSitQuad,
};
V.cat = {
  variant: (e) => String(e.meta.variant ?? 'tabby'),
  parts: (e) => {
    const v = String(e.meta.variant ?? 'tabby');
    const c = v === 'black' ? '#1a1a22' : v === 'siamese' ? '#f0e4cc' : v === 'ginger' ? '#e08830' : v === 'calico' ? '#f4f0e8' : '#8a7a60';
    const stripe = v === 'tabby' ? '#5a4a38' : v === 'ginger' ? '#b86010' : v === 'calico' ? '#d07020' : v === 'siamese' ? '#5a3a2a' : '#2a2a32';
    return quadParts({
      body: [4, 4, 12],
      legH: 6,
      legW: 2,
      head: [5, 4, 5],
      headOffset: [2, -1],
      bodyColors: { all: c },
      legColors: { all: c },
      headColors: { all: c },
      bodyPaint: (p) => p.speckle('all', stripe, 0.25),
      face: (p) => {
        p.px('front', 1, 1, '#48d848');
        p.px('front', 3, 1, '#48d848');
        p.px('front', 2, 2, '#e8a0a0');
      },
      ears: { size: [1, 2, 1], colors: { all: c } },
      tail: { size: [1, 8, 1], colors: { all: c }, rot: 0.9 },
    });
  },
  anim: animSitQuad,
};
V.polar_bear = {
  parts: () =>
    quadParts({
      body: [14, 14, 20],
      legH: 10,
      legW: 6,
      head: [8, 7, 7],
      headOffset: [2, 0],
      bodyColors: { all: '#f4f4f0' },
      legColors: { all: '#e8e8e4', bottom: '#3a3a3a' },
      headColors: { all: '#f4f4f0' },
      face: (p) => {
        p.px('front', 1, 2, '#1a1a1a');
        p.px('front', 6, 2, '#1a1a1a');
      },
      snout: { size: [4, 3, 3], colors: { all: '#e8e8e4', front: '#2a2a2a' } },
      ears: { size: [2, 2, 1], colors: { all: '#e8e8e4' } },
    }),
  anim: animQuad,
};
V.iron_golem = {
  parts: () => [
    { name: 'body', pivot: [0, 22, 0], from: [-9, 0, -6], size: [18, 12, 11], colors: { all: '#c8c0b4' }, paint: (p) => {
      p.speckle('all', '#a8a094', 0.2);
      p.speckle('front', '#5a8a2a', 0.08);
    } },
    { name: 'waist', parent: 'body', pivot: [0, 0, 0], from: [-4.5, -5, -3], size: [9, 5, 6], colors: { all: '#b8b0a4' } },
    { name: 'head', parent: 'body', pivot: [0, 12, -2], from: [-4, 0, -2.5], size: [8, 10, 8], colors: { all: '#d0c8bc' }, paint: (p) => {
      p.px('front', 1, 4, '#8a2a1a', 2, 1);
      p.px('front', 5, 4, '#8a2a1a', 2, 1);
      p.px('front', 3, 6, '#b8b0a4', 2, 4);
    } },
    { name: 'rightArm', parent: 'body', pivot: [-11, 10, 0], from: [-2, -28, -3], size: [4, 30, 6], colors: { all: '#c8c0b4' }, paint: (p) => p.speckle('all', '#6a9a2a', 0.06) },
    { name: 'leftArm', parent: 'body', pivot: [11, 10, 0], from: [-2, -28, -3], size: [4, 30, 6], colors: { all: '#c8c0b4' }, paint: (p) => p.speckle('all', '#6a9a2a', 0.06) },
    { name: 'rightLeg', pivot: [-4, 17, 0], from: [-3, -17, -2.5], size: [6, 17, 5], colors: { all: '#c0b8ac' } },
    { name: 'leftLeg', pivot: [4, 17, 0], from: [-3, -17, -2.5], size: [6, 17, 5], colors: { all: '#c0b8ac' } },
  ],
  anim: (m, e, alpha) => {
    const s = Math.sin(walkPhase(e, alpha) * 0.4) * 0.8 * e.limbSpeed;
    const rl = m.part('rightLeg');
    const ll = m.part('leftLeg');
    const ra = m.part('rightArm');
    const la = m.part('leftArm');
    if (rl) rl.rotation.x = s;
    if (ll) ll.rotation.x = -s;
    if (ra) ra.rotation.x = -s * 0.8;
    if (la) la.rotation.x = s * 0.8;
    if (e.swingTime > 0) {
      const t = Math.sin((1 - e.swingTime / 6) * Math.PI);
      if (ra) ra.rotation.x = -t * 2;
      if (la) la.rotation.x = -t * 2;
    }
    lookHead(m, e);
  },
  nameY: 3,
};

// ---------------------------------------------------------------- villagers
const PROF: Record<string, string> = { farmer: '#c8a040', librarian: '#e8e0d0', toolsmith: '#3a3a3a', cleric: '#8a2aa0', fisherman: '#3a6a9a', shepherd: '#f4f4f0', butcher: '#e8e8e8', mason: '#6a4a2a', none: '#4a7a3a' };
V.villager = {
  variant: (e) => String(e.meta.profession ?? 'none'),
  parts: (e) => {
    const robe = PROF[String(e.meta.profession ?? 'none')] ?? '#7a5a3a';
    return [
      { name: 'body', pivot: [0, 12, 0], from: [-4, 0, -3], size: [8, 12, 6], colors: { all: '#6a4a32' }, paint: (p) => p.fill('front', robe) },
      { name: 'robe', parent: 'body', pivot: [0, 0, 0], from: [-4, -12, -3], size: [8, 12, 6], inflate: 0.3, colors: { all: '#6a4a32', front: robe } },
      { name: 'head', parent: 'body', pivot: [0, 12, 0], from: [-4, 0, -4], size: [8, 10, 8], colors: { all: '#b8866a' }, paint: (p) => {
        p.px('front', 1, 4, '#ffffff');
        p.px('front', 2, 4, '#3a8a3a');
        p.px('front', 5, 4, '#3a8a3a');
        p.px('front', 6, 4, '#ffffff');
        p.px('front', 1, 3, '#4a3020', 6, 1);
      } },
      { name: 'nose', parent: 'head', pivot: [0, 2, 4], from: [-1, 0, 0], size: [2, 4, 2], colors: { all: '#a8765a' } },
      { name: 'arms', parent: 'body', pivot: [0, 9, 3], from: [-4, -6, -1], size: [8, 4, 4], rot: [-0.75, 0, 0], colors: { all: '#6a4a32' } },
      { name: 'rightLeg', pivot: [-2, 12, 0], from: [-2, -12, -2], size: [4, 12, 4], colors: { all: '#5a3a28' } },
      { name: 'leftLeg', pivot: [2, 12, 0], from: [-2, -12, -2], size: [4, 12, 4], colors: { all: '#5a3a28' } },
    ];
  },
  anim: (m, e, alpha) => {
    const s = Math.sin(walkPhase(e, alpha) * 0.6662) * 1.0 * e.limbSpeed;
    const rl = m.part('rightLeg');
    const ll = m.part('leftLeg');
    if (rl) rl.rotation.x = s;
    if (ll) ll.rotation.x = -s;
    lookHead(m, e);
    babyScale(m, e);
  },
  nameY: 2.3,
};
V.witch = {
  parts: () => [
    ...humanoidParts({
      head: { all: '#b8866a' },
      body: { all: '#3a1a4a' },
      arms: { all: '#3a1a4a', bottom: '#b8866a' },
      legs: { all: '#2a1030' },
      headSize: [8, 10, 8],
      face: (p) => {
        p.px('front', 1, 4, '#9a2a9a');
        p.px('front', 6, 4, '#9a2a9a');
        p.px('front', 3, 7, '#6a9a3a');
      },
    }),
    { name: 'nose', parent: 'head', pivot: [0, 3, 4], from: [-1, 0, 0], size: [2, 4, 2], colors: { all: '#a8765a' }, paint: (p) => p.px('front', 0, 3, '#5a8a2a') },
    { name: 'hatBrim', parent: 'head', pivot: [0, 10, 0], from: [-5, 0, -5], size: [10, 1, 10], colors: { all: '#2a1030' } },
    { name: 'hatTop', parent: 'head', pivot: [0, 11, 0], from: [-3, 0, -3], size: [6, 5, 6], colors: { all: '#2a1030' }, paint: (p) => p.px('front', 0, 4, '#6a3a8a', 6, 1) },
    { name: 'hatTip', parent: 'head', pivot: [0, 16, -1], from: [-1.5, 0, -1.5], size: [3, 3, 3], rot: [-0.3, 0, 0], colors: { all: '#2a1030' } },
  ],
  anim: animBiped,
};

// ---------------------------------------------------------------- undead & humanoid monsters
function zombieParts(skin: string, shirt: string, pants: string, eyesCol = '#1a1a1a'): KitPart[] {
  return humanoidParts({
    head: { all: skin },
    body: { all: shirt },
    arms: { all: skin, top: shirt },
    legs: { all: pants },
    face: (p) => {
      p.px('front', 1, 4, eyesCol, 2, 1);
      p.px('front', 5, 4, eyesCol, 2, 1);
      p.px('front', 2, 6, '#2a3a2a', 4, 1);
      p.speckle('all', 'rgba(0,0,0,0.15)', 0.1);
    },
    bodyPaint: (p) => p.speckle('front', 'rgba(0,0,0,0.25)', 0.2),
  });
}
V.zombie = { parts: () => zombieParts('#5a8a4a', '#2a8a9a', '#3a3a8a'), anim: animZombie };
V.husk = { parts: () => zombieParts('#9a8a60', '#6a5a3a', '#4a3a2a', '#3a2a1a'), anim: animZombie };
V.drowned = { parts: () => zombieParts('#4a8a8a', '#3a6a5a', '#2a4a6a', '#6af0f0'), anim: animZombie, glow: false };
V.glitch_zombie = {
  parts: () => zombieParts('#20a0a0', '#8a1a8a', '#1a1a4a', '#ff40ff').map((p) => (p.name === 'head' ? { ...p, paint: (fp: FacePainter) => {
    p.paint?.(fp);
    fp.speckle('all', '#ff00ff', 0.08);
    fp.speckle('all', '#00ffcc', 0.08);
  } } : p)),
  anim: animZombie,
  extra: glitchJitter,
};
function skeletonParts(bone: string, dark: string, eyesCol = '#1a1a1a'): KitPart[] {
  return humanoidParts({
    head: { all: bone },
    body: { all: bone },
    arms: { all: bone },
    legs: { all: bone },
    armW: 2,
    limbW: 2,
    face: (p) => {
      p.px('front', 1, 3, eyesCol, 2, 2);
      p.px('front', 5, 3, eyesCol, 2, 2);
      p.px('front', 3, 5, dark, 2, 1);
      p.px('front', 1, 6, dark, 6, 1);
    },
    bodyPaint: (p) => {
      for (let y = 1; y < 10; y += 2) p.px('front', 1, y, dark, 6, 1);
      p.px('front', 3, 0, bone, 2, 12);
    },
  });
}
V.skeleton = { parts: () => skeletonParts('#d8d8d0', '#6a6a64'), anim: animArcher };
V.stray = { parts: () => skeletonParts('#b8c8c8', '#5a6a6a').concat([{ name: 'cloak', parent: 'body', pivot: [0, 0, 0], from: [-4, -2, -2], size: [8, 14, 4], inflate: 0.4, colors: { all: '#6a8888' }, noise: 0.2 }]), anim: animArcher };
V.wither_skeleton = { parts: () => skeletonParts('#2a2a2a', '#0a0a0a', '#6a6a6a'), anim: animArcher, scale: 1.2 };
V.glitch_skeleton = { parts: () => skeletonParts('#d8d8d0', '#ff40ff', '#00ffcc'), anim: animArcher, extra: glitchJitter };
V.pillager = {
  parts: () =>
    humanoidParts({
      head: { all: '#a8a8a0' },
      body: { all: '#4a3a4a' },
      arms: { all: '#4a3a4a', bottom: '#a8a8a0' },
      legs: { all: '#2a2a3a' },
      headSize: [8, 10, 8],
      face: (p) => {
        p.px('front', 1, 4, '#1a1a1a', 6, 1);
        p.px('front', 2, 5, '#3a8a3a');
        p.px('front', 5, 5, '#3a8a3a');
      },
    }),
  anim: animArcher,
};
V.zombified_piglin = {
  parts: () => [
    ...humanoidParts({
      head: { all: '#e8a0a0' },
      body: { all: '#6a8a4a' },
      arms: { all: '#e8a0a0' },
      legs: { all: '#4a3a2a' },
      headSize: [10, 8, 8],
      face: (p) => {
        p.px('front', 2, 3, '#1a1a1a');
        p.px('front', 7, 3, '#e8e8e8');
        p.speckle('front', '#5a8a3a', 0.2);
      },
      bodyPaint: (p) => p.speckle('all', '#e8a0a0', 0.2),
    }),
    { name: 'snout', parent: 'head', pivot: [0, 2, 4], from: [-2, 0, 0], size: [4, 3, 1], colors: { all: '#d88888' } },
  ],
  anim: animZombie,
};
V.piglin = {
  parts: () => [
    ...humanoidParts({
      head: { all: '#e8a0a0' },
      body: { all: '#6a4a2a' },
      arms: { all: '#e8a0a0', top: '#6a4a2a' },
      legs: { all: '#4a3a2a' },
      headSize: [10, 8, 8],
      face: (p) => {
        p.px('front', 2, 3, '#1a1a1a');
        p.px('front', 7, 3, '#1a1a1a');
        p.px('front', 1, 7, '#f0e8a0', 2, 1);
        p.px('front', 7, 7, '#f0e8a0', 2, 1);
      },
      bodyPaint: (p) => p.px('front', 0, 8, '#f0c030', 8, 1),
    }),
    { name: 'snout', parent: 'head', pivot: [0, 2, 4], from: [-2, 0, 0], size: [4, 3, 1], colors: { all: '#d88888' } },
  ],
  anim: animBiped,
};
V.hoglin = {
  parts: () =>
    quadParts({
      body: [14, 12, 20],
      legH: 10,
      legW: 5,
      head: [12, 8, 12],
      headOffset: [0, 0],
      bodyColors: { all: '#c06850' },
      legColors: { all: '#a05840' },
      headColors: { all: '#c06850' },
      bodyPaint: (p) => p.speckle('top', '#f0d890', 0.3),
      face: (p) => {
        p.px('left', 3, 2, '#1a1a1a');
        p.px('right', 3, 2, '#1a1a1a');
      },
      horns: { all: '#f0e8d0' },
    }),
  anim: animQuad,
};
V.creeper = {
  variant: (e) => (e.meta.charged ? 'charged' : 'normal'),
  parts: () => [
    { name: 'body', pivot: [0, 6, 0], from: [-4, 0, -2], size: [8, 12, 4], colors: { all: '#4aa83a' }, noise: 0.35, paint: (p) => p.speckle('all', '#2a7a2a', 0.2) },
    { name: 'head', parent: 'body', pivot: [0, 12, 0], from: [-4, 0, -4], size: [8, 8, 8], colors: { all: '#4aa83a' }, noise: 0.35, paint: (p) => {
      p.speckle('all', '#2a7a2a', 0.2);
      p.px('front', 1, 2, '#0a0a0a', 2, 2);
      p.px('front', 5, 2, '#0a0a0a', 2, 2);
      p.px('front', 3, 4, '#0a0a0a', 2, 2);
      p.px('front', 2, 5, '#0a0a0a', 1, 3);
      p.px('front', 5, 5, '#0a0a0a', 1, 3);
    } },
    { name: 'leg0', pivot: [-2, 6, 4], from: [-2, -6, -2], size: [4, 6, 4], colors: { all: '#3a983a' } },
    { name: 'leg1', pivot: [2, 6, 4], from: [-2, -6, -2], size: [4, 6, 4], colors: { all: '#3a983a' } },
    { name: 'leg2', pivot: [-2, 6, -4], from: [-2, -6, -2], size: [4, 6, 4], colors: { all: '#3a983a' } },
    { name: 'leg3', pivot: [2, 6, -4], from: [-2, -6, -2], size: [4, 6, 4], colors: { all: '#3a983a' } },
  ],
  anim: (m, e, alpha, time) => {
    animQuad(m, e, alpha, time);
    const fuse = Number(e.meta.fuse ?? -1);
    const f = fuse > 0 ? fuse / 30 : 0;
    const sw = 1 + Math.sin(f * 100) * f * 0.01 + f * 0.25;
    m.root.scale.set(sw, 1 + f * 0.1, sw);
  },
  extra: (m, e, time) => {
    const fuse = Number(e.meta.fuse ?? -1);
    if (fuse > 0 && Math.floor(time / 3) % 2 === 0) m.material.color.setRGB(1.6, 1.6, 1.6);
  },
};
V.spider = {
  variant: (e) => e.type,
  parts: (e) => {
    const cave = e.type === 'cave_spider';
    const c = cave ? '#1a4a5a' : '#3a302a';
    const eye = '#e02020';
    const parts: KitPart[] = [
      { name: 'body', pivot: [0, 9, -6], from: [-5, -4, -12], size: [10, 8, 12], colors: { all: c }, paint: (p) => p.speckle('top', cave ? '#2a7a8a' : '#5a4a3a', 0.3) },
      { name: 'neck', pivot: [0, 9, 0], from: [-3, -3, -3], size: [6, 6, 6], colors: { all: c } },
      { name: 'head', pivot: [0, 9, 3], from: [-4, -4, 0], size: [8, 8, 8], colors: { all: c }, paint: (p) => {
        p.px('front', 1, 2, eye);
        p.px('front', 6, 2, eye);
        p.px('front', 2, 3, eye, 1, 1);
        p.px('front', 5, 3, eye, 1, 1);
        p.px('front', 3, 1, eye, 2, 1);
      } },
    ];
    for (let i = 0; i < 4; i++) {
      const z = 2 - i * 2;
      parts.push({ name: 'legL' + i, pivot: [3, 9, z], from: [0, -1, -1], size: [16, 2, 2], rot: [0, 0.3 - i * 0.2, -0.6], colors: { all: c } });
      parts.push({ name: 'legR' + i, pivot: [-3, 9, z], from: [-16, -1, -1], size: [16, 2, 2], rot: [0, -0.3 + i * 0.2, 0.6], colors: { all: c } });
    }
    return parts;
  },
  anim: (m, e, alpha) => {
    const w = walkPhase(e, alpha);
    for (let i = 0; i < 4; i++) {
      const ph = Math.sin(w * 1.2 + i * 1.3) * 0.3 * e.limbSpeed;
      const l = m.part('legL' + i);
      const r = m.part('legR' + i);
      if (l) l.rotation.y = 0.3 - i * 0.2 + ph;
      if (r) r.rotation.y = -0.3 + i * 0.2 - ph;
    }
    lookHead(m, e);
  },
};
V.cave_spider = { ...V.spider!, scale: 0.7 };
V.enderman = {
  parts: () => [
    { name: 'body', pivot: [0, 30, 0], from: [-4, 0, -2], size: [8, 12, 4], colors: { all: '#161616' } },
    { name: 'head', parent: 'body', pivot: [0, 12, 0], from: [-4, 0, -4], size: [8, 8, 8], colors: { all: '#161616' }, paint: (p) => {
      p.px('front', 0, 4, '#e080f0', 3, 1);
      p.px('front', 5, 4, '#e080f0', 3, 1);
      p.px('front', 1, 4, '#b040d0');
      p.px('front', 6, 4, '#b040d0');
    } },
    { name: 'rightArm', parent: 'body', pivot: [-5, 10, 0], from: [-1, -28, -1], size: [2, 30, 2], colors: { all: '#161616' } },
    { name: 'leftArm', parent: 'body', pivot: [5, 10, 0], from: [-1, -28, -1], size: [2, 30, 2], colors: { all: '#161616' } },
    { name: 'rightLeg', pivot: [-2, 30, 0], from: [-1, -30, -1], size: [2, 30, 2], colors: { all: '#161616' } },
    { name: 'leftLeg', pivot: [2, 30, 0], from: [-1, -30, -1], size: [2, 30, 2], colors: { all: '#161616' } },
  ],
  anim: (m, e, alpha) => {
    animateHumanoid(m, e, alpha);
    const head = m.part('head');
    if (head) head.position.y = (12 + (e.meta.angry === true ? 2 : 0)) / 16;
    m.root.position.x = e.meta.angry === true ? (Math.random() - 0.5) * 0.04 : 0;
  },
  nameY: 3.2,
};
V.slime = {
  variant: (e) => e.type,
  parts: (e) => {
    const magma = e.type === 'magma_cube';
    return [
      { name: 'outer', pivot: [0, 0, 0], from: [-4, 0, -4], size: [8, 8, 8], colors: { all: magma ? '#4a1a0a' : '#6ac85a' }, noise: 0.15, paint: (p) => {
        if (magma) p.speckle('all', '#f07020', 0.25);
        p.px('front', 1, 2, magma ? '#f0d020' : '#1a3a1a', 2, 2);
        p.px('front', 5, 2, magma ? '#f0d020' : '#1a3a1a', 2, 2);
        p.px('front', 3, 5, magma ? '#f0d020' : '#1a3a1a', 1, 1);
      } },
      { name: 'core', pivot: [0, 0, 0], from: [-3, 1, -3], size: [6, 6, 6], colors: { all: magma ? '#f09020' : '#4a9a3a' } },
    ];
  },
  anim: (m, e, alpha, time) => {
    const size = Number(e.meta.size ?? 1);
    const dy = e.y - e.py;
    const squish = dy > 0.05 ? 0.85 : dy < -0.05 ? 1.15 : 1;
    m.root.scale.set(size / squish ** 0.5, size * squish, size / squish ** 0.5);
    void alpha;
    void time;
  },
  transparent: true,
};
V.magma_cube = V.slime;
V.blaze = {
  parts: () => {
    const parts: KitPart[] = [
      { name: 'head', pivot: [0, 18, 0], from: [-4, 0, -4], size: [8, 8, 8], colors: { all: '#f0b020' }, paint: (p) => {
        p.speckle('all', '#f07010', 0.2);
        p.px('front', 1, 3, '#3a1a0a', 2, 1);
        p.px('front', 5, 3, '#3a1a0a', 2, 1);
      } },
    ];
    for (let i = 0; i < 12; i++) parts.push({ name: 'rod' + i, pivot: [0, 0, 0], from: [-1, 0, -1], size: [2, 8, 2], colors: { all: '#f0c040' }, paint: (p) => p.speckle('all', '#f07010', 0.3) });
    return parts;
  },
  anim: (m, e, alpha, time) => {
    for (let i = 0; i < 12; i++) {
      const r = m.part('rod' + i);
      if (!r) continue;
      const ring = Math.floor(i / 4);
      const a = time * (0.1 + ring * 0.05) * (ring === 1 ? -1 : 1) + (i % 4) * (Math.PI / 2);
      const rad = [9, 7, 5][ring]! / 16;
      r.position.set(Math.cos(a) * rad, (2 + ring * 6 + Math.sin(time * 0.1 + i) * 1) / 16 + 0.3, Math.sin(a) * rad);
    }
    lookHead(m, e);
    void alpha;
  },
  glow: true,
};
V.ghast = {
  parts: () => {
    const parts: KitPart[] = [
      { name: 'head', pivot: [0, 0, 0], from: [-8, 0, -8], size: [16, 16, 16], colors: { all: '#f0f0f0' }, paint: (p) => {
        p.speckle('all', '#d8d8d8', 0.15);
        p.px('front', 3, 5, '#5a5a5a', 3, 1);
        p.px('front', 10, 5, '#5a5a5a', 3, 1);
        p.px('front', 6, 10, '#3a3a3a', 4, 2);
      } },
    ];
    for (let i = 0; i < 9; i++) parts.push({ name: 'tentacle' + i, pivot: [((i % 3) - 1) * 5, 0, (Math.floor(i / 3) - 1) * 5], from: [-1, -9 - (i % 4) * 2, -1], size: [2, 9 + (i % 4) * 2, 2], colors: { all: '#e8e8e8' } });
    return parts;
  },
  anim: (m, e, alpha, time) => {
    for (let i = 0; i < 9; i++) {
      const t = m.part('tentacle' + i);
      if (t) t.rotation.x = Math.sin(time * 0.08 + i) * 0.3 + 0.2;
    }
    void alpha;
    void e;
  },
  scale: 4,
  nameY: 4.5,
};
V.silverfish = {
  parts: () => [
    { name: 'body', pivot: [0, 1.5, 0], from: [-2, -1.5, -5], size: [4, 3, 10], colors: { all: '#8a8a8a' }, paint: (p) => {
      for (let i = 0; i < 10; i += 2) p.px('top', 0, i, '#6a6a6a', 4, 1);
    } },
    { name: 'head', pivot: [0, 1.5, 5], from: [-1.5, -1, 0], size: [3, 2, 2], colors: { all: '#7a7a7a' } },
    { name: 'tail', pivot: [0, 1, -5], from: [-1, -1, -3], size: [2, 2, 3], colors: { all: '#7a7a7a' } },
  ],
  anim: (m, e, alpha, time) => {
    const b = m.part('body');
    if (b) b.rotation.y = Math.sin(time * 0.6) * 0.15 * e.limbSpeed;
    void alpha;
  },
};
V.shulker = {
  variant: (e) => (e.meta.open ? 'open' : 'closed'),
  parts: () => [
    { name: 'base', pivot: [0, 0, 0], from: [-8, 0, -8], size: [16, 8, 16], colors: { all: '#8a5a8a' }, noise: 0.15 },
    { name: 'lid', pivot: [0, 6, 0], from: [-8, 0, -8], size: [16, 10, 16], colors: { all: '#9a6a9a' }, noise: 0.15 },
    { name: 'head', pivot: [0, 6, 0], from: [-3, 0, -3], size: [6, 6, 6], colors: { all: '#e8d85a' }, paint: (p) => p.px('front', 1, 2, '#3a2a3a', 4, 1) },
  ],
  anim: (m, e, alpha, time) => {
    const lid = m.part('lid');
    const open = e.meta.angry === true ? 0.5 + Math.sin(time * 0.2) * 0.1 : 0.05;
    if (lid) lid.position.y = (6 + open * 16) / 16;
    void alpha;
  },
};
V.phantom = {
  parts: () => [
    { name: 'body', pivot: [0, 4, 0], from: [-3, -1.5, -5], size: [6, 3, 10], colors: { all: '#43518a' } },
    { name: 'head', pivot: [0, 4, 5], from: [-3.5, -1.5, 0], size: [7, 3, 5], colors: { all: '#43518a' }, paint: (p) => {
      p.px('front', 1, 1, '#88ff00');
      p.px('front', 5, 1, '#88ff00');
    } },
    { name: 'wingL', parent: 'body', pivot: [3, 1, 0], from: [0, 0, -4], size: [12, 1, 8], colors: { all: '#3a4478' } },
    { name: 'wingR', parent: 'body', pivot: [-3, 1, 0], from: [-12, 0, -4], size: [12, 1, 8], colors: { all: '#3a4478' } },
    { name: 'tail', parent: 'body', pivot: [0, 0, -5], from: [-1.5, -1, -6], size: [3, 2, 6], colors: { all: '#3a4478' } },
  ],
  anim: animFlyer,
};
V.bat = {
  parts: () => [
    { name: 'body', pivot: [0, 8, 0], from: [-3, -6, -2], size: [6, 10, 4], colors: { all: '#4a3a2a' } },
    { name: 'head', pivot: [0, 12, 0], from: [-3, 0, -3], size: [6, 5, 5], colors: { all: '#4a3a2a' }, paint: (p) => {
      p.px('front', 1, 2, '#1a1a1a');
      p.px('front', 4, 2, '#1a1a1a');
    } },
    { name: 'wingL', parent: 'body', pivot: [3, 2, 0], from: [0, -6, 0], size: [10, 10, 1], colors: { all: '#2a2018' } },
    { name: 'wingR', parent: 'body', pivot: [-3, 2, 0], from: [-10, -6, 0], size: [10, 10, 1], colors: { all: '#2a2018' } },
  ],
  anim: (m, e, alpha, time) => {
    const flap = Math.sin(time * 1.4 + e.id) * 0.9;
    const wl = m.part('wingL');
    const wr = m.part('wingR');
    if (wl) wl.rotation.y = flap;
    if (wr) wr.rotation.y = -flap;
    void alpha;
  },
  scale: 0.5,
};
V.squid = {
  parts: () => {
    const parts: KitPart[] = [{ name: 'body', pivot: [0, 8, 0], from: [-6, 0, -6], size: [12, 16, 12], colors: { all: '#2a4a6a' }, paint: (p) => {
      p.speckle('all', '#3a5a7a', 0.2);
      p.px('front', 3, 12, '#ffffff', 2, 2);
      p.px('front', 7, 12, '#ffffff', 2, 2);
    } }];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push({ name: 'arm' + i, pivot: [Math.cos(a) * 5, 8, Math.sin(a) * 5], from: [-1, -18, -1], size: [2, 18, 2], colors: { all: '#2a3a5a' } });
    }
    return parts;
  },
  anim: (m, e, alpha, time) => {
    for (let i = 0; i < 8; i++) {
      const a = m.part('arm' + i);
      if (a) a.rotation.x = Math.sin(time * 0.15 + i) * 0.25;
    }
    void alpha;
    void e;
  },
  scale: 0.6,
};
V.fish = {
  variant: (e) => e.type,
  parts: (e) => {
    const salmon = e.type === 'salmon';
    const c = salmon ? '#a03020' : '#b89a60';
    return [
      { name: 'body', pivot: [0, 3, 0], from: [-1.5, -2, -4], size: [3, 4, salmon ? 10 : 7], colors: { all: c }, paint: (p) => p.speckle('all', salmon ? '#3a8a7a' : '#8a7040', 0.2) },
      { name: 'head', pivot: [0, 3, salmon ? 6 : 3], from: [-1, -1.5, 0], size: [2, 3, 2], colors: { all: c }, paint: (p) => p.px('left', 0, 0, '#1a1a1a') },
      { name: 'tail', pivot: [0, 3, -4], from: [0, -2, -4], size: [0.5, 4, 4], colors: { all: c } },
    ];
  },
  anim: animSwim,
};

// ---------------------------------------------------------------- original mobs
V.cave_stalker = {
  parts: () => [
    ...humanoidParts({
      head: { all: '#1d1f2b' },
      body: { all: '#1d1f2b' },
      arms: { all: '#161823' },
      legs: { all: '#161823' },
      armW: 3,
      limbW: 3,
      tall: 6,
      headSize: [7, 9, 7],
      face: (p) => {
        // No eyes: a faint glowing seam
        p.px('front', 1, 5, '#9ef0ff', 5, 1);
        p.speckle('all', '#2a2e40', 0.25);
      },
      bodyPaint: (p) => {
        for (let y = 1; y < 11; y += 3) p.px('front', 2, y, '#9ef0ff', 4, 1);
      },
    }),
    { name: 'spine', parent: 'body', pivot: [0, 10, -2], from: [-1, -8, -2], size: [2, 10, 2], colors: { all: '#3a4058' } },
  ],
  anim: (m, e, alpha) => {
    animateHumanoid(m, e, alpha, { armsForward: e.meta.angry === true });
    const body = m.part('body');
    if (body) body.rotation.x = 0.35;
  },
  nameY: 2.5,
  glow: true,
};
V.sky_ray = {
  parts: () => [
    { name: 'body', pivot: [0, 4, 0], from: [-5, -2, -8], size: [10, 3, 16], colors: { all: '#6fa9d8', bottom: '#f4f9ff' }, paint: (p) => p.speckle('top', '#a8d8f8', 0.2) },
    { name: 'head', pivot: [0, 4, 8], from: [-3, -1.5, 0], size: [6, 3, 3], colors: { all: '#5f99c8' }, paint: (p) => {
      p.px('front', 0, 1, '#1a2a3a');
      p.px('front', 5, 1, '#1a2a3a');
    } },
    { name: 'wingL', parent: 'body', pivot: [5, 0, 0], from: [0, -0.5, -6], size: [14, 1, 12], colors: { all: '#6fa9d8', bottom: '#f4f9ff' } },
    { name: 'wingR', parent: 'body', pivot: [-5, 0, 0], from: [-14, -0.5, -6], size: [14, 1, 12], colors: { all: '#6fa9d8', bottom: '#f4f9ff' } },
    { name: 'tail', parent: 'body', pivot: [0, 0, -8], from: [-0.5, -0.5, -14], size: [1, 1, 14], colors: { all: '#4f89b8' } },
  ],
  anim: (m, e, alpha, time) => {
    const flap = Math.sin(time * 0.2 + e.id) * 0.5;
    const wl = m.part('wingL');
    const wr = m.part('wingR');
    if (wl) wl.rotation.z = flap;
    if (wr) wr.rotation.z = -flap;
    const tail = m.part('tail');
    if (tail) tail.rotation.y = Math.sin(time * 0.1) * 0.3;
    void alpha;
  },
};
V.ember_beast = {
  parts: () =>
    quadParts({
      body: [12, 10, 20],
      legH: 10,
      legW: 4,
      head: [8, 8, 9],
      headOffset: [2, 0],
      bodyColors: { all: '#3a1206' },
      legColors: { all: '#2a0a04', bottom: '#ff7a1a' },
      headColors: { all: '#3a1206' },
      bodyPaint: (p) => {
        p.speckle('all', '#ff7a1a', 0.15);
        p.speckle('top', '#ffd040', 0.1);
      },
      face: (p) => {
        p.px('front', 1, 2, '#ffd040', 2, 1);
        p.px('front', 5, 2, '#ffd040', 2, 1);
        p.px('front', 2, 6, '#ff5010', 4, 1);
      },
      tail: { size: [3, 10, 3], colors: { all: '#ff7a1a' }, rot: 0.9 },
      horns: { all: '#1a0a04' },
    }),
  anim: animQuad,
  glow: true,
};
V.rift_walker = {
  parts: () =>
    humanoidParts({
      head: { all: '#120a24' },
      body: { all: '#120a24' },
      arms: { all: '#0a0618' },
      legs: { all: '#0a0618' },
      armW: 3,
      limbW: 3,
      tall: 8,
      face: (p) => {
        p.px('front', 2, 3, '#d13fff', 1, 3);
        p.px('front', 5, 3, '#d13fff', 1, 3);
        p.speckle('all', '#3a1a5a', 0.2);
      },
      bodyPaint: (p) => p.speckle('all', '#d13fff', 0.06),
    }),
  anim: (m, e, alpha) => {
    animateHumanoid(m, e, alpha, { armsForward: e.meta.angry === true });
  },
  extra: glitchJitter,
  nameY: 2.8,
};
V.wanderer = {
  parts: () =>
    humanoidParts({
      head: { all: '#5b6f72' },
      body: { all: '#4a5a6a' },
      arms: { all: '#5b6f72', top: '#4a5a6a' },
      legs: { all: '#3a4a5a' },
      face: (p) => {
        p.px('front', 1, 3, '#ff40ff', 2, 1);
        p.px('front', 5, 3, '#00ffcc', 2, 1);
        p.speckle('all', '#7a8f92', 0.2);
      },
      bodyPaint: (p) => p.speckle('all', '#ff40ff', 0.05),
      hat: { all: 'rgba(0,0,0,0)', top: '#3a4a5a' },
    }),
  anim: animBiped,
  extra: glitchJitter,
};
V.void_wisp = {
  parts: () => [
    { name: 'core', pivot: [0, 4, 0], from: [-2, -2, -2], size: [4, 4, 4], colors: { all: '#9a4dff' } },
    { name: 'shell', pivot: [0, 4, 0], from: [-3, -3, -3], size: [6, 6, 6], colors: { all: '#05030a' }, paint: (p) => p.speckle('all', '#9a4dff', 0.2) },
  ],
  anim: (m, e, alpha, time) => {
    const s = m.part('shell');
    if (s) s.rotation.set(time * 0.05, time * 0.08, 0);
    void alpha;
    void e;
  },
  glow: true,
  transparent: true,
};
V.glitch_beast = {
  parts: () => [
    { name: 'body', pivot: [0, 30, 0], from: [-12, 0, -8], size: [24, 18, 16], colors: { all: '#0b0b12' }, paint: (p) => {
      p.speckle('all', '#00ffd0', 0.08);
      p.speckle('all', '#ff00ff', 0.06);
    } },
    { name: 'head', parent: 'body', pivot: [0, 18, 4], from: [-7, 0, -6], size: [14, 12, 14], colors: { all: '#0b0b12' }, paint: (p) => {
      p.px('front', 2, 4, '#00ffd0', 4, 2);
      p.px('front', 8, 4, '#ff00ff', 4, 2);
      p.px('front', 3, 9, '#ffffff', 8, 1);
      p.speckle('all', '#00ffd0', 0.08);
    } },
    { name: 'rightArm', parent: 'body', pivot: [-15, 16, 0], from: [-3, -30, -3], size: [6, 32, 6], colors: { all: '#12121c' }, paint: (p) => p.speckle('all', '#00ffd0', 0.1) },
    { name: 'leftArm', parent: 'body', pivot: [15, 16, 0], from: [-3, -30, -3], size: [6, 32, 6], colors: { all: '#12121c' }, paint: (p) => p.speckle('all', '#ff00ff', 0.1) },
    { name: 'rightLeg', pivot: [-6, 30, 0], from: [-4, -30, -4], size: [8, 30, 8], colors: { all: '#0b0b12' } },
    { name: 'leftLeg', pivot: [6, 30, 0], from: [-4, -30, -4], size: [8, 30, 8], colors: { all: '#0b0b12' } },
  ],
  anim: (m, e, alpha) => {
    animateHumanoid(m, e, alpha, { armsForward: e.meta.angry === true });
  },
  extra: glitchJitter,
  glow: true,
  nameY: 4.2,
};

function glitchJitter(m: BoxModel, e: ClientEntity, time: number): void {
  const t = Math.floor(time / 2);
  const glitch = ((t * 7919 + e.id * 104729) % 97) < 6;
  m.root.position.x = glitch ? ((t % 3) - 1) * 0.08 : 0;
  m.root.position.z = glitch ? (((t >> 1) % 3) - 1) * 0.08 : 0;
  if (glitch) m.material.color.setRGB(0.8, 1.3, 1.3);
}

// ---------------------------------------------------------------- registration
function makeVisual(def: MobVisualDef, e: ClientEntity, ctx: VisualContext): EntityVisual {
  const variant = def.variant ? def.variant(e) : e.type;
  const kit = kitModel(`mob:${e.type}:${variant}`, def.parts(e), def.scale ?? 1);
  const model = new BoxModel(kit.def, kit.texture, { transparent: def.transparent });
  const name = typeof e.meta.name === 'string' ? e.meta.name : undefined;
  const visual = boxVisual(
    model,
    (m, ent, alpha, time) => {
      def.anim(m, ent, alpha, time);
      def.extra?.(m, ent, time);
      // Burning mobs flicker orange
      if (ent.meta.fire === true && Math.floor(time / 4) % 2 === 0) m.material.color.multiply(new THREE.Color(1.3, 0.8, 0.5));
    },
    { name, nameY: def.nameY ?? 2.1 },
  );
  // Held item in the right hand
  const held = Number(e.meta.held ?? 0);
  const arm = model.part('rightArm');
  let heldMat: THREE.MeshBasicMaterial | null = null;
  if (held && arm) {
    const tex = new THREE.CanvasTexture(ctx.icons.render(held));
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    heldMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), heldMat);
    const armLen = Math.abs(kit.def.parts.find((p) => p.name === 'body')?.children?.find((c) => c.name === 'rightArm')?.from[1] ?? -10) / 16;
    plane.position.set(0, -armLen + 0.05, 0.25);
    plane.rotation.set(-Math.PI / 2 + 0.4, Math.PI / 2, 0);
    arm.add(plane);
  }
  const baseSet = visual.setBrightness.bind(visual);
  visual.setBrightness = (v) => {
    const b = def.glow ? Math.max(v, 0.85) : v;
    baseSet(b);
    heldMat?.color.setScalar(b);
  };
  const baseDispose = visual.dispose.bind(visual);
  visual.dispose = () => {
    baseDispose();
    heldMat?.map?.dispose();
    heldMat?.dispose();
  };
  return visual;
}

for (const m of MOB_DEFS) {
  const def = V[m.model];
  if (!def) continue;
  registerVisual(m.id, (e, ctx) => makeVisual(def, e, ctx));
}
