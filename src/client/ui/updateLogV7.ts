/**
 * The Update Log's V7 entry: The Halloween Update. It comes in five phases;
 * this is what is in so far, one section each, and later phases add theirs
 * (villages, trick-or-treating, hauntings, advancements) before
 * "advancements" and "more". Pictures are screenshots of the game itself
 * (public/updatelog/v7, made by tools/update-log/ from tests/e2e/halloween.mjs).
 */
import { DIMENSION_PUMPKINS } from '../../common/halloween/pumpkins';
import { HALLOWEEN_ENDS_TEXT } from '../../common/halloween/season';
import { COSTUME_HEADS } from '../../common/halloween/heads';
import { ABANDONED_ONE_IN, TRICK_HOMES_MIN, TRICK_HOMES_MAX } from '../../common/halloween/villages';
import type { UpdateEntry, Card } from './updateLog';

const pumpkinCards: Card[] = DIMENSION_PUMPKINS.map((p) => ({
  img: `pumpkin-${p.dim}`,
  title: p.name,
  text: p.look,
  meta: `Grows in ${p.where} · gives off light ${p.light} · drops itself`,
}));

export const V7_LOG: UpdateEntry = {
  version: 'V7',
  name: 'The Halloween Update',
  tagline: 'Trick-or-Treat Villages, Abandoned Villages, costume heads, pumpkins in every dimension and ghosts at night. Phases 1 and 2 of 5.',
  hero: 'title-haunted-forest',
  sections: [
    // ------------------------------------------------------------------ overview
    {
      id: 'overview',
      title: 'Overview',
      icon: 'hallow_pumpkin',
      blocks: [
        {
          k: 'p',
          text: `Halloween has come to MineHonk. **V7 arrives in five phases**, and two are here. Phase 1 brought the Halloween season itself, a pumpkin for every dimension, ghosts drifting by on dark nights, and a title screen of haunted nights. **Phase 2 brings the villages:** Trick-or-Treat Villages dressed for the season, eerie Abandoned Villages, and costume heads to wear. The season lasts until **${HALLOWEEN_ENDS_TEXT}**.`,
        },
        { k: 'img', img: 'trick-village', caption: 'A Trick-or-Treat Village on a Halloween night.' },
        {
          k: 'cards',
          title: 'Phase 2 at a glance',
          items: [
            { icon: 'hallow_pumpkin', title: 'Trick-or-Treat Villages', text: 'Pumpkins, orange and purple lights, skulls by the doors.', link: 'villages' },
            { icon: 'cobweb', title: 'Abandoned Villages', text: 'Extremely rare ruins, haunted day and night.', link: 'abandoned' },
            { icon: 'skeleton_skull', title: 'Costume heads', text: 'Skulls and heads to place and wear.', link: 'heads' },
            { icon: 'redstone_torch', title: 'Admin Panel: villages', text: 'Build either village, see every door.', link: 'admin' },
          ],
        },
        {
          k: 'cards',
          title: 'Phase 1',
          items: [
            { icon: 'clock', title: 'The Halloween season', text: `Until ${HALLOWEEN_ENDS_TEXT}, or for good in worlds that want it.`, link: 'season' },
            { icon: 'hallow_pumpkin', title: 'A pumpkin in every dimension', text: 'Five new glowing pumpkins, from the Overworld to inside the computer.', link: 'pumpkins' },
            { icon: 'white_wool', title: 'Ghosts at night', text: 'Now and then one drifts past, and fades away.', link: 'ghosts' },
            { icon: 'jack_o_lantern', title: 'A haunted title screen', text: 'A foggy forest, a pumpkin patch and a misty marsh, in turn.', link: 'menu' },
            { icon: 'redstone_torch', title: 'Admin Panel: Halloween', text: 'See why it is on or off, place every pumpkin, test the season.', link: 'admin' },
          ],
        },
        {
          k: 'list',
          items: [
            '**Next:** trick-or-treating: a sack, candy, and knocking on the doors of Trick-or-Treat Villages.',
            '**Later:** hauntings that come by themselves, new characters to meet, and Halloween advancements.',
          ],
        },
        { k: 'tip', text: 'Halloween only adds. When the season ends, nothing is taken away: pumpkins already out there stay, and so does everything you have.' },
      ],
    },

    // ------------------------------------------------------------------ the season
    {
      id: 'season',
      title: 'The Halloween Season',
      icon: 'clock',
      blocks: [
        {
          k: 'p',
          text: `Halloween content is on until **${HALLOWEEN_ENDS_TEXT}**. That is one moment for everyone, wherever you are: it is not midnight in your own time zone. Halloween does not come back by itself next year; next year has its own update.`,
        },
        { k: 'img', img: 'world-option', caption: 'Create New World > More World Options...: Halloween content.' },
        {
          k: 'table',
          title: 'Halloween content, a new world option',
          head: ['Setting', 'Before the cutoff', 'After the cutoff'],
          rows: [
            ['**Seasonal** (the default, and every world made before V7)', 'Halloween content on', 'No new seasonal content. Everything already there stays.'],
            ['**Always on**', 'Halloween content on', 'Still on, for good'],
          ],
        },
        {
          k: 'list',
          items: [
            "Online, the season goes by the hub's clock; offline, by your device's.",
            "In a world, its server decides (in multiplayer, the host's game) and tells everyone, so every player in a world always sees the same thing.",
            'Hauntings and the Update Log are never seasonal.',
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ the pumpkins
    {
      id: 'pumpkins',
      title: 'Dimension Pumpkins',
      icon: 'hallow_pumpkin',
      blocks: [
        {
          k: 'p',
          text: "Every dimension grows a pumpkin of its own while Halloween is on. Each is a single carved, glowing block, scattered here and there on land that has never been explored: about one chunk in twenty, on natural ground, never inside a building.",
        },
        { k: 'cards', items: pumpkinCards },
        { k: 'img', img: 'pumpkin-expanded-end', caption: 'An Ender Pumpkin out in the Expanded End.' },
        {
          k: 'gallery',
          items: [
            { img: 'pumpkins-day', caption: 'All five side by side, by day...' },
            { img: 'pumpkins-night', caption: '...and by night.' },
          ],
        },
        { k: 'items', title: 'The five pumpkins', ids: DIMENSION_PUMPKINS.map((p) => p.id) },
        {
          k: 'list',
          items: [
            'Break one with anything (an axe is quickest) and it drops itself. Place it and it faces you.',
            'They give off light, like a jack o\'lantern.',
            'In creative, they are in the new **Halloween** tab.',
          ],
        },
        { k: 'img', img: 'creative-tab', caption: "The creative inventory's Halloween tab." },
      ],
    },

    // ------------------------------------------------------------------ ghosts
    {
      id: 'ghosts',
      title: 'Ghosts at Night',
      icon: 'white_wool',
      blocks: [
        { k: 'img', img: 'ghost', caption: 'A ghost drifting by on a Halloween night.' },
        {
          k: 'p',
          text: 'On a Halloween night, now and then, a ghost drifts across your view, low over the land or high in the air, and fades away. They are rare: one at a time, a minute or two apart, and only under the night sky of the Overworld and the Farlands.',
        },
        {
          k: 'list',
          items: [
            '**Harmless.** They never hurt anyone, never touch a block, and nothing in the world notices them.',
            'Come too close and one fades out at once.',
            'With **Reduce Motion** on (Options > Accessibility), they drift slowly and keep still.',
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ the title screen
    {
      id: 'menu',
      title: 'A Haunted Title Screen',
      icon: 'jack_o_lantern',
      blocks: [
        { k: 'p', text: 'All season long, the title screen shows Halloween nights, built from real terrain like every title scene, a new one every 40 seconds: a haunted forest, a pumpkin patch, a misty marsh and, since phase 2, a Trick-or-Treat Village and an Abandoned Village. After the season, it goes back to the End Expansion.' },
        {
          k: 'gallery',
          items: [
            { img: 'title-haunted-forest', caption: 'A path into a foggy forest, lit by pumpkins. Someone is standing at the end of it.' },
            { img: 'title-pumpkin-patch', caption: 'A pumpkin patch glowing in the dark, scarecrows and all.' },
            { img: 'title-ghost-marsh', caption: 'Ghosts drifting over a misty marsh.' },
            { img: 'title-menu', caption: 'The title screen.' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ Trick-or-Treat Villages
    {
      id: 'villages',
      title: 'Trick-or-Treat Villages',
      icon: 'hallow_pumpkin',
      blocks: [
        { k: 'p', text: 'While Halloween is on, **two villages in three** are Trick-or-Treat Villages: the same villages, the same villagers, dressed for the night. Hallow Pumpkins glow by the doors, strings of orange and purple lights run along the houses, skulls watch from fence posts, jack o\'lanterns sit on the lamp posts, and there are scarecrows in the fields and pumpkins piled by the bell.' },
        {
          k: 'gallery',
          items: [
            { img: 'trick-village-door', caption: 'A house door: pumpkins, a head on a fence post, lights along the eaves.' },
            { img: 'trick-village-day', caption: 'The same village by day.' },
          ],
        },
        {
          k: 'list',
          items: [
            '**Not rare:** villages are spread out, and the season is short, so most villages you find during it are Trick-or-Treat Villages. Ordinary villages are still out there.',
            `**Every house door is a Candy Home or a Trick Home.** Each village has ${TRICK_HOMES_MIN} to ${TRICK_HOMES_MAX} Trick Homes, and from outside they look exactly the same. What waits behind them comes in phase 3.`,
            '**Only new villages,** only in worlds made in V7 or later: a village is dressed if Halloween is on when it is first explored. It stays dressed for good (even the parts explored after the season), and one first found after the season stays an ordinary village. Nothing is ever taken down.',
            'The lights are the Engineering Update\'s Factory Light in two new colours: make them at the Engineering Crafting Table from a Factory Light and orange or purple dye.',
          ],
        },
        { k: 'items', title: 'New blocks', ids: ['factory_light_orange', 'factory_light_purple'] },
        { k: 'img', img: 'title-trick-village', caption: 'A Trick-or-Treat Village on the title screen.' },
      ],
    },

    // ------------------------------------------------------------------ Abandoned Villages
    {
      id: 'abandoned',
      title: 'Abandoned Villages',
      icon: 'cobweb',
      blocks: [
        { img: 'abandoned-village', caption: 'An Abandoned Village. Something is still living here.', k: 'img' },
        { k: 'p', text: `Somewhere out there, very far apart, are villages nobody lives in any more. **Abandoned Villages are extremely rare**: about one village in ${ABANDONED_ONE_IN}, so most worlds have only a few within thousands of blocks of spawn. They are not seasonal: they are there all year.` },
        {
          k: 'list',
          items: [
            '**Ruins:** houses with fallen walls and missing roofs, broken windows, doors hanging open or gone, broken fences, rubble, cobwebs, vines and moss. Almost every light has gone out.',
            '**Ghosts** drift over them day and night.',
            '**Zombie villagers** walk the streets: the villagers who never left.',
            '**Undead guardians** keep watch: zombies and skeletons (husks in the desert, strays in the snow) that never burn in the sun, never despawn, and never leave the village. Lead them away and they turn back at its edge.',
            '**Excellent loot:** every chest is better than an ordinary village\'s, the smithy keeps the guards\' old gear, and the finest house still holds the village\'s last treasure.',
          ],
        },
        {
          k: 'gallery',
          items: [
            { img: 'abandoned-inside', caption: 'Inside: rubble, cobwebs, and the light gone.' },
            { img: 'abandoned-guardians', caption: 'A zombie villager and the guardians.' },
          ],
        },
        {
          k: 'table',
          title: 'Advancements',
          head: ['Advancement', 'How'],
          rows: [
            ['**Trick or Treat!**', 'Find a Trick-or-Treat Village'],
            ['**Ghost Town**', 'Find an Abandoned Village'],
          ],
        },
        { k: 'tip', text: 'Walking into either for the first time shows its name, like the End\'s great structures do.' },
        { k: 'img', img: 'title-abandoned-village', caption: 'An Abandoned Village on the title screen.' },
      ],
    },

    // ------------------------------------------------------------------ costume heads
    {
      id: 'heads',
      title: 'Costume Heads',
      icon: 'skeleton_skull',
      blocks: [
        { k: 'img', img: 'heads', caption: 'The four heads.' },
        { k: 'p', text: 'Four heads to collect, place and wear. None of them can be crafted.' },
        { k: 'cards', items: COSTUME_HEADS.map((h) => ({ icon: h.id, title: h.name, text: h.look })) },
        { k: 'items', title: 'The heads', ids: COSTUME_HEADS.map((h) => h.id) },
        {
          k: 'list',
          items: [
            '**Skulls, zombie heads and creeper heads** sit on fence posts by the doors of Trick-or-Treat Villages: break one to take it (it drops itself). Abandoned Villages\' chests hide a few too.',
            '**The Herobrine Head** is not found anywhere yet.',
            '**Wear one** (or a carved pumpkin): put it in your helmet slot, or use it with nothing in front of you. Everyone sees it on you.',
            'A head fools its own kind: zombies only notice someone wearing a zombie head from half as far, skeletons a skull, creepers a creeper head.',
          ],
        },
        { k: 'img', img: 'heads-worn', caption: 'Dressed up for the night.' },
      ],
    },

    // ------------------------------------------------------------------ admin panel
    {
      id: 'admin',
      title: 'Admin Panel: Halloween',
      icon: 'redstone_torch',
      blocks: [
        { k: 'img', img: 'admin', caption: 'The Halloween tab.' },
        {
          k: 'list',
          items: [
            "See whether Halloween content is on in the world and why: the season, the world's setting, or the season being over.",
            '**Show a ghost now**, day or night.',
            'Place any pumpkin, or one of each, in front of you.',
            'Simulate **after the cutoff** or **always on**, to test the season. A simulation is never saved: it ends when the world closes.',
            '**Build a Trick-or-Treat Village or an Abandoned Village** around you, in any world, in or out of the season.',
            '**Show the doors** of the nearest Trick-or-Treat Village: which are Trick Homes, and a button to go to each.',
            'Find or teleport to the nearest of either village from the **Teleport** tab.',
          ],
        },
        { k: 'img', img: 'admin-villages', caption: "The nearest Trick-or-Treat Village's doors." },
        { k: 'img', img: 'admin-simulated', caption: 'Simulating the end of the season.' },
        { k: 'tip', text: 'Like every cheat, nothing done here earns advancements, and the pumpkins and villages it places count as cheat-made.' },
      ],
    },
  ],
};
