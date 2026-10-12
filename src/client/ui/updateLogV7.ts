/**
 * The Update Log's V7 entry: The Halloween Update. It comes in five phases;
 * this is what is in so far, one section each, and later phases add theirs
 * (villages, trick-or-treating, hauntings, advancements) before
 * "advancements" and "more". Pictures are screenshots of the game itself
 * (public/updatelog/v7, made by tools/update-log/ from tests/e2e/halloween.mjs).
 */
import { DIMENSION_PUMPKINS } from '../../common/halloween/pumpkins';
import { HALLOWEEN_ENDS_TEXT } from '../../common/halloween/season';
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
  tagline: 'Pumpkins in every dimension, ghosts at night, and a haunted title screen. Phase 1 of 5.',
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
          text: `Halloween has come to MineHonk. **V7 arrives in five phases**, and the first is here: the Halloween season itself, a pumpkin for every dimension, ghosts drifting by on dark nights, and a title screen of haunted nights. The season lasts until **${HALLOWEEN_ENDS_TEXT}**.`,
        },
        {
          k: 'cards',
          title: 'Phase 1 at a glance',
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
            '**Next:** Trick-or-Treat Villages and Abandoned Villages.',
            '**Then:** trick-or-treating: a sack, candy, costume heads, and knocking on doors.',
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
        { k: 'p', text: 'All season long, the title screen shows Halloween nights, built from real terrain like every title scene, a new one every 40 seconds. After the season, it goes back to the End Expansion.' },
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
          ],
        },
        { k: 'img', img: 'admin-simulated', caption: 'Simulating the end of the season.' },
        { k: 'tip', text: 'Like every cheat, nothing done here earns advancements, and the pumpkins it places count as cheat-made.' },
      ],
    },
  ],
};
