/**
 * V7 - The Halloween Update, phase 2: costume heads (plain data: the block
 * registry reads these, so nothing here may import it).
 *
 * Four heads, each a small block (8 x 8 x 8 pixels) that faces the player who
 * places it, stands on top of a block (a fence post is fine) and drops
 * itself. Worn in the helmet slot, a head (or a carved pumpkin) is drawn on
 * the player in place of their own, for every other player to see. None can
 * be crafted:
 *  - Skeleton Skull, Zombie Head, Creeper Head: found on fence posts by the
 *    doors of Trick-or-Treat Villages (and in Abandoned Villages' chests);
 *  - Herobrine Head: not found anywhere yet (creative and the Admin Panel);
 *    trick-or-treating (phase 3) gives it out.
 */
import type { BlockDef } from '../registry/blockTypes';

export interface CostumeHead {
  id: string;
  name: string;
  /** The mob it is the head of (who it fools when worn). */
  mob: string;
  look: string;
  mapColor: number;
}

export const COSTUME_HEADS: readonly CostumeHead[] = [
  { id: 'skeleton_skull', name: 'Skeleton Skull', mob: 'skeleton', look: 'Bleached bone, two dark sockets and a grin.', mapColor: 0xd8d4c4 },
  { id: 'zombie_head', name: 'Zombie Head', mob: 'zombie', look: 'Green, sunken-eyed and not very fresh.', mapColor: 0x4a8a3a },
  { id: 'creeper_head', name: 'Creeper Head', mob: 'creeper', look: 'Mottled green, with that famous frown.', mapColor: 0x5cb048 },
  { id: 'herobrine_head', name: 'Herobrine Head', mob: 'herobrine', look: 'Brown hair, a blue shirt collar, and eyes that glow white.', mapColor: 0x6a4a2a },
];

export const HEAD_IDS: readonly string[] = COSTUME_HEADS.map((h) => h.id);

/** Everything worn in the helmet slot that is a block: the four heads and a carved pumpkin. */
export const WEARABLE_BLOCKS: readonly string[] = [...HEAD_IDS, 'carved_pumpkin'];

/** Which mob a worn head belongs to (its sight of the wearer is halved, as with Minecraft's heads). */
export const HEAD_MOB: Readonly<Record<string, string>> = Object.fromEntries(COSTUME_HEADS.map((h) => [h.id, h.mob]));

/** The head's box, in pixels: centred, on the floor of its block. */
export const HEAD_BOX = { from: [4, 0, 4] as [number, number, number], to: [12, 8, 12] as [number, number, number] };

/** The block registry's entries (appended in their own V7 section, after the pumpkins). */
export function headBlockDefs(): BlockDef[] {
  return COSTUME_HEADS.map((h) => ({
    id: h.id,
    name: h.name,
    hardness: 1,
    sound: h.id === 'skeleton_skull' ? 'bone' : 'stone',
    model: 'custom',
    props: { facing: ['north', 'south', 'west', 'east'] },
    tex: { all: h.id + '_side', front: h.id + '_front', top: h.id + '_top', back: h.id + '_back', bottom: h.id + '_bottom', particle: h.id + '_side' },
    layer: 'cutout',
    opacity: 0,
    place: 'needs_solid_below',
    mapColor: h.mapColor,
    creative: 'halloween',
    data: { tooltip: 'Halloween: wear it as a costume.', wearable: true },
  })) as BlockDef[];
}
