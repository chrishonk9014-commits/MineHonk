/**
 * Menu screens. Each screen is a DOM subtree managed by the App's screen
 * stack. Screens never talk to the server directly; they call back into
 * the App which owns the connection and game.
 */
import { el, button, clear, slider, cycle } from './dom';
import type { Settings, KeyBinds, Profile } from '../settings';
import { DEFAULT_KEYS, saveSettings, saveProfile } from '../settings';
import { GAME_MODE_INFO, GOD_HEART_PRESETS, normalizeGodHearts, type GameMode, type Difficulty, type GodHearts } from '../../common/game/gamemode';
import { ACHIEVEMENTS } from '../../common/data/achievements';
import { itemById } from '../../common/registry/items';
import type { ItemIcons } from '../render/ItemIcons';
import { LIMITS } from '../../common/net/protocol';

export interface Screen {
  root: HTMLElement;
  /** Escape closes the screen (default true). */
  escapable?: boolean;
  onClose?(): void;
  onKey?(e: KeyboardEvent): boolean;
}

export interface ScreenHost {
  push(s: Screen): void;
  pop(): void;
  replace(s: Screen): void;
  readonly settings: Settings;
  readonly icons: ItemIcons;
  uiClick(): void;
  settingsChanged(rebuildChunks?: boolean): void;
}

export function titled(title: string, cls = 'screen dirt'): { root: HTMLElement; body: HTMLElement } {
  const body = el('div', { class: 'stack' });
  const root = el('div', { class: cls }, el('div', { class: 'title-text' }, title), body);
  return { root, body };
}

export function wrapClick(host: ScreenHost, f: () => void): () => void {
  return () => {
    host.uiClick();
    f();
  };
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------
const SPLASHES = [
  'The Digital Corruption Update!',
  'Do not plug it in!',
  'Removed Herobrine!',
  '478868574082066804',
  'Now with computers!',
  'HonkOS 5.5!',
  'Feed it to the dragon?',
  'Keyboard not found. Press F1!',
  'He is never where you saw him.',
  'The Engineering Update!',
  'Now with conveyor belts!',
  'Measured in EU/t!',
  'Redstone, but better!',
  'Read the Engineering Book!',
  'Mind the hazard stripes!',
  'Automate everything!',
  'Now with more honk!',
  'Last one standing wins!',
  'The keycard is outside!',
  'Bedrock-sealed bunkers!',
  'Bow before the pyramid!',
  'What is that chunk?',
  'Now with bunkers!',
  'Villages, planned!',
  'ERROR DEFEATED?',
  'Deeper than ever!',
  'Listen. Something is listening back.',
  'Bring a torch!',
  'Blocks all the way down!',
  'Infinite hearts optional!',
  'Beware the Farlands!',
  '100% original pixels!',
  'Server authoritative!',
  'Punch a tree!',
  'The dragon awaits!',
  'Also try gardening!',
  'Glitched and loving it!',
  'Deterministic seeds!',
  'Made of voxels!',
];

export function titleScreen(host: ScreenHost, actions: { singleplayer: () => void; multiplayer: () => void; options: () => void; profile: () => void }, profile: Profile): Screen {
  const logo = el('div', { class: 'logo' }, 'MINEHONK', el('div', { class: 'logo-edition' }, 'V5.5 - The Digital Corruption Update'), el('div', { class: 'splash' }, SPLASHES[Math.floor(Math.random() * SPLASHES.length)]!));
  const body = el(
    'div',
    { class: 'stack', style: { marginTop: 'calc(var(--s) * 40)' } },
    button('Singleplayer', wrapClick(host, actions.singleplayer)),
    button('Multiplayer', wrapClick(host, actions.multiplayer)),
    el('div', { class: 'row' }, button('Options...', wrapClick(host, actions.options), 'btn half'), button(`Profile: ${profile.name}`, wrapClick(host, actions.profile), 'btn half')),
  );
  const footer = el('div', { class: 'footer' }, el('span', {}, 'MineHonk V5.5 - The Digital Corruption Update'), el('span', {}, 'Original game — all art & sound generated'));
  return { root: el('div', { class: 'screen dirt title-screen' }, logo, body, footer), escapable: false };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export function profileScreen(host: ScreenHost, profile: Profile, done: () => void): Screen {
  const { root, body } = titled('Profile');
  const input = el('input', { class: 'field', value: profile.name, maxLength: LIMITS.nameLength }) as HTMLInputElement;
  const err = el('div', { class: 'error-text' });
  const save = (): void => {
    const v = input.value.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(v)) {
      err.textContent = 'Names are 3-16 letters, digits or _';
      return;
    }
    profile.name = v;
    saveProfile(profile);
    host.pop();
    done();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') save();
  });
  body.append(el('div', { class: 'label' }, 'Player name (used in single player and LAN-style worlds)'), input, err, el('div', { class: 'spacer' }), el('div', { class: 'row' }, button('Done', wrapClick(host, save), 'btn half'), button('Cancel', wrapClick(host, () => host.pop()), 'btn half')));
  setTimeout(() => input.focus(), 0);
  return { root };
}

// ---------------------------------------------------------------------------
// World selection
// ---------------------------------------------------------------------------
export interface WorldSummary {
  id: string;
  name: string;
  mode: GameMode;
  godHearts: GodHearts;
  hardcore: boolean;
  lastPlayed: number;
  seed: string;
  icon?: string;
  cheats?: boolean;
}

export function worldListScreen(
  host: ScreenHost,
  worlds: WorldSummary[],
  actions: { play: (id: string) => void; create: () => void; remove: (id: string) => Promise<void>; rename: (id: string, name: string) => Promise<void>; exportWorld: (id: string) => Promise<void>; importWorld: (file: File) => Promise<void>; refresh: () => void },
): Screen {
  const { root, body } = titled('Select World');
  let selected: string | null = worlds[0]?.id ?? null;
  const list = el('div', { class: 'list' });
  const playBtn = button('Play Selected World', () => selected && (host.uiClick(), actions.play(selected)), 'btn half');
  const editBtn = button('Rename', () => {}, 'btn small-q');
  const delBtn = button('Delete', () => {}, 'btn small-q');
  const expBtn = button('Export', () => {}, 'btn small-q');
  const render = (): void => {
    clear(list);
    if (worlds.length === 0) list.append(el('div', { class: 'muted', style: { padding: 'calc(var(--s) * 8)', textAlign: 'center' } }, 'No worlds yet — create one!'));
    for (const w of worlds) {
      const modeText = w.mode === 'god' ? `God Mode (${w.godHearts === 'infinite' ? '∞' : w.godHearts} hearts)` : GAME_MODE_INFO[w.mode]?.name ?? w.mode;
      const item = el(
        'div',
        { class: 'list-item' + (w.id === selected ? ' selected' : '') },
        el('div', { class: 'icon', style: { backgroundImage: w.icon ? `url(${w.icon})` : 'var(--menu-tex)', backgroundSize: w.icon ? 'cover' : 'calc(var(--s) * 16)' } }),
        el('div', {}, el('div', {}, w.name), el('div', { class: 'meta' }, `${new Date(w.lastPlayed).toLocaleString()}`), el('div', { class: 'meta' + (w.hardcore ? ' error-text' : '') }, modeText + (w.cheats ? ', Cheats' : ''))),
      );
      item.addEventListener('click', () => {
        selected = w.id;
        render();
      });
      item.addEventListener('dblclick', () => {
        host.uiClick();
        actions.play(w.id);
      });
      list.append(item);
    }
    for (const b of [playBtn, editBtn, delBtn, expBtn]) b.disabled = !selected;
  };
  editBtn.onclick = (e) => {
    e.stopPropagation();
    const w = worlds.find((x) => x.id === selected);
    if (!w) return;
    host.uiClick();
    host.push(textPrompt(host, 'Rename World', w.name, 48, async (v) => {
      await actions.rename(w.id, v);
      w.name = v;
      render();
    }));
  };
  delBtn.onclick = (e) => {
    e.stopPropagation();
    const w = worlds.find((x) => x.id === selected);
    if (!w) return;
    host.uiClick();
    host.push(
      confirmScreen(host, 'Are you sure you want to delete this world?', `'${w.name}' will be lost forever! (A long time!)`, 'Delete', async () => {
        await actions.remove(w.id);
        worlds.splice(worlds.indexOf(w), 1);
        selected = worlds[0]?.id ?? null;
        render();
      }),
    );
  };
  expBtn.onclick = (e) => {
    e.stopPropagation();
    if (!selected) return;
    host.uiClick();
    void actions.exportWorld(selected);
  };
  const fileInput = el('input', { type: 'file', accept: '.mhworld', style: { display: 'none' } }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void actions.importWorld(f).then(actions.refresh);
  });
  const importBtn = button('Import', () => fileInput.click(), 'btn small-q');
  render();
  body.append(
    list,
    el('div', { class: 'row' }, playBtn, button('Create New World', wrapClick(host, actions.create), 'btn half')),
    el('div', { class: 'row' }, editBtn, delBtn, expBtn, importBtn),
    el('div', { class: 'row' }, button('Cancel', wrapClick(host, () => host.pop()), 'btn half')),
    fileInput,
  );
  return { root };
}

export function textPrompt(host: ScreenHost, title: string, value: string, max: number, done: (v: string) => void | Promise<void>): Screen {
  const { root, body } = titled(title);
  const input = el('input', { class: 'field', value, maxLength: max }) as HTMLInputElement;
  const ok = async (): Promise<void> => {
    const v = input.value.trim();
    if (!v) return;
    await done(v);
    host.pop();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') void ok();
  });
  body.append(input, el('div', { class: 'spacer' }), el('div', { class: 'row' }, button('Done', wrapClick(host, () => void ok()), 'btn half'), button('Cancel', wrapClick(host, () => host.pop()), 'btn half')));
  setTimeout(() => input.select(), 0);
  return { root };
}

export function confirmScreen(host: ScreenHost, title: string, text: string, okLabel: string, ok: () => void | Promise<void>): Screen {
  const { root, body } = titled(title);
  body.append(el('div', { class: 'muted', style: { maxWidth: 'calc(var(--s) * 300)', textAlign: 'center' } }, text), el('div', { class: 'spacer' }), el('div', { class: 'row' }, button(okLabel, wrapClick(host, async () => {
    await ok();
    host.pop();
  }), 'btn half'), button('Cancel', wrapClick(host, () => host.pop()), 'btn half')));
  return { root };
}

export function messageScreen(host: ScreenHost, title: string, text: string, onOk?: () => void): Screen {
  const { root, body } = titled(title);
  body.append(el('div', { class: 'muted', style: { maxWidth: 'calc(var(--s) * 300)', textAlign: 'center', whiteSpace: 'pre-wrap' } }, text), el('div', { class: 'spacer' }), button('Back', wrapClick(host, () => (host.pop(), onOk?.()))));
  return { root };
}

// ---------------------------------------------------------------------------
// Create world
// ---------------------------------------------------------------------------
export interface CreateWorldOptions {
  name: string;
  seed: string;
  mode: GameMode;
  difficulty: Difficulty;
  godHearts: GodHearts;
  godHunger: boolean;
  godHazards: boolean;
  cheats: boolean;
  bonusChest: boolean;
  generateStructures: boolean;
  keepInventory: boolean;
}

export function createWorldScreen(host: ScreenHost, create: (o: CreateWorldOptions) => void): Screen {
  const o: CreateWorldOptions = { name: 'New World', seed: '', mode: 'survival', difficulty: 'normal', godHearts: 10, godHunger: true, godHazards: true, cheats: false, bonusChest: false, generateStructures: true, keepInventory: false };
  const { root, body } = titled('Create New World');
  const nameInput = el('input', { class: 'field', value: o.name, maxLength: 48 }) as HTMLInputElement;
  const seedInput = el('input', { class: 'field', placeholder: 'Leave blank for a random seed', maxLength: 64 }) as HTMLInputElement;
  for (const i of [nameInput, seedInput]) i.addEventListener('keydown', (e) => e.stopPropagation());
  const modeDesc = el('div', { class: 'muted mode-desc' });
  const godBox = el('div', { class: 'stack god-box' });
  const heartsLabel = el('div', { class: 'yellow' });
  const presetRow = el('div', { class: 'row wrap' });
  const customInput = el('input', { class: 'field', type: 'number', min: 1, max: 100000, placeholder: 'Custom hearts', style: { width: 'calc(var(--s) * 100)' } }) as HTMLInputElement;
  customInput.addEventListener('keydown', (e) => e.stopPropagation());
  const diffBtn = cycle((v: Difficulty) => `Difficulty: ${v[0]!.toUpperCase() + v.slice(1)}`, ['peaceful', 'easy', 'normal', 'hard'] as const, o.difficulty, (v) => (o.difficulty = v));
  const cheatsBtn = cycle((v: boolean) => `Allow Cheats: ${v ? 'ON' : 'OFF'}`, [false, true], o.cheats, (v) => (o.cheats = v));
  const updateHearts = (): void => {
    const h = o.godHearts;
    heartsLabel.textContent = h === 'infinite' ? 'Max health: ∞ Infinite hearts' : `Max health: ${h} heart${h === 1 ? '' : 's'} (${h * 2} HP)`;
    for (const b of presetRow.children) (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.v === String(h));
  };
  for (const p of GOD_HEART_PRESETS) {
    const b = el('button', { class: 'btn chip' }, p === 'infinite' ? '∞' : String(p)) as HTMLButtonElement;
    b.dataset.v = String(p);
    b.onclick = (e) => {
      e.stopPropagation();
      host.uiClick();
      o.godHearts = p;
      customInput.value = '';
      updateHearts();
    };
    presetRow.append(b);
  }
  customInput.addEventListener('input', () => {
    if (customInput.value === '') return;
    o.godHearts = normalizeGodHearts(customInput.value);
    updateHearts();
  });
  godBox.append(
    heartsLabel,
    presetRow,
    el('div', { class: 'row' }, customInput, el('div', { class: 'muted', style: { maxWidth: 'calc(var(--s) * 120)' } }, 'Values above 99 become infinite.')),
    el('div', { class: 'row' }, cycle((v: boolean) => `Hunger: ${v ? 'ON' : 'OFF'}`, [true, false], o.godHunger, (v) => (o.godHunger = v)), cycle((v: boolean) => `Hazards: ${v ? 'ON' : 'OFF'}`, [true, false], o.godHazards, (v) => (o.godHazards = v))),
    el('div', { class: 'muted', style: { maxWidth: 'calc(var(--s) * 300)', textAlign: 'center' } }, 'With infinite health, damage cannot kill you, but knockback, effects, hunger and hazards still apply unless turned off.'),
  );
  const modes: GameMode[] = ['survival', 'hardcore', 'creative', 'adventure', 'god', 'spectator'];
  const updateMode = (): void => {
    modeDesc.textContent = GAME_MODE_INFO[o.mode].description;
    godBox.classList.toggle('hidden', o.mode !== 'god');
    diffBtn.disabled = o.mode === 'hardcore';
    cheatsBtn.disabled = o.mode === 'hardcore';
    if (o.mode === 'creative' || o.mode === 'spectator') o.cheats = true;
    cheatsBtn.textContent = `Allow Cheats: ${o.mode === 'hardcore' ? 'OFF' : o.cheats ? 'ON' : 'OFF'}`;
  };
  const modeBtn = cycle((v: GameMode) => `Game Mode: ${GAME_MODE_INFO[v].name}`, modes, o.mode, (v) => {
    host.uiClick();
    o.mode = v;
    updateMode();
  });
  modeBtn.style.width = 'calc(var(--s) * 200)';
  const more = el('div', { class: 'stack hidden' });
  more.append(
    el('div', { class: 'label' }, 'Seed for the world generator'),
    seedInput,
    el('div', { class: 'row' }, cycle((v: boolean) => `Generate Structures: ${v ? 'ON' : 'OFF'}`, [true, false], true, (v) => (o.generateStructures = v)), cycle((v: boolean) => `Bonus Chest: ${v ? 'ON' : 'OFF'}`, [false, true], false, (v) => (o.bonusChest = v))),
    el('div', { class: 'row' }, cycle((v: boolean) => `Keep Inventory: ${v ? 'ON' : 'OFF'}`, [false, true], false, (v) => (o.keepInventory = v))),
  );
  const moreBtn = button('More World Options...', () => {
    host.uiClick();
    more.classList.toggle('hidden');
  });
  body.append(el('div', { class: 'label' }, 'World Name'), nameInput, el('div', { class: 'spacer' }), modeBtn, modeDesc, godBox, el('div', { class: 'row' }, diffBtn, cheatsBtn), moreBtn, more, el('div', { class: 'spacer' }), el('div', { class: 'row' }, button('Create New World', wrapClick(host, () => {
    o.name = nameInput.value.trim() || 'New World';
    o.seed = seedInput.value.trim();
    if (o.mode === 'hardcore') {
      o.difficulty = 'hard';
      o.cheats = false;
    }
    create(o);
  }), 'btn half'), button('Cancel', wrapClick(host, () => host.pop()), 'btn half')));
  updateMode();
  updateHearts();
  return { root };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export function optionsScreen(host: ScreenHost, inGame: boolean): Screen {
  const s = host.settings;
  const { root, body } = titled('Options', inGame ? 'screen dim' : 'screen dirt');
  const change = (rebuild = false): void => {
    saveSettings(s);
    host.settingsChanged(rebuild);
  };
  body.append(
    el('div', { class: 'row' }, slider((v) => `FOV: ${v === 70 ? 'Normal' : v >= 110 ? 'Quake Pro' : v}`, s.fov, 30, 110, 1, (v) => ((s.fov = v), change())), slider((v) => `Render Distance: ${v} chunks`, s.renderDistance, 2, 32, 1, (v) => ((s.renderDistance = v), change()))),
    el('div', { class: 'spacer' }),
    el('div', { class: 'row' }, button('Video Settings...', wrapClick(host, () => host.push(videoScreen(host, inGame))), 'btn half'), button('Music & Sounds...', wrapClick(host, () => host.push(soundScreen(host, inGame))), 'btn half')),
    el('div', { class: 'row' }, button('Controls...', wrapClick(host, () => host.push(controlsScreen(host, inGame))), 'btn half'), button('Accessibility...', wrapClick(host, () => host.push(accessibilityScreen(host, inGame))), 'btn half')),
    el('div', { class: 'spacer' }),
    button('Done', wrapClick(host, () => host.pop())),
  );
  return { root };
}

function videoScreen(host: ScreenHost, inGame: boolean): Screen {
  const s = host.settings;
  const { root, body } = titled('Video Settings', inGame ? 'screen dim' : 'screen dirt');
  const change = (rebuild = false): void => {
    saveSettings(s);
    host.settingsChanged(rebuild);
  };
  const onOff = (v: boolean): string => (v ? 'ON' : 'OFF');
  body.append(
    el('div', { class: 'row' }, slider((v) => `Render Distance: ${v}`, s.renderDistance, 2, 32, 1, (v) => ((s.renderDistance = v), change())), slider((v) => `Brightness: ${v === 0 ? 'Moody' : v === 1 ? 'Bright' : Math.round(v * 100) + '%'}`, s.brightness, 0, 1, 0.01, (v) => ((s.brightness = v), change()))),
    el('div', { class: 'row' }, cycle((v: number) => `GUI Scale: ${v === 0 ? 'Auto' : v}`, [0, 1, 2, 3, 4], s.guiScale, (v) => ((s.guiScale = v), change())), cycle((v: Settings['particles']) => `Particles: ${v[0]!.toUpperCase() + v.slice(1)}`, ['all', 'decreased', 'minimal'] as const, s.particles, (v) => ((s.particles = v), change()))),
    el('div', { class: 'row' }, cycle((v: boolean) => `Smooth Lighting: ${onOff(v)}`, [true, false], s.smoothLighting, (v) => ((s.smoothLighting = v), change(true))), cycle((v: boolean) => `Leaves: ${v ? 'Fancy' : 'Fast'}`, [true, false], s.fancyLeaves, (v) => ((s.fancyLeaves = v), change(true)))),
    el('div', { class: 'row' }, cycle((v: boolean) => `Clouds: ${onOff(v)}`, [true, false], s.clouds, (v) => ((s.clouds = v), change())), cycle((v: boolean) => `View Bobbing: ${onOff(v)}`, [true, false], s.viewBobbing, (v) => ((s.viewBobbing = v), change()))),
    el('div', { class: 'row' }, slider((v) => `Max Framerate: ${v === 0 ? 'Unlimited' : v + ' fps'}`, s.maxFps, 0, 240, 10, (v) => ((s.maxFps = v), change())), slider((v) => `Resolution: ${Math.round(v * 100)}%`, s.resolutionScale, 0.25, 1, 0.05, (v) => ((s.resolutionScale = v), change()))),
    el('div', { class: 'row' }, cycle((v: boolean) => `Show FPS: ${onOff(v)}`, [false, true], s.showFps, (v) => ((s.showFps = v), change()))),
    el('div', { class: 'label', style: { marginTop: 'calc(var(--s) * 4)' } }, 'Render distance presets'),
    el(
      'div',
      { class: 'row' },
      ...RENDER_PRESETS.map((p) =>
        button(
          `${p.name} (${p.chunks})`,
          wrapClick(host, () => {
            s.renderDistance = p.chunks;
            change();
            host.replace(videoScreen(host, inGame));
          }),
          'btn chip' + (s.renderDistance === p.chunks ? ' active' : ''),
        ),
      ),
    ),
    el('div', { class: 'spacer' }),
    button('Done', wrapClick(host, () => host.pop())),
  );
  return { root };
}

/** Render distance presets (chunks). */
export const RENDER_PRESETS = [
  { name: 'Low', chunks: 6 },
  { name: 'Medium', chunks: 8 },
  { name: 'High', chunks: 12 },
  { name: 'Very High', chunks: 16 },
];

function soundScreen(host: ScreenHost, inGame: boolean): Screen {
  const s = host.settings;
  const { root, body } = titled('Music & Sound Options', inGame ? 'screen dim' : 'screen dirt');
  const change = (): void => {
    saveSettings(s);
    host.settingsChanged(false);
  };
  const pct = (name: string) => (v: number) => `${name}: ${v === 0 ? 'OFF' : Math.round(v * 100) + '%'}`;
  body.append(
    slider(pct('Master Volume'), s.masterVolume, 0, 1, 0.01, (v) => ((s.masterVolume = v), change())),
    el('div', { class: 'row' }, slider(pct('Music'), s.musicVolume, 0, 1, 0.01, (v) => ((s.musicVolume = v), change())), slider(pct('Sounds'), s.soundVolume, 0, 1, 0.01, (v) => ((s.soundVolume = v), change()))),
    el('div', { class: 'row' }, slider(pct('Ambient'), s.ambientVolume, 0, 1, 0.01, (v) => ((s.ambientVolume = v), change())), cycle((v: boolean) => `Subtitles: ${v ? 'ON' : 'OFF'}`, [false, true], s.subtitles, (v) => ((s.subtitles = v), change()))),
    el('div', { class: 'spacer' }),
    button('Done', wrapClick(host, () => host.pop())),
  );
  return { root };
}

const KEY_LABELS: Record<keyof KeyBinds, string> = {
  forward: 'Walk Forwards',
  back: 'Walk Backwards',
  left: 'Strafe Left',
  right: 'Strafe Right',
  jump: 'Jump',
  sneak: 'Sneak',
  sprint: 'Sprint',
  inventory: 'Open/Close Inventory',
  drop: 'Drop Selected Item',
  chat: 'Open Chat',
  command: 'Open Command',
  swapHands: 'Swap Item With Offhand',
  playerList: 'List Players',
  debug: 'Debug Screen',
  perspective: 'Toggle Perspective',
  pause: 'Pause',
  hideHud: 'Hide HUD',
  fullscreen: 'Toggle Fullscreen',
  screenshot: 'Take Screenshot',
  achievements: 'Advancements',
  adminPanel: 'Admin Panel (cheats)',
};

export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', Escape: 'Esc', Slash: '/', Backquote: '`' };
  return map[code] ?? code;
}

function controlsScreen(host: ScreenHost, inGame: boolean): Screen {
  const s = host.settings;
  const { root, body } = titled('Controls', inGame ? 'screen dim' : 'screen dirt');
  const change = (): void => {
    saveSettings(s);
    host.settingsChanged(false);
  };
  const list = el('div', { class: 'list keybinds' });
  let waiting: { action: keyof KeyBinds; btn: HTMLButtonElement } | null = null;
  const render = (): void => {
    clear(list);
    const used = new Map<string, number>();
    for (const v of Object.values(s.keys)) used.set(v, (used.get(v) ?? 0) + 1);
    for (const action of Object.keys(KEY_LABELS) as (keyof KeyBinds)[]) {
      const code = s.keys[action];
      const b = el('button', { class: 'btn' + ((used.get(code) ?? 0) > 1 ? ' conflict' : ''), style: { width: 'calc(var(--s) * 75)' } }, keyName(code)) as HTMLButtonElement;
      b.onclick = (e) => {
        e.stopPropagation();
        host.uiClick();
        waiting = { action, btn: b };
        b.textContent = '> ? <';
      };
      list.append(el('div', { class: 'row', style: { justifyContent: 'space-between', padding: 'calc(var(--s) * 1) calc(var(--s) * 4)' } }, el('span', {}, KEY_LABELS[action]), b));
    }
  };
  render();
  body.append(
    el('div', { class: 'row' }, slider((v) => `Sensitivity: ${Math.round(v * 100)}%`, s.sensitivity, 0.1, 3, 0.05, (v) => ((s.sensitivity = v), change())), cycle((v: boolean) => `Invert Mouse: ${v ? 'ON' : 'OFF'}`, [false, true], s.invertY, (v) => ((s.invertY = v), change()))),
    list,
    el('div', { class: 'row' }, button('Reset Keys', wrapClick(host, () => ((s.keys = { ...DEFAULT_KEYS }), change(), render())), 'btn half'), button('Done', wrapClick(host, () => host.pop()), 'btn half')),
  );
  return {
    root,
    onKey(e) {
      if (!waiting) return false;
      e.preventDefault();
      if (e.code !== 'Escape') s.keys[waiting.action] = e.code;
      waiting = null;
      change();
      render();
      return true;
    },
  };
}

function accessibilityScreen(host: ScreenHost, inGame: boolean): Screen {
  const s = host.settings;
  const { root, body } = titled('Accessibility', inGame ? 'screen dim' : 'screen dirt');
  const change = (): void => {
    saveSettings(s);
    host.settingsChanged(false);
  };
  const onOff = (v: boolean): string => (v ? 'ON' : 'OFF');
  body.append(
    el('div', { class: 'row' }, cycle((v: boolean) => `High Contrast: ${onOff(v)}`, [false, true], s.highContrast, (v) => ((s.highContrast = v), change())), cycle((v: boolean) => `Reduce Motion: ${onOff(v)}`, [false, true], s.reduceMotion, (v) => ((s.reduceMotion = v), change()))),
    el('div', { class: 'row' }, cycle((v: boolean) => `Subtitles: ${onOff(v)}`, [false, true], s.subtitles, (v) => ((s.subtitles = v), change())), slider((v) => `Chat Opacity: ${Math.round(v * 100)}%`, s.chatOpacity, 0.1, 1, 0.05, (v) => ((s.chatOpacity = v), change()))),
    el('div', { class: 'row' }, cycle((v: boolean) => `Toggle Sprint: ${onOff(v)}`, [false, true], s.toggleSprint, (v) => ((s.toggleSprint = v), change())), cycle((v: boolean) => `Toggle Sneak: ${onOff(v)}`, [false, true], s.toggleSneak, (v) => ((s.toggleSneak = v), change()))),
    el('div', { class: 'row' }, slider((v) => `Darkness Effect Pulsing: ${Math.round(v * 100)}%`, s.darknessPulse, 0, 1, 0.05, (v) => ((s.darknessPulse = v), change()))),
    el('div', { class: 'row' }, cycle((v: string) => `Glitch Effects: ${v === 'full' ? 'Full' : v === 'reduced' ? 'Reduced' : 'Off'}`, ['full', 'reduced', 'off'], s.glitchFx, (v) => ((s.glitchFx = v as 'full' | 'reduced' | 'off'), change()))),
    el('div', { class: 'spacer' }),
    button('Done', wrapClick(host, () => host.pop())),
  );
  return { root };
}

// ---------------------------------------------------------------------------
// In-game screens
// ---------------------------------------------------------------------------
export function pauseScreen(
  host: ScreenHost,
  actions: { resume: () => void; options: () => void; achievements: () => void; stats: () => void; quit: () => void; invite?: () => void; admin?: () => void; cheats?: { on: boolean; toggle: () => void } },
  local: boolean,
): Screen {
  const { root, body } = titled('Game Menu', 'screen dim center');
  body.append(
    button('Back to Game', wrapClick(host, actions.resume)),
    el('div', { class: 'row' }, button('Advancements', wrapClick(host, actions.achievements), 'btn half'), button('Statistics', wrapClick(host, actions.stats), 'btn half')),
    el('div', { class: 'row' }, button('Options...', wrapClick(host, actions.options), 'btn half'), actions.invite ? button('Invite Friends', wrapClick(host, actions.invite), 'btn half') : button('Invite Friends', () => {}, 'btn half', true)),
  );
  // Cheats: the owner can switch them on or off; owners and operators get the Admin Panel
  if (actions.admin || actions.cheats) {
    body.append(
      el(
        'div',
        { class: 'row' },
        actions.admin ? button('Admin Panel', wrapClick(host, actions.admin), actions.cheats ? 'btn half' : 'btn wide') : null,
        actions.cheats ? button(`Allow Cheats: ${actions.cheats.on ? 'ON' : 'OFF'}`, wrapClick(host, actions.cheats.toggle), actions.admin ? 'btn half' : 'btn wide') : null,
      ),
    );
  }
  body.append(button(local ? 'Save and Quit to Title' : 'Disconnect', wrapClick(host, actions.quit)));
  return { root };
}

export function deathScreen(host: ScreenHost, message: string, hardcore: boolean, score: number, actions: { respawn: () => void; title: () => void }): Screen {
  const root = el('div', { class: 'screen death center' });
  const respawn = button(hardcore ? 'Spectate World' : 'Respawn', wrapClick(host, actions.respawn));
  const title = button('Title Screen', wrapClick(host, actions.title));
  // Buttons become active after a short delay (prevents accidental clicks)
  respawn.disabled = true;
  title.disabled = true;
  setTimeout(() => {
    respawn.disabled = false;
    title.disabled = false;
  }, 1000);
  root.append(el('h1', {}, hardcore ? 'Game Over!' : 'You Died!'), el('div', {}, message), el('div', { class: 'spacer' }), el('div', {}, 'Score: ', el('span', { class: 'yellow' }, String(score))), el('div', { class: 'spacer' }), el('div', { class: 'stack' }, respawn, title));
  return { root, escapable: false };
}

export function achievementsScreen(host: ScreenHost, unlocked: Set<string> | null): Screen & { update: (u: Set<string>) => void } {
  const { root, body } = titled('Advancements', 'screen dim');
  const cats = ['story', 'world', 'engineering', 'digital', 'caves', 'nether', 'end', 'adventure', 'husbandry', 'farlands'] as const;
  const names: Record<(typeof cats)[number], string> = { story: 'MineHonk', world: 'World', engineering: 'Engineering', digital: 'Digital', caves: 'Caves', nether: 'Nether', end: 'The End', adventure: 'Adventure', husbandry: 'Husbandry', farlands: 'Farlands' };
  let cat: (typeof cats)[number] = 'story';
  const tabs = el('div', { class: 'row' });
  const list = el('div', { class: 'list adv-list' });
  const count = el('div', { class: 'muted' });
  const render = (): void => {
    clear(tabs);
    for (const c of cats) {
      const b = el('button', { class: 'btn chip' + (c === cat ? ' active' : '') }, names[c]) as HTMLButtonElement;
      b.onclick = (e) => {
        e.stopPropagation();
        host.uiClick();
        cat = c;
        render();
      };
      tabs.append(b);
    }
    clear(list);
    if (!unlocked) {
      list.append(el('div', { class: 'muted', style: { textAlign: 'center' } }, 'Loading...'));
      return;
    }
    const items = ACHIEVEMENTS.filter((a) => a.category === cat);
    for (const a of items) {
      const done = unlocked.has(a.id);
      const hidden = a.secret && !done;
      const num = itemById.get(a.icon)?.num ?? 0;
      const icon = el('div', { class: 'icon adv-icon' + (done ? ' done' : '') });
      if (num && !hidden) icon.style.backgroundImage = `url(${host.icons.icon(num)})`;
      list.append(el('div', { class: 'list-item' + (done ? ' adv-done' : ' adv-locked') }, icon, el('div', {}, el('div', { class: done ? 'yellow' : '' }, hidden ? '???' : a.title), el('div', { class: 'meta' }, hidden ? 'A secret yet to be discovered' : a.description))));
    }
    const total = ACHIEVEMENTS.length;
    const got = ACHIEVEMENTS.filter((a) => unlocked!.has(a.id)).length;
    count.textContent = `${got} / ${total} unlocked`;
  };
  render();
  body.append(tabs, list, count, button('Done', wrapClick(host, () => host.pop())));
  return {
    root,
    update(u: Set<string>) {
      unlocked = u;
      render();
    },
  };
}

export function statsScreen(host: ScreenHost, stats: Record<string, number> | null): Screen & { update: (s: Record<string, number>) => void } {
  const { root, body } = titled('Statistics', 'screen dim');
  const list = el('div', { class: 'list' });
  const render = (): void => {
    clear(list);
    if (!stats) {
      list.append(el('div', { class: 'muted' }, 'Loading...'));
      return;
    }
    const general: [string, string][] = [];
    const fmtTicks = (t: number): string => {
      const s = Math.floor(t / 20);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
    };
    const fmtCm = (cm: number): string => (cm >= 100000 ? `${(cm / 100000).toFixed(2)} km` : `${(cm / 100).toFixed(1)} m`);
    const nice = (k: string): string => k.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const keys = Object.keys(stats).sort();
    for (const k of keys) {
      const v = stats[k]!;
      if (k.startsWith('mined.') || k.startsWith('placed.') || k.startsWith('crafted.') || k.startsWith('killed.') || k.startsWith('used.')) continue;
      general.push([nice(k), k.includes('time') ? fmtTicks(v) : k.includes('cm') || k.includes('distance') ? fmtCm(v) : String(v)]);
    }
    const sum = (prefix: string): number => keys.filter((k) => k.startsWith(prefix)).reduce((a, k) => a + stats![k]!, 0);
    general.push(['Blocks Mined', String(sum('mined.'))], ['Blocks Placed', String(sum('placed.'))], ['Items Crafted', String(sum('crafted.'))], ['Mobs Killed', String(sum('killed.'))]);
    for (const [a, b] of general) list.append(el('div', { class: 'row', style: { justifyContent: 'space-between', padding: '0 calc(var(--s) * 4)' } }, el('span', {}, a), el('span', { class: 'muted' }, b)));
  };
  render();
  body.append(list, button('Done', wrapClick(host, () => host.pop())));
  return {
    root,
    update(s: Record<string, number>) {
      stats = s;
      render();
    },
  };
}

export function loadingScreen(): { root: HTMLElement; set: (text: string, detail?: string, progress?: number) => void } {
  const title = el('div', { class: 'title-text' });
  const detail = el('div', { class: 'muted' });
  const bar = el('div', { class: 'loading-bar' }, el('div', { style: { width: '0%' } }));
  const root = el('div', { class: 'screen dirt center loading' }, title, detail, el('div', { class: 'spacer' }), bar);
  return {
    root,
    set(text: string, d = '', progress?: number) {
      title.textContent = text;
      detail.textContent = d;
      bar.style.visibility = progress === undefined ? 'hidden' : 'visible';
      if (progress !== undefined) (bar.firstChild as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
    },
  };
}
