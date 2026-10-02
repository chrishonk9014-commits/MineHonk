/**
 * V6 - The End Expansion, phase 4: the five End quests.
 *
 * None is main story; any order. Each is a V4-style structure quest: the
 * structure's plan records where its parts are (Start.quest, a QuestSpec of
 * kind 'end'), the server checks every step (src/server/systems/EndQuests.ts),
 * progress lives in the level's quest records (`level.quests.end`) and the
 * next step shows in the quest tracker.
 *
 * - THE LOST OBSERVATORY: any End Observatory or the Void Observatory. Find
 *   the dormant Ancient Lens, repair it, power it (256 EU/t for 30 s), look
 *   through the telescope.
 * - THE BROKEN GATEWAY: any broken portal. Repair it, follow the map to its
 *   pair (seed-determined, far away in the band), repair that, step through.
 * - THE SILENT CITY: the Fallen City (or, with none near the arrival island,
 *   the nearest End Settlement). Find the sealed hall, the four Ancient Key
 *   Shards hidden in the city, make the Ancient Key, open the hall, take the
 *   Silent Bell.
 * - THE CRYSTAL VAULT: an End Palace's sealed vault. Four crystals on four
 *   pedestals, powered by Crystal Generators, open it; its Bulwark wakes.
 * - THE DRAGON'S HISTORY: the Dragon's Nest. Read its five fragments, find
 *   three more about the Dragon, gather four Dragon Scale Fragments, repair
 *   the Nest's own portal with them: it opens one way into the Sanctum.
 */
import type { BlockDef } from '../registry/blockTypes';
import type { ItemDef } from '../registry/itemTypes';
import type { Box } from '../gen/structures/manager';

type P3 = [number, number, number];

export type EndQuestId = 'lost_observatory' | 'broken_gateway' | 'silent_city' | 'crystal_vault' | 'dragons_history';

export interface EndQuestInfo {
  id: EndQuestId;
  title: string;
  /** Structures it starts at. */
  where: string;
  /** Steps (shown one at a time in the tracker). */
  steps: string[];
  reward: string;
}

export const END_QUESTS: readonly EndQuestInfo[] = [
  {
    id: 'lost_observatory',
    title: 'THE LOST OBSERVATORY',
    where: 'Any End Observatory, or the Void Observatory',
    steps: ['Find the observatory\'s dormant Ancient Lens.', 'Repair the lens (8 Ancient Fragments).', 'Power the telescope: 256 EU/t for 30 seconds, cabled to its foot.', 'Look through the telescope.'],
    reward: 'An Ancient Map to the nearest giant structure you haven\'t found (once a day), 2 Astral Shards and a star chart.',
  },
  {
    id: 'broken_gateway',
    title: 'THE BROKEN GATEWAY',
    where: 'Any broken portal (End Ruins, the Fallen City)',
    steps: ['Inspect the broken portal.', 'Repair its frame (12 Ancient End Bricks and an End Crystal).', 'Follow the map to its pair.', 'Repair the pair.', 'Step through.'],
    reward: 'A permanent ancient gateway between the two (and, the first time, a fragment about the gateways).',
  },
  {
    id: 'silent_city',
    title: 'THE SILENT CITY',
    where: 'The Fallen City (or an End Settlement, in a world with no Fallen City near)',
    steps: ['Find the city\'s sealed hall.', 'Collect the four Ancient Key Shards hidden in the city.', 'Combine them into the Ancient Key.', 'Open the sealed hall and recover what is inside.'],
    reward: 'The Ancient Key (it also opens the End Fortress\'s inner keep and the End Library\'s archive) and the Silent Bell.',
  },
  {
    id: 'crystal_vault',
    title: 'THE CRYSTAL VAULT',
    where: 'An End Palace\'s sealed crystal vault',
    steps: ['Inspect the vault door.', 'Place an End Crystal on each of the four pedestals.', 'Power the pedestals from a Crystal Generator.', 'Survive the vault\'s Bulwark.'],
    reward: 'The vault\'s hoard (Astral Shards, Ender Alloy gear) and, the first vault you clear, the Ender Blink Elytra upgrade.',
  },
  {
    id: 'dragons_history',
    title: 'THE DRAGON\'S HISTORY',
    where: 'The Dragon\'s Nest',
    steps: ['Read the Nest\'s five fragments.', 'Find three more fragments about the Dragon.', 'Gather four Dragon Scale Fragments.', 'Repair the Nest\'s broken portal with them.'],
    reward: 'The way into the Sanctum: a Dragon Scale (Void Recovery) and a last fragment.',
  },
];

export const END_QUEST_IDS = END_QUESTS.map((q) => q.id);

/** Costs and numbers. */
export const QUEST = {
  /** Lost Observatory: Ancient Fragments to repair a lens; EU/t and ticks to wake it; ticks between looks (an in-game day). */
  lensFragments: 8,
  lensEU: 256,
  lensTicks: 600,
  lookEvery: 24000,
  /** Broken Gateway: bricks and crystals per repair; how near the pair counts as reaching it. */
  frameBricks: 12,
  frameCrystals: 1,
  pairNear: 16,
  /** Restoring an Ancient Core. */
  coreFragments: 8,
  coreShards: 1,
  /** Silent City: shards hidden; hosts: a settlement stands in when no Fallen City lies within this of the arrival island. */
  shards: 4,
  fallenCityRange: 4000,
  /** Silent Bell: radius, freeze ticks, cooldown ticks. */
  bellRadius: 64,
  bellTicks: 200,
  bellCooldown: 6000,
  /** Crystal Vault: pedestals, EU/t each, ticks between the crystals lighting. */
  pedestals: 4,
  pedestalEU: 64,
  lightEvery: 20,
  /** Dragon's History: Dragon fragments (beyond the Nest's five) and scale fragments. */
  dragonFragments: 3,
  scales: 4,
} as const;

/**
 * Where a broken portal is: the builder frame it was laid out in
 * (origin, rotation, footprint) and its frame inside that (inner w x h).
 */
export interface PortalSite {
  b: [ox: number, oy: number, oz: number, rot: number, sx: number, sz: number];
  at: [x0: number, y0: number, z: number];
  w: number;
  h: number;
}

/** A sealed room some key or quest opens: its door blocks and the room behind them. */
export interface SealSpec {
  kind: 'archive' | 'keep' | 'vault';
  door: P3[];
  room: Box;
}

/** The phase 4 quest data a structure's plan records (positions in world coordinates). */
export interface EndQuestSpec {
  kind: 'end';
  /** Lost Observatory: the telescope's lens, the core at its foot, and the conduits a repair puts back into its tube. */
  lens?: { lens: P3; core: P3; mend: P3[]; disc?: P3[] };
  /** Broken portals (the Broken Gateway). */
  portals?: PortalSite[];
  /** Dormant Ancient Cores that can be restored (giant structures: one per structure). */
  cores?: P3[];
  /** Sealed rooms: a library's archive, a fortress's inner keep, a palace's crystal vault. */
  seals?: SealSpec[];
  /** Crystal Vault: the four pedestal spots and where its Bulwark wakes. */
  vault?: { pedestals: P3[]; bulwark: P3 };
  /** Silent City: where the sealed hall stands (the middle of its floor) and where the shards hide. */
  silent?: { hall: P3; spots: P3[] };
}

const rotXZ = (b: PortalSite['b'], x: number, z: number): [number, number] => {
  const [ox, , oz, rot, sx, sz] = b;
  switch (rot & 3) {
    case 0:
      return [ox + x, oz + z];
    case 1:
      return [ox + (sz - 1 - z), oz + x];
    case 2:
      return [ox + (sx - 1 - x), oz + (sz - 1 - z)];
    default:
      return [ox + z, oz + (sx - 1 - x)];
  }
};

export interface PortalCells {
  /** Frame blocks (corners first) and the sheet inside it, world positions. */
  frame: P3[];
  corners: P3[];
  sheet: P3[];
  axis: 'x' | 'z';
  /** The sheet's middle, at its bottom. */
  base: P3;
  /** A horizontal unit step away from the sheet's face (either side works). */
  normal: [number, number];
}

/** The world blocks of a broken portal. */
export function portalCells(s: PortalSite): PortalCells {
  const frame: P3[] = [];
  const corners: P3[] = [];
  const sheet: P3[] = [];
  const [x0, y0, z] = s.at;
  const oy = s.b[1];
  for (let y = 0; y <= s.h + 1; y++)
    for (let x = 0; x <= s.w + 1; x++) {
      const [wx, wz] = rotXZ(s.b, x0 + x, z);
      const p: P3 = [wx, oy + y0 + y, wz];
      const edge = x === 0 || x === s.w + 1 || y === 0 || y === s.h + 1;
      const corner = (x === 0 || x === s.w + 1) && (y === 0 || y === s.h + 1);
      if (corner) corners.push(p);
      if (edge) frame.push(p);
      else sheet.push(p);
    }
  const axis = s.b[3] & 1 ? 'z' : 'x';
  const mid = Math.floor((s.w + 1) / 2);
  const [bx, bz] = rotXZ(s.b, x0 + mid, z);
  return { frame, corners, sheet, axis, base: [bx, oy + y0 + 1, bz], normal: axis === 'x' ? [0, 1] : [1, 0] };
}

/** A portal's identity: its sheet's base position. */
export function portalKey(s: PortalSite): string {
  const b = portalCells(s).base;
  return `${b[0]},${b[1]},${b[2]}`;
}

/**
 * Seed-determined pairs over the whole band: every broken portal, sorted by
 * where it lies round the band (its angle about the End's centre, starting
 * from `turn`, the seed's choice), is paired with the one `k` places on (k
 * is a sixteenth of them, so the two ends of a pair lie about a sixteenth of
 * the way round the band apart: some thousands of blocks). Pairing is
 * symmetric. What doesn't fill a whole run of 2k pairs off with its
 * neighbour; with an odd count, the last one has no pair (it stays a dead
 * portal).
 */
export function pairPortals(portals: { key: string; x: number; z: number }[], turn = 0): Map<string, string | null> {
  const ang = (p: { x: number; z: number }): number => {
    const a = Math.atan2(p.z, p.x) - turn;
    return ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  };
  const sorted = [...portals].sort((a, b) => ang(a) - ang(b) || (a.key < b.key ? -1 : 1));
  const n = sorted.length;
  const out = new Map<string, string | null>();
  const k = Math.max(1, Math.floor(n / 16));
  const block = 2 * k;
  const full = Math.floor(n / block) * block;
  for (let i = 0; i < full; i++) {
    const j = i % block < k ? i + k : i - k;
    out.set(sorted[i]!.key, sorted[j]!.key);
  }
  for (let i = full; i + 1 < n; i += 2) {
    out.set(sorted[i]!.key, sorted[i + 1]!.key);
    out.set(sorted[i + 1]!.key, sorted[i]!.key);
  }
  if ((n - full) % 2 === 1) out.set(sorted[n - 1]!.key, null);
  return out;
}

/** Blocks of the quests (appended after the transport blocks). */
export function questBlockDefs(): BlockDef[] {
  return [
    // Where the Silent City hides its key shards: an old urn, sealed until someone opens it
    { id: 'ancient_reliquary', name: 'Ancient Reliquary', hardness: -1, resistance: 3600000, sound: 'stone', model: 'custom', props: { open: ['false', 'true'] }, tex: { all: 'ancient_reliquary', top: 'ancient_reliquary_top', on: 'ancient_reliquary_open' }, light: 3, drops: 'none', creative: 'hidden', item: false, mapColor: 0x8a7a5a },
  ];
}

export function questItemDefs(): ItemDef[] {
  return [
    { id: 'ancient_key', name: 'Ancient Key', maxStack: 1, rarity: 'epic', creative: 'tools', tooltip: 'Four shards made whole. It opens what was sealed.' },
    { id: 'silent_bell', name: 'Silent Bell', maxStack: 1, use: 'silent_bell', rarity: 'epic', creative: 'tools', tooltip: 'Ring it: every Guardian Construct within 64 blocks stands still for 10 seconds. 5 minutes to ring again.' },
  ];
}
