/**
 * The Update Log's V6.5 entry: what came after The End Expansion. Browser
 * multiplayer (host from a tab, join with a code or from the friends list),
 * the Haunting in the Admin Panel, and Auto Optimize. Pictures are
 * screenshots of the game itself (public/updatelog/v6.5, made by
 * tools/update-log/).
 */
import { HAUNT_STAGES } from '../../common/game/haunting';
import type { UpdateEntry } from './updateLog';

export const V65_LOG: UpdateEntry = {
  version: 'V6.5',
  name: 'Play Together',
  tagline: 'Multiplayer from the browser, the Haunting and Auto Optimize.',
  hero: 'mp-together',
  sections: [
    // ------------------------------------------------------------------ overview
    {
      id: 'overview',
      title: 'Overview',
      icon: 'bell',
      blocks: [
        {
          k: 'p',
          text: 'V6.5 came after The End Expansion. **Multiplayer has been rebuilt**: host a world straight from your browser and your friends join from theirs, with no server to install, no terminal and no IP addresses. The Admin Panel gained **the Haunting**, and the game learned to keep itself running smoothly with **Auto Optimize**.',
        },
        {
          k: 'cards',
          title: 'At a glance',
          items: [
            { icon: 'bell', title: 'Multiplayer, no terminal', text: 'Host from your browser, join with a friend list or a code.', link: 'multiplayer' },
            { icon: 'redstone_torch', title: 'The Haunting', text: 'Herobrine, the way the old stories tell it. He even talks back.', link: 'haunting' },
            { icon: 'redstone', title: 'Auto Optimize', text: 'When the game lags badly, it lowers one setting at a time.', link: 'auto_optimize' },
          ],
        },
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
          text: 'Before V6.5, playing together meant running the MineHonk server yourself: installing Node, typing commands in a terminal, opening ports and sharing an IP address. **Now it all happens on the website.** The world runs in the host\'s browser tab and friends join from theirs. Nothing to install, no terminal, no port forwarding.',
        },
        {
          k: 'table',
          head: ['', 'Before V6.5', 'Now'],
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

    // ------------------------------------------------------------------ the Haunting
    {
      id: 'haunting',
      title: 'The Haunting',
      icon: 'redstone_torch',
      blocks: [
        { k: 'img', img: 'haunting-sighting', caption: 'Far off in the fog. Look again and he is gone.' },
        {
          k: 'p',
          text: "A new tab in the Admin Panel (worlds with cheats on): **Herobrine haunts the world**, the way the old creepypastas tell it. Choose how long it lasts (30 minutes unless you change it) and how it ends, press Start, and nobody is told. From the first sighting to the end, everyone in the world sees it.",
        },
        { k: 'table', title: 'How it goes', head: ['Stage', 'What happens'], rows: HAUNT_STAGES.map((s) => [`**${s.name}**`, s.what]) },
        {
          k: 'gallery',
          items: [
            { img: 'haunting-not-safe', caption: '"YOU ARE NOT SAFE", in glitched red.' },
            { img: 'haunting-ban', caption: 'The fake ban screen. Nobody is really banned.' },
            { img: 'haunting-lair', caption: 'The other ending: wired into a chair in his hall, inside the computer.' },
            { img: 'haunting-tab', caption: 'The Haunting tab.' },
          ],
        },
        {
          k: 'list',
          items: [
            '**He talks back.** From "He speaks" on, he answers some of what players say in chat (nearly always when it is said to him).',
            'Two endings: the jumpscare and the **fake ban screen**, or **SERVER MEMORY CORRUPTED** and his lair inside the computer. Random picks the lair one time in four.',
            'Only the world\'s owner can choose **Delete the world** at the end, and it asks twice. Otherwise the world is kept.',
            'Stop puts back every block he placed or took, and the time and weather. Nobody loses their things to a death while the world is haunted.',
            'Redstone torches now glow red in the dark, like the ones he leaves.',
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ Auto Optimize
    {
      id: 'auto_optimize',
      title: 'Auto Optimize',
      icon: 'redstone',
      blocks: [
        {
          k: 'p',
          text: 'If the game lags badly for a few seconds in a row (under 20 frames a second, or stuttering), it lowers one setting at a time, the least noticeable first: particles, clouds, resolution, render distance, then smooth lighting and fancy leaves. A message says what changed. Menus, loading screens and the first seconds after a teleport never count.',
        },
        { k: 'img', img: 'auto-optimize-toast', caption: 'What it changed, as it changes it.' },
        {
          k: 'example',
          title: 'Getting your settings back',
          text: 'Open **Options > Video Settings** and press **Undo Auto Optimize** to put back everything it lowered. The **Auto Optimize** button there switches it off.',
        },
        { k: 'img', img: 'auto-optimize-settings', caption: 'Options > Video Settings.' },
      ],
    },
  ],
};
