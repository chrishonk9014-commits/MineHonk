/** Persistent client settings (localStorage). */
export interface KeyBinds {
  forward: string;
  back: string;
  left: string;
  right: string;
  jump: string;
  sneak: string;
  sprint: string;
  inventory: string;
  drop: string;
  chat: string;
  command: string;
  swapHands: string;
  playerList: string;
  debug: string;
  perspective: string;
  pause: string;
  hideHud: string;
  fullscreen: string;
  screenshot: string;
  achievements: string;
}

export interface Settings {
  renderDistance: number;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  masterVolume: number;
  musicVolume: number;
  soundVolume: number;
  ambientVolume: number;
  brightness: number;
  guiScale: number;
  fancyLeaves: boolean;
  smoothLighting: boolean;
  clouds: boolean;
  viewBobbing: boolean;
  particles: 'all' | 'decreased' | 'minimal';
  showFps: boolean;
  resolutionScale: number;
  maxFps: number;
  highContrast: boolean;
  reduceMotion: boolean;
  subtitles: boolean;
  chatOpacity: number;
  autoJump: boolean;
  toggleSprint: boolean;
  toggleSneak: boolean;
  keys: KeyBinds;
}

export const DEFAULT_KEYS: KeyBinds = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sneak: 'ShiftLeft',
  sprint: 'ControlLeft',
  inventory: 'KeyE',
  drop: 'KeyQ',
  chat: 'KeyT',
  command: 'Slash',
  swapHands: 'KeyF',
  playerList: 'Tab',
  debug: 'F3',
  perspective: 'F5',
  pause: 'Escape',
  hideHud: 'F1',
  fullscreen: 'F11',
  screenshot: 'F2',
  achievements: 'KeyL',
};

export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 10,
  fov: 70,
  sensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  musicVolume: 0.5,
  soundVolume: 1,
  ambientVolume: 0.7,
  brightness: 0.5,
  guiScale: 0,
  fancyLeaves: true,
  smoothLighting: true,
  clouds: true,
  viewBobbing: true,
  particles: 'all',
  showFps: false,
  resolutionScale: 1,
  maxFps: 0,
  highContrast: false,
  reduceMotion: false,
  subtitles: false,
  chatOpacity: 1,
  autoJump: false,
  toggleSprint: false,
  toggleSneak: false,
  keys: { ...DEFAULT_KEYS },
};

const KEY = 'minehonk.settings';

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...raw, keys: { ...DEFAULT_KEYS, ...(raw.keys ?? {}) } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** Local offline profile (single player identity). */
export interface Profile {
  uuid: string;
  name: string;
}

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem('minehonk.profile') ?? 'null') as Profile | null;
    if (p && typeof p.uuid === 'string' && typeof p.name === 'string') return p;
  } catch {
    /* ignore */
  }
  const p: Profile = { uuid: crypto.randomUUID(), name: 'Player' + Math.floor(Math.random() * 900 + 100) };
  saveProfile(p);
  return p;
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem('minehonk.profile', JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
