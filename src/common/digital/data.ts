/**
 * V5.5 - the Digital Corruption Update: digital data.
 *
 * One framework for everything a computer stores: programs, machine and
 * factory configurations, automation rules, blueprints, maps, logs, lore and
 * story data. A drive (hard drive, flash drive, the corrupted flash drive or
 * a server rack's drives) is a Disk: a label, a capacity and a list of files.
 * The server keeps disks with the world, keyed by an id the drive item
 * carries, so a flash drive's files go wherever the item goes.
 *
 * Data is never a way to make things: a blueprint lists blocks, and building
 * it still takes every one of those blocks from the builder's inventory.
 */

export type FileKind = 'system' | 'program' | 'config' | 'factory' | 'automation' | 'blueprint' | 'map' | 'log' | 'lore' | 'quest' | 'story';

export interface DataFile {
  name: string;
  kind: FileKind;
  /** Size in KB. */
  size: number;
  /** Kind-specific payload (a program id, a configuration, a blueprint...). */
  data?: unknown;
  /** System and story files can't be deleted or overwritten. */
  ro?: boolean;
  /** Mangled by the malware: unreadable. */
  corrupt?: boolean;
}

export type DriveKind = 'hdd' | 'flash' | 'corrupted';

export interface Disk {
  id: string;
  kind: DriveKind;
  label: string;
  /** Capacity in KB. */
  cap: number;
  files: DataFile[];
}

export const DRIVE_ITEMS: Record<string, DriveKind> = { hard_drive: 'hdd', flash_drive: 'flash', corrupted_flash_drive: 'corrupted' };
export const DRIVE_CAPACITY: Record<DriveKind, number> = { hdd: 8192, flash: 1024, corrupted: 666 };
export const DRIVE_LABEL: Record<DriveKind, string> = { hdd: 'Hard Drive', flash: 'Flash Drive', corrupted: '???' };

export function driveKindOf(itemId: string | undefined): DriveKind | null {
  return itemId ? (DRIVE_ITEMS[itemId] ?? null) : null;
}

export function diskUsed(d: Disk): number {
  return d.files.reduce((a, f) => a + f.size, 0);
}

export function diskFree(d: Disk): number {
  return Math.max(0, d.cap - diskUsed(d));
}

/** Rough size of a payload in KB (at least 1). */
export function sizeOf(data: unknown): number {
  if (data === undefined) return 1;
  return Math.max(1, Math.ceil(JSON.stringify(data).length / 256));
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export type Need = 'gpu' | 'mouse' | 'net' | 'hdd';

export interface ProgramDef {
  id: string;
  name: string;
  /** File name on a drive. */
  file: string;
  /** KB. */
  size: number;
  /** RAM modules needed to run it. */
  ram: number;
  needs: Need[];
  desc: string;
  /** Built into the BIOS: runs with no drive at all. */
  bios?: boolean;
}

export const PROGRAMS: ProgramDef[] = [
  { id: 'files', name: 'File Manager', file: 'files.exe', size: 96, ram: 1, needs: [], desc: 'Browse your drives, copy and delete files, and move them between the hard drive, a flash drive and the network.' },
  { id: 'factory', name: 'Factory Monitor', file: 'factory.exe', size: 180, ram: 1, needs: [], desc: 'The whole network at a glance: power, machines at work, storage and alerts.' },
  { id: 'power', name: 'Power Monitor', file: 'power.exe', size: 120, ram: 1, needs: [], desc: 'Generation, use, cable load and battery charge, generator by generator.' },
  { id: 'storage', name: 'Storage Manager', file: 'storage.exe', size: 240, ram: 2, needs: [], desc: 'Everything stored next to the network, totalled and sorted.' },
  { id: 'machines', name: 'Machine Manager', file: 'machines.exe', size: 260, ram: 2, needs: [], desc: 'Every machine on the network with its state; switch any of them on or off.' },
  { id: 'fluids', name: 'Fluid Monitor', file: 'fluids.exe', size: 120, ram: 1, needs: [], desc: 'Tanks and fluid machines and how full they are.' },
  { id: 'config', name: 'Machine Configuration', file: 'config.exe', size: 200, ram: 1, needs: [], desc: 'Save a machine\'s settings, or a whole factory\'s, to a file; load them back onto machines of the same kind.' },
  { id: 'automation', name: 'Automation Manager', file: 'automate.exe', size: 320, ram: 2, needs: [], desc: 'Rules the computer follows by itself: when a signal comes in or the batteries run low, switch machines or its signal output.' },
  { id: 'control', name: 'Engineering Control', file: 'control.exe', size: 140, ram: 1, needs: [], desc: 'The computer\'s signal output and inputs (levers, buttons, sensors), and every machine on or off at once.' },
  { id: 'network', name: 'Network Manager', file: 'netman.exe', size: 300, ram: 2, needs: ['net'], desc: 'Computers and server racks on the network; send files between them.' },
  { id: 'blueprint', name: 'Blueprint Manager', file: 'blueprint.exe', size: 900, ram: 3, needs: ['gpu', 'mouse'], desc: 'Capture the blocks around the computer as a blueprint, see what it takes, and build it again from your own inventory.' },
  { id: 'map', name: 'Map Viewer', file: 'map.exe', size: 600, ram: 2, needs: ['gpu', 'mouse'], desc: 'A map of the land around the computer, saved as a file you can carry.' },
  { id: 'logs', name: 'Digital Logs', file: 'logs.exe', size: 80, ram: 1, needs: [], desc: 'The computer\'s own log, and any log or note on its drives.' },
  { id: 'scanner', name: 'System Scanner', file: 'scan.exe', size: 160, ram: 1, needs: [], desc: 'Checks the network for trouble and the drives for anything that shouldn\'t be there.' },
  { id: 'diagnostics', name: 'Diagnostics', file: 'diag.exe', size: 0, ram: 1, needs: [], desc: 'The hardware: what is installed, what is missing, power draw.', bios: true },
  { id: 'disk_utility', name: 'Disk Utility', file: 'diskutil.exe', size: 0, ram: 1, needs: [], desc: 'Install HonkOS onto a hard drive, or wipe a drive.', bios: true },
];
export const PROGRAM_BY_ID = new Map(PROGRAMS.map((p) => [p.id, p]));

/** What HonkOS puts on a hard drive. */
export const OS_FILES: DataFile[] = [
  { name: 'honkos.sys', kind: 'system', size: 1024, ro: true, data: { os: 'HonkOS', version: '5.5' } },
  ...PROGRAMS.filter((p) => !p.bios).map((p): DataFile => ({ name: p.file, kind: 'program', size: p.size, data: { program: p.id } })),
];

export function programOf(f: DataFile): ProgramDef | undefined {
  if (f.kind !== 'program' || f.corrupt) return undefined;
  const id = (f.data as { program?: unknown } | undefined)?.program;
  return typeof id === 'string' ? PROGRAM_BY_ID.get(id) : undefined;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** A machine's settings (Machine Configuration). */
export interface MachineConfig {
  machine: string;
  cfg: Record<string, unknown>;
  /** Filter/target slots (item ids). */
  ghost?: (string | null)[];
}

/** Every machine's settings on a network, by position relative to the computer. */
export interface FactoryConfig {
  machines: { at: [number, number, number]; config: MachineConfig }[];
}

export type RuleTrigger = 'signal_on' | 'signal_off' | 'battery_low' | 'battery_full' | 'alert';
export type RuleAction = 'machines_on' | 'machines_off' | 'output_on' | 'output_off' | 'alarm';
export interface AutomationRule {
  when: RuleTrigger;
  then: RuleAction;
}
export const RULE_TRIGGERS: Record<RuleTrigger, string> = {
  signal_on: 'a signal comes in',
  signal_off: 'the signal stops',
  battery_low: 'batteries under 20%',
  battery_full: 'batteries over 90%',
  alert: 'a machine has trouble',
};
export const RULE_ACTIONS: Record<RuleAction, string> = {
  machines_on: 'switch every machine on',
  machines_off: 'switch every machine off',
  output_on: 'turn my signal output on',
  output_off: 'turn my signal output off',
  alarm: 'sound the alarm',
};

/** Blocks around the computer: positions relative to it and block state names. */
export interface Blueprint {
  size: [number, number, number];
  /** Palette of block state strings ("crusher[facing=south]"). */
  palette: string[];
  /** [dx, dy, dz, palette index]. */
  blocks: [number, number, number, number][];
}

/** A top-down map: w*h colours (0xRRGGBB) and where it was made. */
export interface MapData {
  w: number;
  h: number;
  x: number;
  z: number;
  dim: string;
  colors: number[];
}

/** Lore, logs and story notes. */
export interface TextData {
  lines: string[];
}

export function textOf(f: DataFile): string[] {
  const d = f.data as Partial<TextData> | undefined;
  return Array.isArray(d?.lines) ? d!.lines!.map(String) : [];
}

/** Garbles a name the way the malware does. */
export function corruptName(name: string, seed: number): string {
  const glyphs = '#%&@?!$*0O1lI';
  let out = '';
  let h = seed >>> 0;
  for (const ch of name) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x9e3779b1) >>> 0;
    out += h % 3 === 0 ? glyphs[h % glyphs.length]! : ch;
  }
  return out;
}
