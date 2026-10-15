/**
 * The Update Log's V7 entry: The Halloween Update. It comes in five phases;
 * this is what is in so far, one section each, and phase 5 adds its own
 * (advancements). Pictures are screenshots of the game itself
 * (public/updatelog/v7, made by tools/update-log/ from tests/e2e/halloween.mjs,
 * villages.mjs, trick-or-treat.mjs and haunting4.mjs).
 */
import { DIMENSION_PUMPKINS } from '../../common/halloween/pumpkins';
import { HALLOWEEN_ENDS_TEXT } from '../../common/halloween/season';
import { COSTUME_HEADS } from '../../common/halloween/heads';
import { ABANDONED_ONE_IN, TRICK_HOMES_MIN, TRICK_HOMES_MAX } from '../../common/halloween/villages';
import { CANDY_HOME_ODDS, CANDY_NAMES, CANDY_KINDS, SACK_CAPACITY, KING_OUTCOMES } from '../../common/halloween/candy';
import { TEMP_ENCHANT_TICKS } from '../../common/halloween/tempEnchant';
import { TRICK_ENCOUNTERS, TRICK_KINDS, TRICK_ODDS, QUEST_STEPS, QUEST_CANDY } from '../../common/halloween/trickOrTreat';
import { AUTO_HAUNT_CHANCE, AUTO_HAUNT_MINUTES, AUTO_HAUNT_DELAY_MIN, AUTO_HAUNT_DELAY_MAX } from '../../common/game/haunting';
import { HAUNT_CAST } from '../../common/game/hauntCast';
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
  tagline: 'New hauntings: Herobrine comes back by himself, and Null, Green Steve and the Cave Dweller. Trick-or-treating, Trick-or-Treat and Abandoned Villages, costume heads, pumpkins in every dimension and ghosts at night. Phases 1 to 4 of 5.',
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
          text: `Halloween has come to MineHonk. **V7 arrives in five phases**, and four are here. Phase 1 brought the Halloween season itself, a pumpkin for every dimension, ghosts drifting by on dark nights, and a title screen of haunted nights. Phase 2 brought the villages: Trick-or-Treat Villages dressed for the season, eerie Abandoned Villages, and costume heads to wear. Phase 3 brought trick-or-treating. **Phase 4 brings new hauntings:** Herobrine can come back by himself, and three more characters from the old stories join the Admin Panel's Haunting. The season lasts until **${HALLOWEEN_ENDS_TEXT}**; hauntings are never seasonal.`,
        },
        { k: 'img', img: 'dweller-watch', caption: 'Something is watching from the edge of the light.' },
        {
          k: 'cards',
          title: 'Phase 4 at a glance',
          items: [
            { img: 'auto-sighting', title: 'Herobrine comes back', text: 'Beat him, and he may come back by himself to a new world.', link: 'auto-haunting' },
            { img: 'appear-null', title: 'Null', text: 'It takes things away while nobody is looking.', link: 'null' },
            { img: 'appear-green_steve', title: 'Green Steve', text: 'Hello, brother. He built you a house.', link: 'green-steve' },
            { img: 'appear-cave_dweller', title: 'The Cave Dweller', text: 'It lives in the dark under the world, and it follows you.', link: 'cave-dweller' },
            { icon: 'book', title: 'They talk back', text: 'Each one answers in its own voice.', link: 'voices' },
            { icon: 'redstone_torch', title: 'Admin Panel: the Haunting', text: 'Pick who haunts the world, test them, watch it go.', link: 'haunt-admin' },
          ],
        },
        {
          k: 'cards',
          title: 'Phase 3',
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
            '**Next (phase 5):** Halloween advancements, and more.',
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
        { k: 'p', text: 'While Halloween is on, the quest tracker walks you through trick-or-treating. Each step is checked against what you really have and do, and your progress is saved. It works in Creative too (the advancements along the way still only come from playing it for real).' },
        { k: 'list', items: QUEST_STEPS.map((q, i) => `**${i + 1}.** ${q.text}${q.id === 'candy' ? ` (${QUEST_CANDY} of them)` : ''}`) },
      ],
    },

    // ------------------------------------------------------------------ phase 4: the automatic haunting
    {
      id: 'auto-haunting',
      title: 'Herobrine Comes Back',
      icon: 'redstone_torch',
      blocks: [
        { k: 'img', img: 'auto-sighting', caption: 'Far off, in a world he was never asked to.' },
        {
          k: 'p',
          text: `Beat Herobrine for real (the final fight in his cave, no cheats) and your device remembers. After that, **every new world you make has a ${Math.round(AUTO_HAUNT_CHANCE * 100)}% chance** that he haunts it some day, all by himself. The chance is rolled once, when the world is made, and kept in the world: it is never rolled again.`,
        },
        {
          k: 'list',
          items: [
            `**Nothing says so.** After ${AUTO_HAUNT_DELAY_MIN / 1200} to ${AUTO_HAUNT_DELAY_MAX / 1200} minutes of play (only time with someone in the world counts, about the first night or two), the signs begin quietly: a figure in the fog, a redstone torch nobody placed.`,
            `**It lasts about ${AUTO_HAUNT_MINUTES} minutes** of play, the same stages as the Haunting from the Admin Panel: watching, signs, closer, he speaks, the end. Close the world and it carries on where it was next time.`,
            '**He notices what you do.** Breaking a lot of blocks, placing torches (he turns them red), running, staying underground, sleeping: from *Closer* on, he has something to say about it.',
            '**The world is always kept.** It ends the usual way: the ban screen, or one time in four his lair inside the computer. Then it is over, for good: he never haunts that world again.',
            "**In multiplayer:** a world someone hosts from their browser rolls when its host makes it. On a dedicated server, the player who makes the world counts. Everyone in the world sees it.",
          ],
        },
        {
          k: 'gallery',
          items: [
            { img: 'auto-notice', caption: 'He noticed you running.' },
            { img: 'auto-status', caption: 'In the Admin Panel: it began by itself.' },
          ],
        },
        { k: 'tip', text: 'Your win over him from before this update counts too, if it was in a world saved on this device.' },
      ],
    },

    // ------------------------------------------------------------------ phase 4: Null
    {
      id: 'null',
      title: 'Null',
      icon: 'sign',
      blocks: [
        { k: 'img', img: 'null-figure', caption: 'It does not move while you look at it.' },
        { k: 'p', text: `From the old story of a pitch-black figure that writes **null** on signs and changes the world while nobody is looking. **Null takes things away.** ${HAUNT_CAST.null.stages.map((x) => `*${x.name}*`).join(', ')}.` },
        {
          k: 'list',
          items: HAUNT_CAST.null.stages.map((x) => `**${x.name}:** ${x.what}`),
        },
        {
          k: 'gallery',
          items: [
            { img: 'null-sign', caption: 'Where your torch was.' },
            { img: 'null-drain', caption: 'The colour goes out of everything.' },
          ],
        },
        {
          k: 'gallery',
          items: [
            { img: 'null-erase', caption: 'The world, erased around you.' },
            { img: 'null-end', caption: 'Connection Lost. Disconnected: null.' },
          ],
        },
        { k: 'tip', text: 'Everything Null took is put back afterwards: your blocks, your torches, the ground.' },
      ],
    },

    // ------------------------------------------------------------------ phase 4: Green Steve
    {
      id: 'green-steve',
      title: 'Green Steve',
      icon: 'blue_terracotta',
      blocks: [
        { k: 'img', img: 'green-friend', caption: 'Green Steve joined the world.' },
        { k: 'p', text: 'From the old story of a player who looks like Steve, but green, who joins worlds uninvited and greets you with **"Hello, brother."** He is far too friendly, and nothing he does is what it looks like.' },
        { k: 'list', items: HAUNT_CAST.green_steve.stages.map((x) => `**${x.name}:** ${x.what}`) },
        {
          k: 'gallery',
          items: [
            { img: 'green-house', caption: 'FOR MY BROTHER. Mind the blue clay.' },
            { img: 'green-copy', caption: 'That is not you. It is wearing your name.' },
          ],
        },
        {
          k: 'table',
          title: 'How it ends',
          head: ['Ending', 'What happens'],
          rows: HAUNT_CAST.green_steve.endings.filter((e) => e.id !== 'random').map((e) => [`**${e.name}**`, e.help]),
        },
        {
          k: 'gallery',
          items: [
            { img: 'green-room', caption: 'The bedrock room. They all turn to look.' },
            { img: 'green-replaced', caption: 'Replaced: he walks away as you.' },
          ],
        },
        { k: 'tip', text: 'His creepers never explode, his rooms are always taken away again, and nobody is ever left in one.' },
      ],
    },

    // ------------------------------------------------------------------ phase 4: the Cave Dweller
    {
      id: 'cave-dweller',
      title: 'The Cave Dweller',
      icon: 'bone',
      blocks: [
        { k: 'img', img: 'dweller-watch', caption: 'Tall, pale, and frozen while you look at it.' },
        { k: 'p', text: 'From the story of a very tall, thin, pale creature that lives in the dark caves under the world. First you only hear it, skittering in the walls, breathing. Then you see it, at the edge of the light. **It stalks.**' },
        { k: 'list', items: HAUNT_CAST.cave_dweller.stages.map((x) => `**${x.name}:** ${x.what}`) },
        {
          k: 'gallery',
          items: [
            { img: 'dweller-crawl', caption: 'It runs on all fours.' },
            { img: 'dweller-drag', caption: 'Taken: dragged down into the dark.' },
          ],
        },
        {
          k: 'table',
          title: 'How the hunt ends',
          head: ['Ending', 'What happens'],
          rows: HAUNT_CAST.cave_dweller.endings.filter((e) => e.id !== 'random').map((e) => [`**${e.name}**`, e.help]),
        },
        {
          k: 'gallery',
          items: [
            { img: 'dweller-eyes', caption: 'Its den.' },
            { img: 'dweller-dawn', caption: 'Dawn: it goes back down.' },
          ],
        },
        { k: 'tip', text: 'Its lunges only push you. It never wounds anyone.' },
      ],
    },

    // ------------------------------------------------------------------ phase 4: their voices
    {
      id: 'voices',
      title: 'They Talk Back',
      icon: 'book',
      blocks: [
        { k: 'p', text: 'Once a haunting reaches its talking stage, say something in chat and whoever is haunting the world may answer, **each in its own voice**: Herobrine in cold capitals, Null in as few lowercase words as it can, Green Steve like your best friend, the Cave Dweller in whispers, with your own words.' },
        { k: 'img', img: 'haunt-talk', caption: 'Talking to Green Steve from the Admin Panel (no haunting needed).' },
        {
          k: 'list',
          items: [
            'On the online version they answer through Claude; otherwise, and whenever Claude cannot, with their own scripted lines.',
            'They are only ever told things in the game: your name in the game, what you hold, where you are, what you have been doing. Never anything about you.',
            'What they say is only ever a line of chat, through the same filter as everyone else\'s. It cannot do anything in the game.',
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ phase 4: the Admin Panel's Haunting tab
    {
      id: 'haunt-admin',
      title: 'Admin Panel: the Haunting',
      icon: 'redstone_torch',
      blocks: [
        { k: 'img', img: 'haunt-tab', caption: 'Pick who haunts the world.' },
        {
          k: 'list',
          items: [
            '**Who:** Herobrine, Null, Green Steve or the Cave Dweller. The three new ones only ever come from here, never by themselves.',
            'How long it lasts, and how it ends: each character has its own endings. Only the world owner can have the world deleted at the end.',
            '**Show it near me** and **Talk to it**, to test them without any haunting. The answer says who gave it: Claude, or the scripted lines (and why).',
            'While it runs: who, whether it began by itself, the stage, the time gone and left, when the end comes, when it talks back; **Skip**, **Straight to the end**, **The end begins in...**, and **Stop**, which puts everything back.',
            'The automatic haunting shows here too: waiting, running, or over. **End it** (for good) or **Reset** it.',
          ],
        },
        { k: 'tip', text: 'Like every cheat, nothing done here earns advancements. An automatic haunting moved along from the panel no longer counts as having been through one.' },
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
