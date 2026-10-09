/**
 * The Update Log's V6 entry: everything in The End Expansion, and the new
 * browser multiplayer. Pictures are screenshots of the game itself
 * (public/updatelog/v6, made by tools/update-log/); item icons, recipes,
 * advancements, biomes and structures come straight from the game's data,
 * so they always match what is in the game.
 */
import { EXPANSION_BIOMES } from '../../common/endExpansion/biomes';
import { END_VARIANTS, GIANT_STRUCTURES } from '../../common/endExpansion/structures';
import type { UpdateEntry, Card } from './updateLog';

const BIOME_NAME = new Map(EXPANSION_BIOMES.map((b) => [b.id, b.name]));
const biomeList = (ids: string[]): string => ids.map((id) => BIOME_NAME.get(id) ?? id).join(', ');

/** What lives in, and what is mined from, each biome (shown on its card). */
const BIOME_NOTES: Record<string, string> = {
  end_barrens: 'Ores: none. Mobs: Void Stalkers.',
  shattered_end: 'Ore: Ancient End Fragment. Mobs: Void Stalkers.',
  astral_end: 'Ore: Astral Ore. Mobs: End Phantoms (8,000+ blocks out).',
  highlands: 'Ore: Ender Ore, deep down. Mobs: Endlings.',
  end_crystal_fields: 'End Crystal Clusters. Mobs: End Crystal Mites.',
  chorus_forest: 'Chorus wood. Mobs: Endlings, Chorus Beasts.',
  void_wastes: 'Ore: Void Crystal Ore. Mobs: Void Stalkers, End Phantoms.',
};

const biomeCards: Card[] = EXPANSION_BIOMES.map((b) => ({ img: `biome-${b.id}`, title: b.name, text: b.description, meta: BIOME_NOTES[b.id] }));

const variantCards: Card[] = END_VARIANTS.map((v) => ({
  img: `structure-${v.id}`,
  title: v.name,
  text: v.size + '.',
  meta: `Biomes: ${biomeList(v.biomes)}. Guards: ${v.guards}. Loot: ${v.loot}.`,
}));

const giantCards: Card[] = GIANT_STRUCTURES.map((g) => ({
  img: `structure-${g.id}`,
  title: g.name,
  text: g.what + '.',
  meta: `Biomes: ${biomeList(Object.keys(g.biomes))}. Inside: ${g.inside}.`,
}));

export const V6_LOG: UpdateEntry = {
  version: 'V6',
  name: 'The End Expansion',
  tagline: 'A whole new End beyond the dragon, and multiplayer without servers.',
  hero: 'title-expanded-end',
  sections: [
    // ------------------------------------------------------------------ overview
    {
      id: 'overview',
      title: 'Overview',
      icon: 'end_crystal',
      blocks: [
        {
          k: 'p',
          text: "The End is no longer where the game stops. Defeat the Ender Dragon and a new portal opens on the main island. It leads to the **Expanded End**: a ring of seven new biomes thousands of blocks out, with new creatures, resources, cities, giant ruins, machines, quests and weather, a six-floor tower hanging into the void, and a new boss at its bottom.",
        },
        { k: 'p', text: '**Multiplayer has been rebuilt too.** Host a world straight from your browser and your friends join from theirs. No server to install, no terminal, no IP addresses.' },
        {
          k: 'cards',
          title: 'At a glance',
          items: [
            { icon: 'end_portal_frame', title: 'The Expansion Portal', text: 'A second portal on the main island, opened by the dragon\'s defeat.', link: 'portal' },
            { icon: 'chorus_stalk', title: 'Seven new biomes', text: 'From flat barrens to glowing crystal fields and a dark, misty waste.', link: 'biomes' },
            { icon: 'void_stalker_hide', title: 'Five new creatures', text: 'Endlings, Void Stalkers, Chorus Beasts, Crystal Mites and End Phantoms.', link: 'mobs' },
            { icon: 'ender_alloy_ingot', title: 'Ender Alloy and new resources', text: 'A tier above netherite, plus four ores, crystal, chorus wood and astral materials.', link: 'resources' },
            { icon: 'purpur_block', title: 'Cities and giant structures', text: 'Eight End City variants and five giant structures to discover.', link: 'structures' },
            { icon: 'ender_glyph_stone', title: 'An ancient civilization', text: 'Glyphs, artifacts, ancient weapons and the Guardian Constructs.', link: 'ancient' },
            { icon: 'dragon_scale_fragment', title: "The Dragon's Nest", text: 'A hidden chamber under the main island.', link: 'nest' },
            { icon: 'crystal_generator', title: 'End engineering and travel', text: 'New machines, bridges of light, teleporters, rails and a flying boat.', link: 'engineering' },
            { icon: 'ancient_key', title: 'Five quests', text: 'Restore an observatory, mend gateways, open a sealed city and more.', link: 'quests' },
            { icon: 'elytra', title: 'Elytra upgrades', text: 'Modules for thrust, hovering, bursts, blinking and saving you from the void.', link: 'elytra' },
            { icon: 'eclipse_shard', title: 'Storms and eclipses', text: 'Void Storms and the rare End Eclipse change the Expanded End.', link: 'events' },
            { icon: 'dragon_egg', title: 'A fiercer dragon', text: 'Eight new moves, every one shown before it lands.', link: 'dragon' },
            { icon: 'void_citadel_map', title: 'The Void Citadel', text: 'Six floors of puzzles and fights, hanging into the void.', link: 'citadel' },
            { icon: 'end_guardian_head', title: 'The End Guardian', text: 'A three-phase boss at the bottom of the Citadel.', link: 'guardian' },
            { icon: 'bell', title: 'Multiplayer, no terminal', text: 'Host from your browser, join with a friend list or a code.', link: 'multiplayer' },
          ],
        },
        {
          k: 'example',
          title: 'Your path through V6',
          steps: [
            'Defeat the Ender Dragon (it has new moves now). The Expansion Portal on the main island opens.',
            'Step through to the arrival platform and explore the seven biomes, their creatures and resources. Forge Ender Alloy.',
            "Find the structures. A giant structure's vault gives the first Citadel Star Chart Piece; quests, machines and new ways to travel make the Expanded End home.",
            'Weather Void Storms for their remnants. Under an End Eclipse, gather Eclipse Shards and visit the monoliths.',
            'Three Star Chart Pieces make the Void Citadel Map. Follow it and work your way down the six floors.',
            'At the bottom, wake the End Guardian at its altar and defeat it.',
            "Its Guardian Core gives your Elytra a fourth upgrade slot. The Guardian re-forms every seven days.",
          ],
        },
        {
          k: 'tip',
          text: "**Playing an older world?** Worlds from before V6 get the portal and the Expanded End's land, but not its structures, weather or the Void Citadel, and structures only appear in chunks nobody has visited yet. Create a new world to see everything.",
        },
      ],
    },

    // ------------------------------------------------------------------ the portal
    {
      id: 'portal',
      title: 'The Expansion Portal',
      icon: 'end_portal_frame',
      blocks: [
        { k: 'p', text: 'A 5 by 6 frame of new Expansion Portal Frame blocks stands on a brick plinth on the main End island, about 72 blocks from the exit portal, well away from the pillars. Nothing can break it: not explosions, not the dragon.' },
        {
          k: 'gallery',
          items: [
            { img: 'portal-dormant', caption: 'Before the dragon falls, the portal is dormant: a dark frame with an empty opening.' },
            { img: 'portal-alive', caption: 'Defeat the Ender Dragon and the frame lights up: the portal is open.' },
          ],
        },
        {
          k: 'example',
          title: 'Getting to the Expanded End',
          steps: [
            'Go to the End and defeat the Ender Dragon. (If your world\'s dragon is already dead, the portal is open as soon as you arrive.)',
            'Find the Expansion Portal on the main island, about 72 blocks from the exit portal.',
            'Stand in the portal for 3 seconds (instantly in Creative).',
            'You arrive on the arrival platform, over 7,000 blocks out. Its return portal, always open, takes you back to the main island.',
          ],
        },
        { k: 'img', img: 'arrival', caption: 'The arrival platform, with its return portal. You never land in the void: the game checks the spot every time.' },
        {
          k: 'list',
          items: [
            'The Expanded End is a ring 6,000 to 10,000 blocks from the centre of the End. It is still the End: travelling there never changes dimension.',
            'In V6 worlds the outer islands thin out and stop at about 4,600 blocks, leaving some 1,800 blocks of open void. The portal is the way across.',
            'Once open, the portal works for every player in multiplayer.',
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ biomes
    {
      id: 'biomes',
      title: 'Seven Biomes',
      icon: 'chorus_stalk',
      blocks: [
        { k: 'p', text: 'The Expanded End is split into regions hundreds of blocks across, each one of seven biomes with its own land, stone, plants, ores, sky colour, fog, light, drifting particles and ambient music. The air shifts over a few seconds as you cross from one to the next.' },
        { k: 'cards', items: biomeCards },
        { k: 'img', img: 'chorus-tree', caption: 'A giant chorus tree in the Chorus Forest. Its stalks are a new kind of wood.' },
        {
          k: 'example',
          title: 'Crossing between biomes',
          text: 'Between two different biomes the land tapers into a void gap 40 to 60 blocks wide. Build a bridge across, glide with Elytra, or (later) lay an Ender Bridge or fly a Void Skiff. Press F3 to see where you are: the debug screen shows "Expanded End: <biome name>".',
        },
        { k: 'tip', text: 'Visit all seven biomes to earn **Every Corner of the End**.' },
      ],
    },

    // ------------------------------------------------------------------ mobs
    {
      id: 'mobs',
      title: 'New Creatures',
      icon: 'void_stalker_hide',
      blocks: [
        {
          k: 'cards',
          items: [
            { img: 'mob-endling', title: 'Endling', text: 'Small and shy, it wanders in groups and follows players holding chorus fruit (which also breeds them). Hit one and it blinks away, like a tiny Enderman; when a Void Stalker comes near, they all scatter.', meta: 'Passive · 8 health · End Highlands, Chorus Forest · Drops Raw Endling' },
            { img: 'mob-void_stalker', title: 'Void Stalker', text: 'Hunts at any light level. Its Void Slip: hurt badly, or stared at for too long, it runs to the edge and drops into the void, then climbs out a few seconds later behind you.', meta: 'Hostile · 30 health · 7 damage · End Barrens, Shattered End, Void Wastes · Drops Void Shards, Void Stalker Hide' },
            { img: 'mob-chorus_beast', title: 'Chorus Beast', text: 'A gentle giant until you hit it or break chorus near it. Then it slams the ground around it and hurls chorus in an arc. It calms down after 30 seconds with nobody to chase.', meta: 'Neutral · 80 health · 12 damage · Chorus Forest · Drops Chorus Fiber, Chorus Fruit' },
            { img: 'mob-end_crystal_mite', title: 'End Crystal Mite', text: 'Lives around crystal formations and attacks in swarms: hit one and every mite nearby turns on you. Mining a crystal cluster can let a few out.', meta: 'Hostile · 6 health · End Crystal Fields · Drops End Crystal Fragments' },
            { img: 'mob-end_phantom', title: 'End Phantom', text: 'Very rare. It circles high over the far reaches and dives at players, gliders too. Hit it during its dive and it is stunned for 2 seconds.', meta: 'Hostile flyer · 40 health · 9 damage · Astral End, Void Wastes, 8,000+ blocks out · Drops End Phantom Membrane' },
          ],
        },
        { k: 'h', text: 'Every attack is shown first' },
        { k: 'p', text: 'Every new attack shows itself at least 1.2 seconds before it lands (longer when other players are near), and no hit ever knocks you towards the void. Mobs never wander off an edge either.' },
        {
          k: 'gallery',
          items: [
            { img: 'telegraph-lunge', caption: 'A Void Stalker crouches with flaring eyes and a rising growl before it lunges.' },
            { img: 'telegraph-throw', caption: "A Chorus Beast's throw: beads and a dashed line show the arc, a ring marks where it lands." },
          ],
        },
        {
          k: 'example',
          title: 'Surviving a Void Stalker',
          steps: [
            'When it crouches and growls, step aside: the lunge only hits where you were.',
            'If it runs for the edge and drops into the void, turn around.',
            'Rising particles, a ring and a low sound mark the spot 2 to 4 blocks behind the nearest player where it will climb out.',
            'Defeat it after it comes back to earn **Back From the Edge**.',
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ resources
    {
      id: 'resources',
      title: 'Resources & Ender Alloy',
      icon: 'ender_alloy_ingot',
      blocks: [
        { k: 'p', text: 'Each biome has its own stone and something worth digging for. Four new ores hide in the Expanded End:' },
        {
          k: 'cards',
          items: [
            { img: 'ore-ender_ore', title: 'Ender Ore', text: 'Very rare, 12 to 36 blocks deep in the End Highlands, never touching air. As tough as Ancient Debris: it needs a netherite pickaxe. Smelt it into Ender Scrap.' },
            { img: 'ore-void_crystal_ore', title: 'Void Crystal Ore', text: "In the Void Wastes' dark end stone, near the surface. Diamond pickaxe. Drops Void Shards." },
            { img: 'ore-ancient_end_fragment', title: 'Ancient End Fragment', text: 'Buried in the Shattered End. Diamond pickaxe. Drops Ancient Fragments. "Worked stone. Older than the cities."' },
            { img: 'ore-astral_ore', title: 'Astral Ore', text: 'Extremely rare, Astral End only, and it glows. Only an Ender Alloy pickaxe can mine it. Drops Astral Dust.' },
          ],
        },
        { k: 'items', title: 'Materials', ids: ['end_crystal_fragment', 'void_shard', 'chorus_fiber', 'ender_scrap', 'ender_alloy_ingot', 'ancient_fragment', 'astral_dust', 'astral_shard', 'void_stalker_hide', 'void_leather', 'end_phantom_membrane', 'raw_endling', 'cooked_endling'] },
        { k: 'items', title: 'Stone (each with polished, bricks, stairs, slabs and walls)', ids: ['cracked_end_stone', 'cracked_end_stone_bricks', 'dark_end_stone', 'dark_end_stone_bricks', 'crystalline_end_stone', 'crystalline_end_stone_bricks', 'astral_end_stone', 'astral_end_stone_bricks', 'voidstone'] },
        { k: 'items', title: 'Building and light', ids: ['end_crystal_cluster', 'crystal_lamp', 'crystal_glass', 'void_glass', 'chorus_stalk', 'chorus_planks', 'chorus_cloth', 'chorus_rope', 'ancient_end_bricks', 'astral_lantern', 'astral_glass'] },
        { k: 'h', text: 'Ender Alloy: above netherite' },
        {
          k: 'table',
          head: ['', 'Netherite', 'Ender Alloy'],
          rows: [
            ['Tool durability', '2,031', '2,500'],
            ['Mining speed', '9', '10'],
            ['Sword damage', '8', '9'],
            ['Armor toughness', '3', '4'],
            ['Knockback resistance', '0.1', '0.15'],
            ['Mines Astral Ore', 'No', 'Yes'],
          ],
        },
        { k: 'items', ids: ['ender_alloy_sword', 'ender_alloy_pickaxe', 'ender_alloy_axe', 'ender_alloy_shovel', 'ender_alloy_hoe', 'ender_alloy_helmet', 'ender_alloy_chestplate', 'ender_alloy_leggings', 'ender_alloy_boots'] },
        { k: 'p', text: "Ender Alloy gear is fire resistant, and if it falls into the void it comes back to the nearest safe ground. Here's how to make it:" },
        {
          k: 'example',
          title: 'Forging Ender Alloy',
          steps: ['Mine Ender Ore deep in the End Highlands and smelt it into Ender Scrap.', 'Collect Void Shards from Void Crystal Ore (or Void Stalkers).', 'Craft an Ender Alloy Ingot:'],
          recipe: 'ender_alloy_ingot',
        },
        {
          k: 'example',
          title: 'Upgrading netherite gear',
          text: 'At a smithing table, put in a netherite piece and an Ender Alloy Ingot. Enchantments, names and damage carry over.',
          equation: { parts: ['netherite_chestplate', 'ender_alloy_ingot'], result: 'ender_alloy_chestplate', where: 'Smithing Table' },
        },
        { k: 'img', img: 'ender-alloy-armor', caption: 'A full set of Ender Alloy armor (Clad in the End).' },
        {
          k: 'example',
          title: 'The Void Pack',
          text: 'A bag that holds 9 stacks. Die in the void and it stays with you, contents and all. Make Void Leather from 4 Void Stalker Hides, then:',
          recipe: 'void_pack',
        },
      ],
    },

    // ------------------------------------------------------------------ structures
    {
      id: 'structures',
      title: 'Cities & Giant Structures',
      icon: 'purpur_block',
      blocks: [
        { k: 'h', text: 'End City 2.0: eight variants' },
        { k: 'p', text: 'Built from random pieces (towers, halls, bridges, platforms) and dressed in the materials of their biome, so no two look alike. Some are guarded by Guardian Constructs; the Settlements are home to Endlings.' },
        { k: 'cards', items: variantCards },
        { k: 'h', text: 'Five giant structures' },
        { k: 'p', text: 'At most one in each huge region of the ring, so a world has only 6 to 11 of them. Walking into one shows its title, plays its music and earns its advancement.' },
        { k: 'cards', items: giantCards },
        { k: 'img', img: 'discovery-title', caption: 'Discovering a giant structure.' },
        {
          k: 'example',
          title: 'Following an Ancient Map',
          steps: [
            'Ancient Maps turn up in Libraries, Observatories, the Void Observatory and the Dragon\'s Nest.',
            "Each map is tied to one giant structure, the one nearest the chest it came from. Its tooltip just says \"Marked: a place.\"",
            'Hold it like a compass: the needle points the way.',
          ],
        },
        { k: 'tip', text: '**Need Elytra?** The End Shipyard is the new source: about one Shipyard in seven has a pair in its finished ship. The classic End Ships still always have one.' },
      ],
    },

    // ------------------------------------------------------------------ the ancient civilization
    {
      id: 'ancient',
      title: 'The Ancient Civilization',
      icon: 'ender_glyph_stone',
      blocks: [
        { k: 'p', text: "Something older than the End Cities left its mark everywhere: walls of glyphs, broken portals, sealed doors and dormant machines. Its story is told only in fragments: torn pages, log entries, stone rubbings and star charts found in chests." },
        {
          k: 'gallery',
          items: [
            { img: 'glyph-wall', caption: 'A wall of Ender Glyph Stone.' },
            { img: 'glyph-tablet', caption: 'Use a glyph stone to read its glyphs (Lost in Translation).' },
          ],
        },
        { k: 'items', title: 'Six End Artifacts: hold all six for Keeper of Relics', ids: ['glyph_tablet', 'cracked_ender_eye', 'old_crystal_lens', 'ancient_coin', 'ancient_key_shard', 'dragon_scale_fragment'] },
        {
          k: 'table',
          title: 'Ancient weapons',
          head: ['Weapon', 'What it does'],
          rows: [
            ['@ancient_blade Ancient Blade', 'A sword (8 damage) that ignores 2 points of armor'],
            ['@voidpiercer Voidpiercer', 'Its bolts fly dead straight for 32 blocks, then fall'],
            ['@shardstaff Shardstaff', 'Fires a slow crystal shard (9 damage, about 17 blocks)'],
          ],
        },
        { k: 'h', text: 'Guardian Constructs' },
        {
          k: 'cards',
          items: [
            { img: 'construct-guardian_sentinel', title: 'Sentinel', text: 'Patrols its structure. Its charged punch glows and marks a circle on the ground first; its crystal bolt shows its line for 1.5 seconds before it fires.', meta: '40 health · 8 damage · armor 10' },
            { img: 'construct-guardian_bulwark', title: 'Bulwark', text: 'Stands dormant guarding a room or a vault and wakes when you come in. Its ground pound shows a ring of cracks first; its shield halves the damage it takes.', meta: '120 health · 14 damage · armor 14 · defeat one for Unmade' },
          ],
        },
        {
          k: 'gallery',
          items: [
            { img: 'telegraph-sentinel', caption: "A Sentinel's crystal bolt: the beam marks the line before it fires." },
            { img: 'telegraph-bulwark', caption: "A Bulwark's ground pound: get out of the ring." },
          ],
        },
        { k: 'tip', text: 'Constructs never stray more than 24 blocks from their post, and a destroyed one stays destroyed.' },
      ],
    },

    // ------------------------------------------------------------------ the nest
    {
      id: 'nest',
      title: "The Dragon's Nest",
      icon: 'dragon_scale_fragment',
      blocks: [
        { k: 'p', text: 'After the dragon\'s first defeat, the island itself opens up: a crack appears in the ground in front of the Expansion Portal, with steps leading down into a wide, low chamber under the main island.' },
        {
          k: 'gallery',
          items: [
            { img: 'dragon-nest-crack', caption: 'The crack, in front of the Expansion Portal.' },
            { img: 'dragon-nest', caption: 'Inside the Nest.' },
          ],
        },
        {
          k: 'list',
          items: [
            'Sixteen to twenty-one nest hollows round the walls: far too many for one dragon. All of them empty.',
            'Ancient End Bricks and glyph murals showing through the walls: the island was built on something older.',
            'A broken portal with a frame unlike any other (the Dragon\'s History quest starts here).',
            "Three or four chests with the Nest's own lore, Dragon Scale Fragments (found nowhere else), and an Ancient Map.",
          ],
        },
        { k: 'tip', text: 'There is no fight down here, and the dragon never chases anyone into the Nest. Entering it earns **Beneath the Pillars**.' },
      ],
    },

    // ------------------------------------------------------------------ engineering and travel
    {
      id: 'engineering',
      title: 'End Engineering & Travel',
      icon: 'crystal_generator',
      blocks: [
        { k: 'p', text: 'The engineering of V5 reaches the End, with eight new components made from the End\'s own resources (built at the Engineering Crafting Table, explained in the Engineering Book).' },
        {
          k: 'table',
          head: ['Machine', 'EU', 'What it does'],
          rows: [
            ['@crystal_generator Crystal Generator', '+128 EU/t', 'Burns an End Crystal Fragment every 20 seconds'],
            ['@void_collector Void Collector', '+24 EU/t', 'Needs 32+ blocks of open air below it; four times as much in a Void Storm'],
            ['@restored_ancient_core Restored Ancient Core', '+512 EU/t', 'Never runs out. Restore one in a giant structure (8 Ancient Fragments and an Astral Shard)'],
            ['@void_cell Void Cell', 'stores 2,000,000', 'Keeps its charge when broken'],
            ['@end_processor End Processor', '-64 EU/t', 'Turns End ores into more materials (Ender Ore into 2 Ender Scrap)'],
            ['@crystal_grower Crystal Grower', '-32 EU/t', 'Grows an End Crystal Cluster every 5 minutes'],
          ],
        },
        { k: 'img', img: 'crystal-generator', caption: 'An End power line over the void: a Crystal Generator charging a Void Cell, an End Processor and a Crystal Grower.' },
        { k: 'h', text: 'Five new ways to travel' },
        {
          k: 'cards',
          items: [
            { img: 'ender-bridge', title: 'Ender Bridges', text: 'A projector lays a walkable bridge of light up to 64 blocks long. Without power it flickers first, then fades: the flicker is your warning.' },
            { img: 'teleport-node', title: 'Teleportation Nodes', text: 'Name your nodes, lock them if you like, and travel between them: 1,000 EU plus 10 per block, never across dimensions.' },
            { img: 'ancient-gateway', title: 'Ancient Gateways', text: 'Every broken portal in the Ruins and the Fallen City has a pair far away. Mend both and they become a gateway, both ways, for good.' },
            { img: 'void-skiff', title: 'Void Skiff', text: 'A flying boat for two that hovers 3 blocks over ground or void, burning a Void Shard every 30 seconds. Its recipe unlocks when you read a Void Skiff Blueprint from a Shipyard.' },
          ],
        },
        { k: 'p', text: '**Ender Rails** drive minecarts at twice a powered rail\'s speed and can run along Ender Bridges across the void. Plain rails, powered rails and minecarts are new in V6 too.' },
        {
          k: 'example',
          title: 'Your first End power',
          steps: [
            'Collect End Crystal Fragments from the clusters in the End Crystal Fields.',
            'Craft a Crystal Generator at the Engineering Crafting Table.',
            'Feed it fragments: each burns for 20 seconds at +128 EU/t.',
            'Run cable to a Void Cell to store what it makes, then to your machines.',
          ],
          recipe: 'crystal_generator',
        },
      ],
    },

    // ------------------------------------------------------------------ quests
    {
      id: 'quests',
      title: 'Quests',
      icon: 'ancient_key',
      blocks: [
        { k: 'p', text: 'Five quests are built into the ancient structures. The quest tracker shows your next step; everyone nearby shares a step when it is done.' },
        {
          k: 'cards',
          items: [
            { icon: 'ancient_lens', title: 'The Lost Observatory', text: 'Repair an observatory\'s cracked lens, power it, and look through it: it shows the way to a giant structure you haven\'t found.', meta: 'End Observatories, the Void Observatory' },
            { icon: 'dead_portal', title: 'The Broken Gateway', text: 'Mend a broken portal, follow the map to its pair far away, mend that too, and step through.', meta: 'End Ruins, the Fallen City' },
            { icon: 'silent_bell', title: 'The Silent City', text: 'Gather four Ancient Key Shards from a city\'s reliquaries, forge the Ancient Key and open the sealed hall. Inside: the Silent Bell, which stills every Construct around.', meta: 'One per world' },
            { icon: 'end_crystal', title: 'The Crystal Vault', text: 'Set an End Crystal on each of four pedestals, power them from a Crystal Generator, and survive what wakes when the vault opens.', meta: 'End Palaces · reward: the Ender Blink module' },
            { icon: 'dragon_scale_fragment', title: "The Dragon's History", text: "Read the Nest's fragments, find more about the Dragon, gather four Dragon Scale Fragments and repair the Nest's ring. It opens one way, somewhere hidden.", meta: "The Dragon's Nest · reward: the Void Recovery module" },
          ],
        },
        { k: 'img', img: 'quest-tracker', caption: 'The quest tracker, in the End\'s colours.' },
        {
          k: 'example',
          title: 'The Lost Observatory, step by step',
          steps: [
            "Find the observatory's Ancient Lens: it is cracked.",
            'Repair it with 8 Ancient Fragments. The conduits down to the core mend with it.',
            'Power it: 256 EU/t into the core for 30 seconds.',
            'Look through it with an empty hand: you get an Ancient Map to the nearest giant structure you haven\'t found (once an in-game day).',
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ elytra
    {
      id: 'elytra',
      title: 'Elytra Upgrades',
      icon: 'elytra',
      blocks: [
        { k: 'p', text: 'Elytra take upgrade modules at the smithing table: up to three (four with a Guardian Core), never the same one twice. An Elytra without upgrades flies exactly as before.' },
        {
          k: 'table',
          head: ['Module', 'Effect'],
          rows: [
            ['@reinforced_module Reinforced', 'Twice the durability (864)'],
            ['@thrust_module Thrust', 'Gliding picks up speed 30% faster; rockets push 20% harder'],
            ['@hover_module Hover', 'Sneak while gliding to hang in the air for up to 3 seconds'],
            ['@burst_module Burst', "Double-tap jump while gliding for a rocket's push; 3 charges"],
            ['@sanctum_dragon_scale Void Recovery', 'In the End, falling into the void puts you back on the last ground you stood on'],
            ['@ender_blink_module Ender Blink', 'Blink 8 blocks straight ahead while gliding'],
            ['@eclipse_veil_module Eclipse Veil', 'Become hard to see for 5 seconds: every mob after you loses you'],
          ],
        },
        {
          k: 'example',
          title: 'Adding a module',
          text: 'Put the Elytra and a module in a smithing table. To take the newest module off, use shears instead (the module is lost).',
          equation: { parts: ['elytra', 'thrust_module'], result: 'elytra', where: 'Smithing Table' },
        },
        {
          k: 'gallery',
          items: [
            { img: 'elytra-smithing', caption: 'Upgrading Elytra at a smithing table.' },
            { img: 'elytra-tooltip', caption: 'The tooltip lists its upgrades; each one shows as a mark on the worn wings.' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ events
    {
      id: 'events',
      title: 'Void Storms & the Eclipse',
      icon: 'eclipse_shard',
      blocks: [
        { k: 'h', text: 'Void Storms' },
        { k: 'p', text: 'Every two to four days a Void Storm rolls over the Expanded End for three to five minutes. A minute before, the sky dims, the void rumbles and a **VOID STORM APPROACHING** banner warns you.' },
        {
          k: 'gallery',
          items: [
            { img: 'storm', caption: 'A Void Storm: violet fog and falling debris.' },
            { img: 'storm-remnant', caption: 'A Storm Remnant: a floating ruin with a chest, gone when the storm ends.' },
          ],
        },
        {
          k: 'list',
          items: [
            'Falling Void Debris: a ring marks each impact before the stone lands.',
            'Low-gravity pockets: jump twice as high, fall half as fast.',
            'Void Stalkers and Chorus Beasts get bolder; Endlings run for cover.',
            'Crystal Generators make 50% more, Void Collectors four times as much.',
            "Storm Remnants: loot their chests before the storm ends. Anyone standing on one is set down safely.",
          ],
        },
        { k: 'h', text: 'The End Eclipse' },
        { k: 'p', text: 'Rare and unannounced: about one night in sixty, a dark disc rises over the Expanded End and stays until dawn.' },
        {
          k: 'gallery',
          items: [
            { img: 'eclipse-sky', caption: 'The End Eclipse.' },
            { img: 'eclipse-monolith', caption: 'An Eclipse Monolith, with a cache only found during an eclipse.' },
          ],
        },
        {
          k: 'list',
          items: [
            'Eclipse Shards grow on the islands. Mine them while you can: they dissolve at dawn.',
            "Eclipse Monoliths rise near players, each with a cache holding lore found nowhere else.",
            'End Phantoms come more often, and Void Stalkers come pale and tougher, with extra loot.',
            'A beam of light rises from the Void Citadel, visible from anywhere in the ring.',
          ],
        },
        { k: 'items', ids: ['eclipse_shard'], title: 'Eclipse Shards fuel the End Guardian\'s altar and repair its Lance.' },
      ],
    },

    // ------------------------------------------------------------------ the dragon
    {
      id: 'dragon',
      title: "The Dragon's New Moves",
      icon: 'dragon_egg',
      blocks: [
        { k: 'p', text: 'The Ender Dragon keeps everything it had (200 health, its crystals, its perches) and learns eight new moves. Every one is named on a warning banner and shown before it lands. Tested against the old fight, it perches a little more often and deals no more damage overall.' },
        {
          k: 'cards',
          items: [
            { img: 'dragon-breath-wave', title: 'Void Breath Wave', text: 'It stops and inhales, glowing violet, while a purple path is drawn on the ground. Then a line of breath follows the path (you can bottle it).' },
            { img: 'dragon-wing-gust', title: 'Wing Gust', text: 'It rears up on its perch; a ring marks 12 blocks round the portal. Everyone inside is pushed away, never off the island.' },
            { img: 'dragon-roar', title: 'Roar', text: 'The screen shakes, a ring of light runs out, and nearby Endermen turn to the portal.' },
            { img: 'dragon-pillar-weave', title: 'Pillar Weave', text: 'Its route through the pillars is drawn first; it weaves through them, then comes down to perch.' },
            { img: 'dragon-strafing-dive', title: 'Strafing Dive', text: 'Its shadow line appears on the ground before a low pass. Step off the line.' },
            { img: 'dragon-crystal-fury', title: 'Crystal Fury', text: 'Break a crystal and the others flare: charge lines reach for anyone near a pillar.' },
            { img: 'dragon-edge-strike', title: 'Edge Strike', text: 'A red ring marks a spot on the island\'s edge; the strike leaves a crater that crumbles (and is put back after the fight).' },
            { img: 'dragon-dragon-storm', title: 'Dragon Storm', text: 'Below a quarter of its health, the sky darkens and thunder rolls over the island.' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ the citadel
    {
      id: 'citadel',
      title: 'The Void Citadel',
      icon: 'void_citadel_map',
      blocks: [
        { k: 'img', img: 'title-void-citadel', caption: 'The Void Citadel: an island with a tower hanging beneath it into the void.' },
        { k: 'p', text: 'One per world, deep in the Void Wastes, 8,600 to 9,400 blocks out. Six floors, each with a puzzle or a fight, a Citadel Anchor (it sets your respawn point and never runs out), a library and a vault. Finish a floor and its sealed door opens onto a ladder down to the next, for everyone, for good.' },
        {
          k: 'example',
          title: 'Finding it',
          steps: [
            'Collect Citadel Star Chart Pieces: one in each giant structure\'s vault, and one in the Dragon\'s History\'s hidden room.',
            'Combine three into the Void Citadel Map: its needle points at the entrance.',
            "Or, during an End Eclipse, look through a restored observatory telescope, or follow the beam of light.",
          ],
        },
        { k: 'items', ids: ['citadel_star_chart_piece', 'void_citadel_map', 'citadel_anchor'] },
        {
          k: 'table',
          title: 'The floors (in a different order in every world)',
          head: ['Floor', 'What to do'],
          rows: [
            ['Combat', 'Clear the hall of Sentinels and the Void Stalkers that climb out of two rifts'],
            ['Glyph Lock', 'Press the keys in the order of the mural\'s glyphs; a wrong key wakes a Sentinel'],
            ['Crystal Sequence', 'Watch six pedestals light up, then repeat the sequence'],
            ['Parkour', 'Round the outside of the tower over open void: stepping stones, pulsing bridges, a moving platform'],
            ['Engineering', 'Mend a broken conduit and wire three levers through your own logic gates to match the rule on the wall'],
          ],
        },
        {
          k: 'gallery',
          items: [
            { img: 'citadel-exterior', caption: 'The tower from outside.' },
            { img: 'citadel-glyph', caption: 'A Glyph Lock floor.' },
            { img: 'citadel-parkour', caption: 'The parkour route, outside the walls.' },
          ],
        },
        { k: 'tip', text: 'In multiplayer, anyone\'s key, pedestal or lever counts, and Constructs get tougher for each extra player on the floor.' },
      ],
    },

    // ------------------------------------------------------------------ the guardian
    {
      id: 'guardian',
      title: 'The End Guardian',
      icon: 'end_guardian_head',
      blocks: [
        { k: 'p', text: 'At the bottom of the Citadel lies a round arena over a lower floor that catches every fall. Feed the altar four Eclipse Shards (it comes charged the first time) and the End Guardian wakes: 1,000 health, more for every extra player.' },
        {
          k: 'cards',
          items: [
            { img: 'guardian-phase1', title: 'Phase 1: Awakening', text: 'Crystal Lance (a charge line, then a beam along it), Ground Fracture (marked tiles drop away for 3 seconds) and Construct Call.' },
            { img: 'guardian-phase2', title: 'Phase 2: Void Shift', text: 'Slow homing Void Orbs you can shoot down, a Gravity Well, and a Crystal Shield held up by four pylons: break them.' },
            { img: 'guardian-phase3', title: 'Phase 3: Core Exposed', text: 'Faster, with attacks in pairs, a collapsing outer ring, and the Final Lance: a sweep at chest height. **Jump or duck!**' },
          ],
        },
        { k: 'p', text: 'After every fourth attack it kneels for 5 seconds with its core bare: that is your moment.' },
        {
          k: 'table',
          title: 'What it drops (each player who fought gets their own)',
          head: ['Item', 'Chance', 'What it is'],
          rows: [
            ['@guardian_core Guardian Core', 'Certain the first time', "Opens an Elytra's fourth upgrade slot"],
            ['@guardians_lance The Guardian\'s Lance', '1 in 3', 'Reaches 2 blocks further and fires a short Crystal Lance'],
            ['@eclipse_veil_module Eclipse Veil', '1 in 5', 'An Elytra module: become hard to see'],
            ['@end_guardian_head End Guardian Head', 'Always', 'A trophy'],
          ],
        },
        { k: 'img', img: 'guardian-victory', caption: 'THE END GUARDIAN HAS FALLEN.' },
        { k: 'tip', text: 'It re-forms seven in-game days after its defeat, for four more Eclipse Shards. If everyone dies or leaves, it resets after a minute and the altar stays charged.' },
      ],
    },

    // ------------------------------------------------------------------ advancements
    {
      id: 'advancements',
      title: 'Advancements',
      icon: 'compass',
      blocks: [
        { k: 'p', text: 'V6 adds a whole branch to the End tab, from reaching the Expanded End to filling all four Elytra slots. As always, nothing done with cheats or the Admin Panel counts.' },
        { k: 'advancements', from: 'enter_expanded_end', to: 'elytra_four_slots' },
      ],
    },

    // ------------------------------------------------------------------ multiplayer
    {
      id: 'multiplayer',
      title: 'Multiplayer, Reinvented',
      icon: 'bell',
      blocks: [
        { k: 'img', img: 'mp-together', caption: 'Two players in a world hosted from a browser tab.' },
        {
          k: 'p',
          text: 'Before V6, playing together meant running the MineHonk server yourself: installing Node, typing commands in a terminal, opening ports and sharing an IP address. **Now it all happens on the website.** The world runs in the host\'s browser tab and friends join from theirs. Nothing to install, no terminal, no port forwarding.',
        },
        {
          k: 'table',
          head: ['', 'Before V6', 'Now'],
          rows: [
            ['Who runs the world', 'A server program started from a terminal', "The host's own browser tab"],
            ['Getting started', 'Install Node, run the server, open a port', 'Press Multiplayer and create an account'],
            ['Inviting people', 'Share your IP address', 'Friends list, invitations or a join code'],
            ['Finding worlds', '-', 'A public world list with search'],
            ["Everyone's progress", "On the server's disk", "Saved in the host's world: come back and your inventory is waiting"],
          ],
        },
        {
          k: 'example',
          title: 'Hosting a world',
          steps: [
            'On the title screen, press **Multiplayer** and **Create Account**: a name and a password, no email.',
            'In the **Host** tab, pick one of your worlds or press **Create New World**.',
            'Choose the game mode (anything but Spectator: Survival, Hardcore, Creative, Adventure or God Mode), who can join (Friends, Private with a code, or Public), the player limit, and whether to allow cheats.',
            'Press **Start Hosting**. Your join code is in the hosting panel (Pause > Hosting...).',
          ],
        },
        {
          k: 'gallery',
          items: [
            { img: 'mp-signin', caption: 'Multiplayer: sign in or create an account.' },
            { img: 'mp-host-tab', caption: 'The Host tab: your worlds, ready to put online.' },
            { img: 'mp-host-form', caption: "A new world's hosting settings." },
            { img: 'mp-hosting-panel', caption: 'The hosting panel: the join code, who is playing, and your tools.' },
          ],
        },
        { k: 'tip', text: '**Already playing alone?** Pause > **Open to Multiplayer** puts the world you are in online, as it is.' },
        {
          k: 'example',
          title: 'Joining a friend',
          steps: ['In the **Friends** tab, type their name and press **Add Friend**.', 'Once they accept, their row shows what they are playing.', 'Press **JOIN**: no code needed. They can also send you an invitation, which pops up wherever you are.'],
        },
        { k: 'img', img: 'mp-friends-join', caption: 'A friend online, hosting a world: one click to join.' },
        {
          k: 'example',
          title: 'Joining with a code',
          text: 'Got a code like ABCD-2345 from someone? Open the **Join** tab, type it in and press Join.',
        },
        {
          k: 'gallery',
          items: [
            { img: 'mp-join-code', caption: 'The Join tab.' },
            { img: 'mp-public', caption: 'The Public tab: worlds anyone can join, with host, mode, players and version.' },
          ],
        },
        { k: 'h', text: 'For hosts' },
        {
          k: 'list',
          items: [
            'Roles: you are the owner; players you trust can be made **operators**; everyone else joins as a **builder** or, if you choose, a **visitor** who can only look around.',
            'The hosting panel lets you Make Op, Kick or Ban, change the settings, and invite friends at any time.',
            'With cheats on, you and your operators get the Admin Panel (F8). Admin actions are announced in chat.',
            "Keep the tab open: closing it takes the world offline. A background tab keeps running, though the browser may slow it.",
            'Up to 16 players per world (8 by default). Phones can join; hosting works best on a computer.',
          ],
        },
        { k: 'h', text: 'Safe and private' },
        {
          k: 'list',
          items: [
            'Friends and players with your code connect directly to you, which is fastest. If a network blocks that, the game switches to a relay by itself.',
            "Strangers from the public list always go through the relay, so nobody ever sees anyone's IP address.",
            'The host\'s game checks everything players do, exactly as a dedicated server would: no cheating clients.',
            'Passwords are scrambled in your browser before they are sent. There is no reset, so remember yours.',
          ],
        },
        { k: 'tip', text: 'Running your own server still works for those who want it (the Node server in the README), and single player is unchanged.' },
      ],
    },

    // ------------------------------------------------------------------ everything else
    {
      id: 'more',
      title: 'And Also...',
      icon: 'book',
      blocks: [
        { k: 'h', text: 'A new title screen' },
        { k: 'p', text: 'Four V6 scenes play behind the title screen: the arrival island, the crystal fields, the Void Citadel and an island under the eclipse.' },
        {
          k: 'gallery',
          items: [
            { img: 'title-crystal-fields', caption: 'The End Crystal Fields.' },
            { img: 'title-end-eclipse', caption: 'Under the End Eclipse.' },
          ],
        },
        { k: 'h', text: 'Sound' },
        { k: 'p', text: 'Every biome has its own ambient music, and so do storms, the eclipse, the ancient halls, each kind of Citadel floor and each of the Guardian\'s phases. Discoveries, the eclipse, the Citadel and the Guardian\'s fall have their own stings.' },
        { k: 'h', text: 'Admin Panel' },
        {
          k: 'p',
          text: 'A new **End Expansion** tab covers everything in V6: the portal, biomes, mobs, kits, structures, the Nest, quests, storms and eclipses, the Citadel, the Guardian and each of the Dragon\'s new moves. The **Teleport** tab can also find and take you to any Expanded End biome or structure from anywhere. Like every cheat, none of it earns advancements.',
        },
        { k: 'img', img: 'admin-teleport-end', caption: "The Teleport tab's End lists, with the Expanded End." },
        { k: 'h', text: 'Fixes' },
        {
          k: 'list',
          items: [
            "The Ender Dragon's boss bar no longer stays on screen after it dies.",
            "Moving items around the creative inventory keeps their data (an Elytra's upgrades, a Void Pack's contents, a map's target).",
            'Mobs no longer get stuck hanging at a ledge and taking fall damage.',
          ],
        },
      ],
    },
  ],
};
