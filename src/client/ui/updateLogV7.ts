/**
 * The Update Log's V7 entry: The Halloween Update. It comes in five phases;
 * this is what is in so far, one section each, and later phases add theirs
 * (hauntings, advancements). Pictures are screenshots of the game itself
 * (public/updatelog/v7, made by tools/update-log/ from tests/e2e/halloween.mjs,
 * villages.mjs and trick-or-treat.mjs).
 */
import { DIMENSION_PUMPKINS } from '../../common/halloween/pumpkins';
import { HALLOWEEN_ENDS_TEXT } from '../../common/halloween/season';
import { COSTUME_HEADS } from '../../common/halloween/heads';
import { ABANDONED_ONE_IN, TRICK_HOMES_MIN, TRICK_HOMES_MAX } from '../../common/halloween/villages';
import { CANDY_HOME_ODDS, CANDY_NAMES, CANDY_KINDS, SACK_CAPACITY, KING_OUTCOMES } from '../../common/halloween/candy';
import { TEMP_ENCHANT_TICKS } from '../../common/halloween/tempEnchant';
import { TRICK_ENCOUNTERS, TRICK_KINDS, TRICK_ODDS, QUEST_STEPS, QUEST_CANDY } from '../../common/halloween/trickOrTreat';
import type { UpdateEntry, Card } from './updateLog';

const pct = (n: number): string => `${n}%`;

const pumpkinCards: Card[] = DIMENSION_PUMPKINS.map((p) => ({
  img: `pumpkin-${p.dim}`,
  title: p.name,
  text: p.look,
  meta: `Grows in ${p.where} · gives off light ${p.light} · drops itself`,
}));

export const V7_LOG: UpdateEntry = {
  version: 'V7',
  name: 'The Halloween Update',
  tagline: 'Trick-or-treating: a sack, four candies, Candy Homes and Trick Homes. Trick-or-Treat Villages, Abandoned Villages, costume heads, pumpkins in every dimension and ghosts at night. Phases 1 to 3 of 5.',
  hero: 'title-trick-or-treat',
  sections: [
    // ------------------------------------------------------------------ overview
    {
      id: 'overview',
      title: 'Overview',
      icon: 'hallow_pumpkin',
      blocks: [
        {
          k: 'p',
          text: `Halloween has come to MineHonk. **V7 arrives in five phases**, and three are here. Phase 1 brought the Halloween season itself, a pumpkin for every dimension, ghosts drifting by on dark nights, and a title screen of haunted nights. Phase 2 brought the villages: Trick-or-Treat Villages dressed for the season, eerie Abandoned Villages, and costume heads to wear. **Phase 3 brings trick-or-treating:** put on a costume, take a sack, and knock on doors. The season lasts until **${HALLOWEEN_ENDS_TEXT}**.`,
        },
        { k: 'img', img: 'candy-home-give', caption: 'Trick or treat! A Candy Home answers the door.' },
        {
          k: 'cards',
          title: 'Phase 3 at a glance',
          items: [
            { icon: 'trick_or_treat_sack', title: 'The Trick-or-Treat Sack', text: `Holds ${SACK_CAPACITY} candy. Use it to look inside.`, link: 'sack' },
            { icon: 'king_sized_candy', title: 'Four candies', text: 'Mild, big, King-Sized... and poisoned.', link: 'candy' },
            { icon: 'carved_pumpkin', title: 'Knocking, Candy Homes', text: 'In a costume, with a sack: knock, and get a handful.', link: 'knocking' },
            { icon: 'skeleton_skull', title: 'Trick Homes', text: 'Something drags you inside. Fight your way to its chest.', link: 'trick-homes' },
            { icon: 'candy', title: 'The Trick or Treat! quest', text: 'Six steps, from a sack to your first ten candies.', link: 'quest' },
            { icon: 'herobrine_head', title: 'The Herobrine Head', text: 'Won from Herobrine himself, and nowhere else.', link: 'heads' },
          ],
        },
        {
          k: 'cards',
          title: 'Phase 2',
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
            '**Next:** hauntings that come by themselves, and new characters to meet.',
            '**Later:** Halloween advancements, and more.',
          ],
        },
        { k: 'tip', text: 'Halloween only adds. When the season ends, nothing is taken away: pumpkins already out there stay, and so does everything you have: your sack, your candy, your costume.' },
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
            ['**Seasonal** (the default, and every world made before V7)', 'Halloween content on', 'No new seasonal content: no knocking, no new candy, no new sacks. Everything already there stays, and works.'],
            ['**Always on**', 'Halloween content on', 'Still on, for good'],
          ],
        },
        {
          k: 'list',
          items: [
            "Online, the season goes by the hub's clock; offline, by your device's.",
            "In a world, its server decides (in multiplayer, the host's game) and tells everyone, so every player in a world always sees the same thing.",
            'Hauntings, Abandoned Villages and the Update Log are never seasonal.',
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
        { k: 'p', text: 'All season long, the title screen shows Halloween nights, built from real terrain like every title scene, a new one every 40 seconds: a haunted forest, a pumpkin patch, a misty marsh, a Trick-or-Treat Village, an Abandoned Village and, since phase 3, a trick-or-treater at a door. After the season, it goes back to the End Expansion.' },
        {
          k: 'gallery',
          items: [
            { img: 'title-trick-or-treat', caption: 'Trick or treat: a pumpkin-headed trick-or-treater with a sack, and a villager in a skull at the door.' },
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
            `**Every house door is a Candy Home or a Trick Home.** Each village has ${TRICK_HOMES_MIN} to ${TRICK_HOMES_MAX} Trick Homes, and from outside they look exactly the same. Knock and find out (see Trick-or-Treating).`,
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
            ['**Sweet!**', 'Get candy from a Candy Home (phase 3)'],
            ['**Sweet Tooth**', 'Fill a Trick-or-Treat Sack to the top (phase 3)'],
            ['**Who Goes There?**', 'Fight your way out of a Trick Home (phase 3)'],
            ['**???**', 'A secret one, in a Trick Home (phase 3)'],
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
            '**The Herobrine Head** is only ever won: beat Herobrine for real (the final fight, no cheats) and he leaves one where he fell. It is not in the creative menu, the Admin Panel or /give, and no Trick Home has one.',
            '**Wear one** (or a carved pumpkin): put it in your helmet slot, or use it with nothing in front of you. Everyone sees it on you.',
            'A head fools its own kind: zombies only notice someone wearing a zombie head from half as far, skeletons a skull, creepers a creeper head.',
          ],
        },
        { k: 'img', img: 'heads-worn', caption: 'Dressed up for the night.' },
        {
          k: 'gallery',
          items: [
            { img: 'costume-carved-pumpkin', caption: 'Phase 3: from inside a carved pumpkin...' },
            { img: 'costume-zombie-head', caption: '...or a zombie head: the edge of the mask, round the eye holes.' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ phase 3: the sack
    {
      id: 'sack',
      title: 'The Trick-or-Treat Sack',
      icon: 'trick_or_treat_sack',
      blocks: [
        { k: 'p', text: `Every trick-or-treater needs a sack. It holds **${SACK_CAPACITY} candy**, every kind together, and it keeps them wherever it goes: in a chest, on the ground, in someone else's hands, through a death, through closing the world.` },
        { k: 'example', title: 'Crafting it', text: 'String over wool (any colour), in the shape of a sack. Only while Halloween is on: after the season the recipe is gone, but every sack already made keeps working.', recipe: 'trick_or_treat_sack' },
        {
          k: 'gallery',
          items: [
            { img: 'sack-partial', caption: 'Use it to look inside: every kind of candy, how many, and the room left.' },
            { img: 'sack-full', caption: `${SACK_CAPACITY} / ${SACK_CAPACITY}: your sack is full!` },
          ],
        },
        {
          k: 'list',
          items: [
            '**Use it** (right-click) to look inside: take one candy out, take all of a kind, or eat one straight from the sack.',
            "**Put candy in**: click candy onto the sack in your inventory (right-click for just one), click the sack onto candy, or press **Put all candy in** in the sack's window.",
            '**When it is full**: "Your sack is full!", and anything more goes into your inventory, or onto the ground at your feet.',
            `Its tooltip says how full it is ("n / ${SACK_CAPACITY} candy"), and a bar on the sack's slot fills up.`,
            'Every change is made by the game server and checked there: candy is moved, never copied, so none can be made or lost.',
          ],
        },
        { k: 'img', img: 'sack-tooltip', caption: 'What is in it, at a glance.' },
      ],
    },

    // ------------------------------------------------------------------ phase 3: candy
    {
      id: 'candy',
      title: 'Candy',
      icon: 'king_sized_candy',
      blocks: [
        { k: 'p', text: 'Four candies, eaten like any food, even when you are not hungry. A candy\'s effect refreshes rather than stacks: eat two and it simply lasts from the second one.' },
        {
          k: 'table',
          head: ['Candy', 'What it does', 'From a Candy Home'],
          rows: [
            [`**${CANDY_NAMES.regular}**`, 'A short, mild buff: Speed, Jump Boost or Haste, for 20 seconds.', pct(CANDY_HOME_ODDS.regular)],
            [`**${CANDY_NAMES.big}**`, 'Two of those at once, for 45 seconds.', pct(CANDY_HOME_ODDS.big)],
            [`**${CANDY_NAMES.king}**`, `Rare, and worth it: strong buffs for a minute (${pct(KING_OUTCOMES.find((o) => o.kind === 'buffs')!.weight)}), a temporary enchantment on what you hold or wear for ${Math.round(TEMP_ENCHANT_TICKS / 1200)} minutes (${pct(KING_OUTCOMES.find((o) => o.kind === 'enchant')!.weight)}), or a few gold ingots or a diamond (${pct(KING_OUTCOMES.find((o) => o.kind === 'payout')!.weight)}).`, pct(CANDY_HOME_ODDS.king)],
            [`**${CANDY_NAMES.poisoned}**`, 'Warped and the wrong colour, wherever you see it. Poison, Wither, Blindness or a little health lost: never enough to kill you from full health.', pct(CANDY_HOME_ODDS.poisoned)],
          ],
        },
        { k: 'items', title: 'The candies', ids: CANDY_KINDS.map((k) => (k === 'regular' ? 'candy' : k === 'big' ? 'big_candy' : k === 'king' ? 'king_sized_candy' : 'poisoned_candy')) },
        {
          k: 'gallery',
          items: [
            { img: 'candy-ground', caption: 'All four on the ground. You can tell which one not to eat.' },
            { img: 'hand-poisoned', caption: 'Even in your hand, the Poisoned Candy looks wrong.' },
          ],
        },
        {
          k: 'list',
          items: [
            "A King-Sized Candy's enchantment is always one the item could have (no conflicts, never above its usual top level), and it runs out on time wherever the item is: in your hand, a chest, the ground. It never becomes permanent, and a real enchantment from a table or an anvil replaces it.",
            'Candy made by cheats stays cheat-made, even inside a sack.',
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ phase 3: knocking
    {
      id: 'knocking',
      title: 'Trick-or-Treating',
      icon: 'carved_pumpkin',
      blocks: [
        { k: 'p', text: 'Go to a Trick-or-Treat Village, stand at a house door and look at it: a **Knock** prompt appears. Press **G** (or tap the prompt). Right-clicking the door still just opens it; knocking is its own action, so neither gets in the way of the other.' },
        { k: 'img', img: 'knock-prompt', caption: 'Looking at a door of a Trick-or-Treat Village.' },
        {
          k: 'list',
          items: [
            '**You need a costume** on your head (a costume head or a carved pumpkin) **and a sack with room in it.** Without them, a voice behind the door tells you so: "No costume, no candy!", "Where would you even put it? Bring a sack!", "Your sack is already full, greedy!", and more.',
            '**A Candy Home** opens its door: a villager in a costume greets you, hands you **1 to 3 candies** (straight into your sack), says goodbye and shuts the door. Each answers in its own way. Skip it if you like (Space, Esc or Skip): the candy is yours the moment the door opens.',
            '**Once per player per Candy Home.** Knock again and: "You already got candy here!"',
            'With friends, everyone knocks for themselves. Others nearby see the door open and the villager, not your view.',
            'Only while Halloween is on. After the season, nobody answers.',
          ],
        },
        {
          k: 'gallery',
          items: [
            { img: 'rejected', caption: 'No costume, no candy.' },
            { img: 'candy-home', caption: 'A Candy Home answers.' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ phase 3: Trick Homes
    {
      id: 'trick-homes',
      title: 'Trick Homes',
      icon: 'skeleton_skull',
      blocks: [
        { k: 'p', text: 'A Trick Home looks just like a Candy Home from outside. Knock, and the door creaks open, something grabs you and **drags you inside**, and the door slams behind you. Beat what is in there and **a chest appears**: candy (Big and King-Sized among it), useful things, and now and then something great.' },
        {
          k: 'gallery',
          items: [
            { img: 'trick-grab', caption: 'Grabbed...' },
            { img: 'trick-drag', caption: '...and dragged inside.' },
          ],
        },
        {
          k: 'table',
          title: 'What waits inside (the same each time, for each house)',
          head: ['Encounter', 'Who', 'Chance'],
          rows: TRICK_KINDS.map((k) => [`**${TRICK_ENCOUNTERS[k].name}**`, [...new Set(TRICK_ENCOUNTERS[k].mobs)].map((m) => m.replace(/_/g, ' ')).join(', '), k === 'herobrine' ? '1 in 100' : pct(TRICK_ODDS[k])]),
        },
        {
          k: 'gallery',
          items: [
            { img: 'trick-fight', caption: 'The door slammed. Now what?' },
            { img: 'trick-loot', caption: 'Beaten: its chest.' },
          ],
        },
        {
          k: 'list',
          items: [
            'Every encounter can be beaten with ordinary gear. Its monsters keep to the house and drop nothing: the chest is the reward.',
            '**You can always get out:** open the door, or break it. Leave, or die, and it ends: its monsters are gone, nothing is used up, and you can try again.',
            "**Herobrine** is behind about one Trick Home in a hundred: a short, frightening fight with his own reward. He blinks about the room and hits hard, but goes down quickly. (His head is not in there.)",
            '**With friends:** one encounter per house at a time. Friends can follow you in through the door; nobody else is dragged into a fight already going on. Its chest is there once, for everyone.',
          ],
        },
        { k: 'img', img: 'trick-herobrine', caption: 'Rarely, very rarely, it is him.' },
      ],
    },

    // ------------------------------------------------------------------ phase 3: the quest
    {
      id: 'quest',
      title: 'The Trick or Treat! Quest',
      icon: 'candy',
      blocks: [
        { k: 'img', img: 'quest', caption: 'The quest tracker, on its first step.' },
        { k: 'p', text: 'While Halloween is on, the quest tracker walks you through trick-or-treating. Each step is checked against what you really have and do (things made by cheats do not count), and your progress is saved.' },
        { k: 'list', items: QUEST_STEPS.map((q, i) => `**${i + 1}.** ${q.text}${q.id === 'candy' ? ` (${QUEST_CANDY} of them)` : ''}`) },
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
            '**Phase 3:** give a sack (empty or full) and each candy; **knock on the nearest door** ignoring every requirement; **start a Trick Home** of any kind (Herobrine too) at the nearest door; and **reset the nearest village\'s doors**. None of it uses up a real door.',
          ],
        },
        { k: 'img', img: 'admin-trick', caption: 'Trick-or-treating, in the Halloween tab.' },
        { k: 'img', img: 'admin-villages', caption: "The nearest Trick-or-Treat Village's doors." },
        { k: 'img', img: 'admin-simulated', caption: 'Simulating the end of the season.' },
        { k: 'tip', text: 'Like every cheat, nothing done here earns advancements, and the pumpkins and villages it places count as cheat-made.' },
      ],
    },
  ],
};
