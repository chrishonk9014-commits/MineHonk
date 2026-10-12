/**
 * V5.5: what a computer's screen shows, as the server sends it in its
 * window's props. The server runs every program and builds the screen from
 * these few blocks; the client only draws them and sends back the commands
 * on their buttons (`pc_cmd`), so programs are authoritative and the client
 * stays one generic renderer.
 */

export type Tone = 'dim' | 'ok' | 'warn' | 'bad' | 'glitch' | 'accent';

export interface UiButton {
  label: string;
  cmd: string;
  arg?: string | number;
  /** Toggle state (on/off buttons). */
  on?: boolean;
  tone?: Tone;
  disabled?: boolean;
}

export interface UiRow {
  text: string;
  sub?: string;
  tone?: Tone;
  /** Clicking the row sends this. */
  cmd?: string;
  arg?: string | number;
  sel?: boolean;
  btns?: UiButton[];
}

export type UiBlock =
  | { t: 'h'; text: string }
  | { t: 'p'; text: string; tone?: Tone }
  | { t: 'kv'; k: string; v: string; tone?: Tone }
  | { t: 'bar'; label: string; value: number; max: number; tone?: Tone }
  | { t: 'btns'; items: UiButton[] }
  | { t: 'list'; rows: UiRow[]; empty?: string }
  | { t: 'map'; w: number; h: number; colors: number[]; marker?: [number, number] }
  | { t: 'text'; lines: string[]; tone?: Tone };

export type PcState = 'off' | 'no_power' | 'missing' | 'post' | 'bios' | 'desktop' | 'takeover' | 'gateway';

export interface PcApp {
  id: string;
  name: string;
  ok: boolean;
  /** Why it won't run (more RAM, a graphics card...). */
  why?: string;
}

export interface PcView {
  name: string;
  state: PcState;
  power: boolean;
  energy: number;
  energyMax: number;
  /** EU/t while running. */
  use: number;
  /** The hardware checklist. */
  hw: { label: string; ok: boolean; detail?: string }[];
  periph: { keyboard: boolean; mouse: boolean; speaker: boolean; monitors: number; leds: number };
  /** A message across the middle of the screen (no keyboard, no OS...). */
  message?: string;
  apps: PcApp[];
  app: string;
  title: string;
  blocks: UiBlock[];
  /** 0..1: how corrupted the screen looks. */
  glitch?: number;
  /** Slot labels in order (the hardware tab). */
  slots: string[];
  /** An old terminal (the computer world): just its screen, no case to open. */
  terminal?: boolean;
}

/** The computer's slots, in window order. */
export const PC_SLOTS = ['power_supply', 'motherboard', 'cpu', 'ram', 'ram', 'ram', 'ram', 'hdd', 'hdd', 'gpu', 'network', 'usb'] as const;
export type PcSlot = (typeof PC_SLOTS)[number];
export const PC_SLOT_LABEL: Record<PcSlot, string> = {
  power_supply: 'Power Supply',
  motherboard: 'Motherboard',
  cpu: 'CPU',
  ram: 'RAM',
  hdd: 'Hard Drive',
  gpu: 'Graphics',
  network: 'Network Card',
  usb: 'USB (Flash Drive)',
};
/** Which item fits each slot kind. */
export const PC_SLOT_ITEMS: Record<PcSlot, string[]> = {
  power_supply: ['power_supply'],
  motherboard: ['motherboard'],
  cpu: ['cpu'],
  ram: ['ram_module'],
  hdd: ['hard_drive'],
  gpu: ['gpu'],
  network: ['network_card'],
  usb: ['flash_drive', 'corrupted_flash_drive'],
};
