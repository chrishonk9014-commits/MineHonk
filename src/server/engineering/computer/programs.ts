/**
 * V5.5: the programs a computer runs.
 *
 * Each program builds what its screen shows (a few UI blocks, see
 * common/digital/view) from the live world, and handles the commands on its
 * buttons. They act through the engineering systems that already exist:
 * the control room's view of a network, machine settings, the disk store,
 * the signal system. Nothing here makes items: a blueprint builds only from
 * the builder's own inventory.
 */
import type { ServerPlayer } from '../../player/ServerPlayer';
import type { Dimension } from '../../world/Dimension';
import type { EngNode } from '../Engineering';
import type { EngBE } from '../state';
import type { UiBlock, UiRow, UiButton, Tone } from '../../../common/digital/view';
import type { Computers, Hw, PcData, DriveRef } from './Computers';
import { blocks, STATE_BLOCK, stateToString, stateFromString, STATE_SOLID } from '../../../common/registry/blocks';
import { items, itemById } from '../../../common/registry/items';
import { COMPONENT_BY_ID } from '../../../common/engineering/catalog';
import { STATUS_TEXT } from '../machines';
import { portAt } from '../ports';
import { mapColorOf } from '../../../common/digital/mapColor';
import {
  PROGRAMS,
  PROGRAM_BY_ID,
  OS_FILES,
  diskUsed,
  diskFree,
  sizeOf,
  textOf,
  programOf,
  RULE_TRIGGERS,
  RULE_ACTIONS,
  type DataFile,
  type ProgramDef,
  type MachineConfig,
  type FactoryConfig,
  type AutomationRule,
  type RuleTrigger,
  type RuleAction,
  type Blueprint,
  type MapData,
} from '../../../common/digital/data';

export interface Ctx {
  pcs: Computers;
  n: EngNode;
  be: EngBE;
  pc: PcData;
  hw: Hw;
  /** Who is looking (commands come from them; blueprints build from their inventory). */
  p: ServerPlayer | null;
}

export interface Screen {
  title: string;
  blocks: UiBlock[];
}

const fmt = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
const statusOf = (n: EngNode): string => (n.be()?.status ?? 'idle').split(':')[0]!;
const PROBLEM = new Set(['no_power', 'output_full', 'incomplete', 'no_tool', 'no_water', 'no_lava', 'no_fuel', 'no_recipe']);
const toneOf = (status: string): Tone => (status === 'working' ? 'ok' : PROBLEM.has(status) ? 'bad' : 'dim');

/** Why a program can't run on this hardware (or null). */
export function cannotRun(prog: ProgramDef, hw: Hw): string | null {
  if (hw.ram < prog.ram) return `needs ${prog.ram} RAM`;
  if (prog.needs.includes('gpu') && !hw.gpu) return 'needs a graphics card';
  if (prog.needs.includes('mouse') && !hw.mouse) return 'needs a mouse';
  if (prog.needs.includes('net') && !hw.net) return 'needs a network card';
  return null;
}

/** Programs found on the computer's drives (and the BIOS's own). */
export function installed(drives: DriveRef[], os: boolean): ProgramDef[] {
  const out = new Map<string, ProgramDef>();
  for (const p of PROGRAMS) if (p.bios) out.set(p.id, p);
  if (!os) return [...out.values()];
  for (const d of drives) for (const f of d.disk.files) {
    const prog = programOf(f);
    if (prog) out.set(prog.id, prog);
  }
  return PROGRAMS.filter((p) => out.has(p.id));
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export function screenOf(c: Ctx, app: string): Screen {
  switch (app) {
    case 'files':
      return files(c);
    case 'viewer':
      return viewer(c);
    case 'factory':
      return factory(c);
    case 'power':
      return power(c);
    case 'storage':
      return storage(c);
    case 'machines':
      return machines(c);
    case 'fluids':
      return fluids(c);
    case 'config':
      return config(c);
    case 'automation':
      return automation(c);
    case 'control':
      return control(c);
    case 'network':
      return network(c);
    case 'blueprint':
      return blueprint(c);
    case 'map':
      return map(c);
    case 'logs':
      return logs(c);
    case 'scanner':
      return scanner(c);
    case 'diagnostics':
      return diagnostics(c);
    case 'disk_utility':
      return diskUtility(c);
    default:
      return { title: '', blocks: [] };
  }
}

/** Handles a command for the open program. Returns a message to flash, if any. */
export function command(c: Ctx, cmd: string, arg: string | number | undefined): { text: string; tone?: Tone } | null {
  const a = arg === undefined ? '' : String(arg);
  switch (cmd) {
    // Files
    case 'sel':
      c.pc.sel = { ...(c.pc.sel ?? {}), file: a };
      return null;
    case 'open':
      return openFile(c, a || c.pc.sel?.file || '');
    case 'copy':
      return copyFile(c, c.pc.sel?.file ?? '', a);
    case 'del':
      return deleteFile(c, c.pc.sel?.file ?? '');
    case 'target':
      return cycleTarget(c);
    // Machines and control
    case 'toggle':
      return toggleMachine(c, a);
    case 'all_on':
    case 'all_off':
      setAll(c, cmd === 'all_on');
      return { text: cmd === 'all_on' ? 'Every machine switched on' : 'Every machine switched off', tone: 'ok' };
    case 'out':
      c.pcs.setOutput(c.n, !c.pc.out);
      return null;
    // Configuration
    case 'pick':
      c.pc.sel = { ...(c.pc.sel ?? {}), machine: a };
      return null;
    case 'save_cfg':
      return saveConfig(c);
    case 'load_cfg':
      return loadConfig(c, a, false);
    case 'load_cfg_all':
      return loadConfig(c, a, true);
    case 'save_factory':
      return saveFactory(c);
    case 'load_factory':
      return loadFactory(c, a);
    // Automation
    case 'rule_when':
      c.pc.draft = { ...(c.pc.draft ?? defaultRule()), when: nextOf(Object.keys(RULE_TRIGGERS), c.pc.draft?.when ?? 'signal_on') as RuleTrigger };
      return null;
    case 'rule_then':
      c.pc.draft = { ...(c.pc.draft ?? defaultRule()), then: nextOf(Object.keys(RULE_ACTIONS), c.pc.draft?.then ?? 'machines_on') as RuleAction };
      return null;
    case 'rule_add':
      if (c.pc.rules.length >= 6) return { text: 'Six rules at most', tone: 'warn' };
      c.pc.rules.push({ ...(c.pc.draft ?? defaultRule()) });
      c.pc.ruleState = c.pc.rules.map(() => false);
      return { text: 'Rule added', tone: 'ok' };
    case 'rule_del': {
      const i = Number(a);
      if (Number.isInteger(i) && i >= 0 && i < c.pc.rules.length) c.pc.rules.splice(i, 1);
      c.pc.ruleState = c.pc.rules.map(() => false);
      return null;
    }
    case 'save_rules':
      return saveFile(c, { name: 'rules.auto', kind: 'automation', size: sizeOf(c.pc.rules), data: { rules: c.pc.rules } });
    case 'load_rules': {
      const f = findFile(c, a);
      const rules = (f?.file.data as { rules?: AutomationRule[] } | undefined)?.rules;
      if (!f || f.file.kind !== 'automation' || !Array.isArray(rules)) return { text: 'Not an automation file', tone: 'bad' };
      c.pc.rules = rules.filter((r) => r && r.when in RULE_TRIGGERS && r.then in RULE_ACTIONS).slice(0, 6);
      c.pc.ruleState = c.pc.rules.map(() => false);
      return { text: `Loaded ${c.pc.rules.length} rule${c.pc.rules.length === 1 ? '' : 's'}`, tone: 'ok' };
    }
    // Network
    case 'remote':
      c.pc.sel = { ...(c.pc.sel ?? {}), remote: a, rfile: undefined };
      return null;
    case 'rsel':
      c.pc.sel = { ...(c.pc.sel ?? {}), rfile: a };
      return null;
    case 'send':
      return sendFile(c, a);
    case 'fetch':
      return fetchFile(c);
    // Blueprints
    case 'bp_r':
      c.pc.bpR = (c.pc.bpR ?? 3) >= 7 ? 2 : (c.pc.bpR ?? 3) + 1;
      return null;
    case 'capture':
      return capture(c);
    case 'build':
      return build(c, a);
    // Maps
    case 'save_map':
      return saveMap(c);
    // Disk Utility
    case 'install':
      return installOs(c, a);
    case 'wipe':
      return wipe(c, a);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Drives and files
// ---------------------------------------------------------------------------

function findFile(c: Ctx, ref: string): { drive: DriveRef; file: DataFile } | null {
  const i = ref.indexOf('/');
  if (i < 0) return null;
  const key = ref.slice(0, i);
  const name = ref.slice(i + 1);
  const drive = c.pcs.drives(c.n).find((d) => d.key === key);
  const file = drive?.disk.files.find((f) => f.name === name);
  return drive && file ? { drive, file } : null;
}

/** The drive new files are saved to (chosen with "Save to"). */
function targetDrive(c: Ctx): DriveRef | null {
  const drives = c.pcs.drives(c.n).filter((d) => d.disk.kind !== 'corrupted');
  return drives.find((d) => d.key === c.pc.target) ?? drives[0] ?? null;
}

function cycleTarget(c: Ctx): null {
  const drives = c.pcs.drives(c.n).filter((d) => d.disk.kind !== 'corrupted');
  if (!drives.length) return null;
  const i = drives.findIndex((d) => d.key === c.pc.target);
  c.pc.target = drives[(i + 1) % drives.length]!.key;
  return null;
}

function targetButton(c: Ctx): UiButton {
  const t = targetDrive(c);
  return { label: `Save to: ${t ? t.name : 'no drive'}`, cmd: 'target', disabled: !t };
}

function saveFile(c: Ctx, f: DataFile): { text: string; tone?: Tone } {
  const t = targetDrive(c);
  if (!t) return { text: 'No drive to save to', tone: 'bad' };
  const r = c.pcs.disks.write(t.disk, f);
  if (!r.ok) return { text: r.why ?? 'Could not save', tone: 'bad' };
  t.save();
  c.pcs.log(c.n, `saved ${f.name} to ${t.name}`);
  return { text: `Saved ${f.name} to ${t.name}`, tone: 'ok' };
}

function uniqueName(c: Ctx, base: string, ext: string): string {
  const t = targetDrive(c);
  const taken = new Set(t?.disk.files.map((f) => f.name) ?? []);
  let name = `${base}.${ext}`;
  for (let i = 2; taken.has(name) && i < 100; i++) name = `${base}-${i}.${ext}`;
  return name;
}

function openFile(c: Ctx, ref: string): { text: string; tone?: Tone } | null {
  const f = findFile(c, ref);
  if (!f) return { text: 'Pick a file first', tone: 'warn' };
  const prog = programOf(f.file);
  if (prog) {
    const why = cannotRun(prog, c.hw);
    if (why) return { text: `${prog.name} ${why}`, tone: 'bad' };
    c.pc.app = prog.id;
    return null;
  }
  if (f.file.kind === 'system') return { text: `${f.file.name}: a system file`, tone: 'dim' };
  c.pc.sel = { ...(c.pc.sel ?? {}), file: ref, view: ref };
  c.pc.app = 'viewer';
  return null;
}

function copyFile(c: Ctx, ref: string, toKey: string): { text: string; tone?: Tone } {
  const f = findFile(c, ref);
  const to = c.pcs.drives(c.n).find((d) => d.key === toKey);
  if (!f || !to) return { text: 'Pick a file and a drive', tone: 'warn' };
  const r = c.pcs.disks.copy(f.drive.disk, f.file.name, to.disk);
  if (!r.ok) return { text: r.why ?? 'Copy failed', tone: 'bad' };
  to.save();
  c.pcs.log(c.n, `copied ${f.file.name} to ${to.name}`);
  return { text: `Copied ${f.file.name} to ${to.name}`, tone: 'ok' };
}

function deleteFile(c: Ctx, ref: string): { text: string; tone?: Tone } {
  const f = findFile(c, ref);
  if (!f) return { text: 'Pick a file first', tone: 'warn' };
  const r = c.pcs.disks.remove(f.drive.disk, f.file.name);
  if (!r.ok) return { text: r.why ?? 'Could not delete', tone: 'bad' };
  f.drive.save();
  c.pc.sel = { ...(c.pc.sel ?? {}), file: undefined };
  return { text: `Deleted ${f.file.name}`, tone: 'ok' };
}

function fileRows(c: Ctx, d: DriveRef): UiRow[] {
  const selRef = c.pc.sel?.file;
  return d.disk.files.map((f) => {
    const ref = `${d.key}/${f.name}`;
    return { text: f.name, sub: `${f.corrupt ? 'unreadable' : f.kind} · ${f.size} KB`, tone: f.corrupt || f.kind === 'story' ? 'glitch' : f.kind === 'program' ? 'accent' : undefined, cmd: 'sel', arg: ref, sel: ref === selRef };
  });
}

function files(c: Ctx): Screen {
  const drives = c.pcs.drives(c.n);
  const out: UiBlock[] = [];
  if (!drives.length) out.push({ t: 'p', text: 'No drives. Install a hard drive, or put a flash drive into the USB slot.', tone: 'dim' });
  for (const d of drives) {
    out.push({ t: 'h', text: `${d.name}: ${d.disk.label}` });
    out.push({ t: 'bar', label: `${diskUsed(d.disk)} / ${d.disk.cap} KB`, value: diskUsed(d.disk), max: d.disk.cap, tone: d.disk.kind === 'corrupted' ? 'glitch' : undefined });
    out.push({ t: 'list', rows: fileRows(c, d), empty: 'Empty' });
  }
  const sel = c.pc.sel?.file ? findFile(c, c.pc.sel.file) : null;
  if (sel) {
    const btns: UiButton[] = [{ label: 'Open', cmd: 'open', arg: c.pc.sel!.file }];
    for (const d of drives) if (d.key !== sel.drive.key && d.disk.kind !== 'corrupted') btns.push({ label: `Copy to ${d.name}`, cmd: 'copy', arg: d.key });
    if (!sel.file.ro) btns.push({ label: 'Delete', cmd: 'del', tone: 'bad' });
    out.push({ t: 'h', text: sel.file.name }, { t: 'btns', items: btns });
  }
  return { title: 'File Manager', blocks: out };
}

/** Shows a file: text, a map, a blueprint's needs, a configuration. */
function viewer(c: Ctx): Screen {
  const f = c.pc.sel?.view ? findFile(c, c.pc.sel.view) : null;
  if (!f) return { title: 'Viewer', blocks: [{ t: 'p', text: 'Nothing open.', tone: 'dim' }] };
  const file = f.file;
  const out: UiBlock[] = [{ t: 'kv', k: 'File', v: `${file.name} (${file.kind}, ${file.size} KB) on ${f.drive.name}` }];
  if (file.corrupt) out.push({ t: 'text', lines: ['R#AD ERR0R', '?? ?? ?? ?? ?? ??', 'the data is damaged'], tone: 'glitch' });
  else if (file.kind === 'map') out.push(...mapBlocks(file.data as MapData));
  else if (file.kind === 'blueprint') out.push(...blueprintNeeds(c, file, `${f.drive.key}/${file.name}`));
  else if (file.kind === 'config') {
    const mc = file.data as MachineConfig;
    out.push({ t: 'kv', k: 'Machine', v: COMPONENT_BY_ID.get(mc?.machine)?.name ?? '?' }, { t: 'text', lines: Object.entries(mc?.cfg ?? {}).map(([k, v]) => `${k}: ${String(v)}`) });
  } else if (file.kind === 'factory') out.push({ t: 'kv', k: 'Machines', v: String((file.data as FactoryConfig)?.machines?.length ?? 0) });
  else if (file.kind === 'automation') out.push({ t: 'text', lines: ((file.data as { rules?: AutomationRule[] })?.rules ?? []).map((r) => `when ${RULE_TRIGGERS[r.when]}: ${RULE_ACTIONS[r.then]}`) });
  else out.push({ t: 'text', lines: textOf(file).length ? textOf(file) : ['(empty)'], tone: file.kind === 'story' ? 'glitch' : undefined });
  out.push({ t: 'btns', items: [{ label: 'Back to files', cmd: 'app', arg: 'files' }] });
  return { title: file.name, blocks: out };
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

function noNetwork(): Screen {
  return { title: '', blocks: [{ t: 'p', text: 'This computer is not on a power network with machines. Cable it to one.', tone: 'warn' }] };
}

function factory(c: Ctx): Screen {
  const sc = c.pcs.scope(c.n);
  if (!sc) return { ...noNetwork(), title: 'Factory Monitor' };
  const st = sc.net.stats;
  const working = sc.machines.filter((m) => statusOf(m) === 'working').length;
  const trouble = sc.machines.filter((m) => PROBLEM.has(statusOf(m))).length;
  const out: UiBlock[] = [
    { t: 'kv', k: 'Power', v: `+${st.gen.toFixed(1)} / -${st.use.toFixed(1)} EU/t`, tone: st.gen >= st.use ? 'ok' : st.stored > 0 ? 'warn' : 'bad' },
    { t: 'bar', label: st.capacity ? `Batteries ${fmt(st.stored)} / ${fmt(st.capacity)} EU` : 'No batteries', value: st.stored, max: Math.max(1, st.capacity) },
    { t: 'kv', k: 'Machines', v: `${sc.machines.length}: ${working} working, ${trouble} in trouble`, tone: trouble ? 'warn' : 'ok' },
    { t: 'kv', k: 'Generators', v: String(sc.generators.length) },
    { t: 'kv', k: 'Storage', v: `${sc.storage.length} inventor${sc.storage.length === 1 ? 'y' : 'ies'}` },
    { t: 'kv', k: 'Tanks', v: String(sc.tanks.length) },
    { t: 'h', text: 'Alerts' },
    { t: 'list', rows: c.pcs.eng.control.alerts(sc).map((a) => ({ text: a, tone: 'bad' as Tone })), empty: 'All systems normal' },
  ];
  return { title: 'Factory Monitor', blocks: out };
}

function power(c: Ctx): Screen {
  const sc = c.pcs.scope(c.n);
  if (!sc) return { ...noNetwork(), title: 'Power Monitor' };
  const st = sc.net.stats;
  return {
    title: 'Power Monitor',
    blocks: [
      { t: 'kv', k: 'Generating', v: `${st.gen.toFixed(1)} EU/t`, tone: 'ok' },
      { t: 'kv', k: 'Using', v: `${st.use.toFixed(1)} EU/t` },
      { t: 'kv', k: 'Cables carry', v: sc.net.cap === Infinity ? 'any amount' : `${sc.net.cap} EU/t`, tone: st.limited ? 'bad' : undefined },
      { t: 'bar', label: st.capacity ? `Stored ${fmt(st.stored)} / ${fmt(st.capacity)} EU` : 'No batteries', value: st.stored, max: Math.max(1, st.capacity), tone: st.capacity && st.stored / st.capacity < 0.2 ? 'bad' : 'ok' },
      { t: 'h', text: 'Generators' },
      { t: 'list', rows: sc.generators.map((g) => ({ text: g.c.name, sub: `${g.rate.toFixed(1)} EU/t at ${g.x}, ${g.y}, ${g.z}`, tone: toneOf(statusOf(g)) })), empty: 'None' },
      { t: 'h', text: 'Batteries' },
      { t: 'list', rows: sc.batteries.map((b) => ({ text: b.c.name, sub: `${fmt(b.be()?.energy ?? 0)} / ${fmt(b.c.energy!.capacity)} EU` })), empty: 'None' },
    ],
  };
}

function storage(c: Ctx): Screen {
  const sc = c.pcs.scope(c.n);
  if (!sc) return { ...noNetwork(), title: 'Storage Manager' };
  const total = new Map<number, number>();
  let fill = 0;
  let n = 0;
  for (const [x, y, z] of sc.storage) {
    const p = portAt(c.pcs.eng.server, sc.net.dim, x, y, z, 1);
    if (!p) continue;
    fill += p.fill();
    n++;
    for (const [id, cnt] of p.contents()) total.set(id, (total.get(id) ?? 0) + cnt);
  }
  const rows = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id, cnt]) => ({ text: items[id]?.def.name ?? '?', sub: cnt.toLocaleString('en-US') }));
  return {
    title: 'Storage Manager',
    blocks: [{ t: 'kv', k: 'Inventories', v: String(n) }, { t: 'bar', label: `${n ? Math.round((fill / n) * 100) : 0}% full`, value: fill, max: Math.max(1, n) }, { t: 'list', rows, empty: 'Nothing stored next to this network' }],
  };
}

function machineList(c: Ctx): EngNode[] {
  const sc = c.pcs.scope(c.n);
  return sc ? [...sc.generators, ...sc.machines] : [];
}

function machines(c: Ctx): Screen {
  const list = machineList(c);
  if (!list.length) return { ...noNetwork(), title: 'Machine Manager' };
  const rows: UiRow[] = list.slice(0, 48).map((m) => {
    const on = m.be()?.cfg?.enabled !== false;
    const st = statusOf(m);
    return { text: m.c.name, sub: `${STATUS_TEXT[st] ?? st} · ${m.x}, ${m.y}, ${m.z}`, tone: toneOf(st), btns: [{ label: on ? 'On' : 'Off', cmd: 'toggle', arg: `${m.x},${m.y},${m.z}`, on }] };
  });
  return { title: 'Machine Manager', blocks: [{ t: 'btns', items: [{ label: 'All on', cmd: 'all_on', tone: 'ok' }, { label: 'All off', cmd: 'all_off', tone: 'bad' }] }, { t: 'list', rows }] };
}

function toggleMachine(c: Ctx, at: string): null {
  const m = machineList(c).find((d) => `${d.x},${d.y},${d.z}` === at);
  const be = m?.be();
  if (!m || !be) return null;
  (be.cfg ??= {}).enabled = be.cfg.enabled === false;
  m.sleep = 0;
  m.dim.setBlockEntity(m.x, m.y, m.z, be);
  c.pcs.log(c.n, `${m.c.name} at ${at} switched ${be.cfg.enabled ? 'on' : 'off'}`);
  return null;
}

export function setAll(c: { pcs: Computers; n: EngNode }, on: boolean): void {
  const sc = c.pcs.scope(c.n);
  if (!sc) return;
  for (const m of [...sc.generators, ...sc.machines]) {
    const be = m.be();
    if (!be) continue;
    (be.cfg ??= {}).enabled = on;
    m.sleep = 0;
    m.dim.setBlockEntity(m.x, m.y, m.z, be);
  }
}

function fluids(c: Ctx): Screen {
  const sc = c.pcs.scope(c.n);
  if (!sc) return { ...noNetwork(), title: 'Fluid Monitor' };
  const blocks: UiBlock[] = [];
  for (const t of sc.tanks) {
    const f = t.be()?.fluid;
    blocks.push({ t: 'bar', label: `${t.c.name} at ${t.x}, ${t.y}, ${t.z}: ${f?.id ?? 'empty'} ${((f?.amount ?? 0) / 1000).toFixed(1)} B`, value: f?.amount ?? 0, max: t.c.fluid!.capacity, tone: f?.id === 'lava' ? 'warn' : 'accent' });
  }
  for (const m of sc.machines) {
    const f = m.be()?.fluid;
    if (!m.c.fluid || !f) continue;
    blocks.push({ t: 'bar', label: `${m.c.name}: ${f.id ?? 'empty'} ${((f.amount ?? 0) / 1000).toFixed(1)} B`, value: f.amount ?? 0, max: m.c.fluid.capacity });
  }
  if (!blocks.length) blocks.push({ t: 'p', text: 'No tanks or fluid machines on this network.', tone: 'dim' });
  return { title: 'Fluid Monitor', blocks };
}

// ---------------------------------------------------------------------------
// Machine configuration
// ---------------------------------------------------------------------------

function configOf(m: EngNode): MachineConfig {
  const be = m.be();
  return { machine: m.c.id, cfg: JSON.parse(JSON.stringify(be?.cfg ?? {})) as Record<string, unknown>, ...(be?.ghost ? { ghost: be.ghost.map((g) => (g ? g.id : null)) } : {}) };
}

function applyConfig(m: EngNode, mc: MachineConfig): boolean {
  const be = m.be();
  if (!be || mc.machine !== m.c.id) return false;
  be.cfg = JSON.parse(JSON.stringify(mc.cfg ?? {})) as EngBE['cfg'];
  if (mc.ghost && be.ghost) be.ghost = be.ghost.map((_, i) => (mc.ghost![i] && itemById.has(mc.ghost![i]!) ? { id: mc.ghost![i]!, count: 1 } : null));
  m.sleep = 0;
  m.dim.setBlockEntity(m.x, m.y, m.z, be);
  return true;
}

function config(c: Ctx): Screen {
  const list = machineList(c);
  const sel = list.find((m) => `${m.x},${m.y},${m.z}` === c.pc.sel?.machine);
  const out: UiBlock[] = [{ t: 'btns', items: [targetButton(c), { label: 'Save factory', cmd: 'save_factory', disabled: !list.length }] }];
  out.push({ t: 'h', text: 'Machines' }, { t: 'list', rows: list.slice(0, 32).map((m) => ({ text: m.c.name, sub: `${m.x}, ${m.y}, ${m.z}`, cmd: 'pick', arg: `${m.x},${m.y},${m.z}`, sel: m === sel })), empty: 'No machines on this network' });
  if (sel) out.push({ t: 'btns', items: [{ label: `Save ${sel.c.name} settings`, cmd: 'save_cfg' }] });
  const cfgFiles: UiRow[] = [];
  for (const d of c.pcs.drives(c.n))
    for (const f of d.disk.files) {
      const ref = `${d.key}/${f.name}`;
      if (f.kind === 'config') {
        const mc = f.data as MachineConfig;
        const btns: UiButton[] = [];
        if (sel && mc?.machine === sel.c.id) btns.push({ label: 'Load', cmd: 'load_cfg', arg: ref });
        btns.push({ label: 'Load on all', cmd: 'load_cfg_all', arg: ref });
        cfgFiles.push({ text: f.name, sub: `${COMPONENT_BY_ID.get(mc?.machine)?.name ?? '?'} on ${d.name}`, btns });
      } else if (f.kind === 'factory') cfgFiles.push({ text: f.name, sub: `factory, ${(f.data as FactoryConfig)?.machines?.length ?? 0} machines on ${d.name}`, btns: [{ label: 'Load factory', cmd: 'load_factory', arg: ref }] });
    }
  out.push({ t: 'h', text: 'Configuration files' }, { t: 'list', rows: cfgFiles, empty: 'None yet' });
  return { title: 'Machine Configuration', blocks: out };
}

function saveConfig(c: Ctx): { text: string; tone?: Tone } {
  const m = machineList(c).find((d) => `${d.x},${d.y},${d.z}` === c.pc.sel?.machine);
  if (!m) return { text: 'Pick a machine first', tone: 'warn' };
  const mc = configOf(m);
  return saveFile(c, { name: uniqueName(c, m.c.id, 'cfg'), kind: 'config', size: sizeOf(mc), data: mc });
}

function loadConfig(c: Ctx, ref: string, all: boolean): { text: string; tone?: Tone } {
  const f = findFile(c, ref);
  const mc = f?.file.data as MachineConfig | undefined;
  if (!f || f.file.kind !== 'config' || !mc) return { text: 'Not a configuration file', tone: 'bad' };
  const targets = all ? machineList(c).filter((m) => m.c.id === mc.machine) : machineList(c).filter((m) => `${m.x},${m.y},${m.z}` === c.pc.sel?.machine);
  let k = 0;
  for (const m of targets) if (applyConfig(m, mc)) k++;
  c.pcs.log(c.n, `loaded ${f.file.name} onto ${k} machine${k === 1 ? '' : 's'}`);
  return k ? { text: `Settings loaded onto ${k} machine${k === 1 ? '' : 's'}`, tone: 'ok' } : { text: 'No machine of that kind to load it onto', tone: 'warn' };
}

function saveFactory(c: Ctx): { text: string; tone?: Tone } {
  const list = machineList(c);
  if (!list.length) return { text: 'No machines on this network', tone: 'warn' };
  const fc: FactoryConfig = { machines: list.map((m) => ({ at: [m.x - c.n.x, m.y - c.n.y, m.z - c.n.z], config: configOf(m) })) };
  return saveFile(c, { name: uniqueName(c, 'factory', 'fac'), kind: 'factory', size: sizeOf(fc), data: fc });
}

function loadFactory(c: Ctx, ref: string): { text: string; tone?: Tone } {
  const f = findFile(c, ref);
  const fc = f?.file.data as FactoryConfig | undefined;
  if (!f || f.file.kind !== 'factory' || !Array.isArray(fc?.machines)) return { text: 'Not a factory file', tone: 'bad' };
  let k = 0;
  for (const e of fc!.machines) {
    const m = c.pcs.eng.node(c.n.dim, c.n.x + e.at[0], c.n.y + e.at[1], c.n.z + e.at[2]);
    if (m && applyConfig(m, e.config)) k++;
  }
  c.pcs.log(c.n, `factory ${f.file.name}: ${k} of ${fc!.machines.length} machines set`);
  return { text: `${k} of ${fc!.machines.length} machines set`, tone: k ? 'ok' : 'warn' };
}

// ---------------------------------------------------------------------------
// Automation and control
// ---------------------------------------------------------------------------

function defaultRule(): AutomationRule {
  return { when: 'signal_on', then: 'machines_on' };
}

function nextOf<T extends string>(all: T[], cur: T): T {
  return all[(all.indexOf(cur) + 1) % all.length]!;
}

function automation(c: Ctx): Screen {
  const d = c.pc.draft ?? defaultRule();
  const rows: UiRow[] = c.pc.rules.map((r, i) => ({ text: `When ${RULE_TRIGGERS[r.when]}`, sub: RULE_ACTIONS[r.then], tone: c.pc.ruleState?.[i] ? 'ok' : undefined, btns: [{ label: 'Remove', cmd: 'rule_del', arg: i, tone: 'bad' }] }));
  const files: UiRow[] = [];
  for (const dr of c.pcs.drives(c.n)) for (const f of dr.disk.files) if (f.kind === 'automation') files.push({ text: f.name, sub: dr.name, btns: [{ label: 'Load', cmd: 'load_rules', arg: `${dr.key}/${f.name}` }] });
  return {
    title: 'Automation Manager',
    blocks: [
      { t: 'p', text: 'The computer checks its rules every second while it runs.', tone: 'dim' },
      { t: 'list', rows, empty: 'No rules yet' },
      { t: 'h', text: 'New rule' },
      { t: 'btns', items: [{ label: `When: ${RULE_TRIGGERS[d.when]}`, cmd: 'rule_when' }, { label: `Then: ${RULE_ACTIONS[d.then]}`, cmd: 'rule_then' }, { label: 'Add rule', cmd: 'rule_add', tone: 'ok' }] },
      { t: 'btns', items: [targetButton(c), { label: 'Save rules', cmd: 'save_rules', disabled: !c.pc.rules.length }] },
      { t: 'list', rows: files, empty: 'No automation files on the drives' },
    ],
  };
}

/** Evaluates a computer's rules (every second while it runs): actions fire as a condition becomes true. */
export function runRules(c: { pcs: Computers; n: EngNode; pc: PcData }): void {
  const pc = c.pc;
  if (!pc.rules.length) return;
  pc.ruleState ??= pc.rules.map(() => false);
  const sc = c.pcs.scope(c.n);
  const st = sc?.net.stats;
  const signal = !!c.pcs.eng.server.power?.powered(c.n.dim, c.n.x, c.n.y, c.n.z);
  pc.rules.forEach((r, i) => {
    let now = false;
    switch (r.when) {
      case 'signal_on':
        now = signal;
        break;
      case 'signal_off':
        now = !signal;
        break;
      case 'battery_low':
        now = !!st && st.capacity > 0 && st.stored / st.capacity < 0.2;
        break;
      case 'battery_full':
        now = !!st && st.capacity > 0 && st.stored / st.capacity > 0.9;
        break;
      case 'alert':
        now = !!sc && c.pcs.eng.control.alerts(sc).length > 0;
        break;
    }
    const was = pc.ruleState![i] ?? false;
    pc.ruleState![i] = now;
    if (!now || was) return;
    switch (r.then) {
      case 'machines_on':
      case 'machines_off':
        setAll(c, r.then === 'machines_on');
        break;
      case 'output_on':
      case 'output_off':
        c.pcs.setOutput(c.n, r.then === 'output_on');
        break;
      case 'alarm':
        c.pcs.sound(c.n, 'computer.alarm', 1);
        break;
    }
    c.pcs.log(c.n, `rule: when ${RULE_TRIGGERS[r.when]}, ${RULE_ACTIONS[r.then]}`);
  });
}

function control(c: Ctx): Screen {
  const signal = !!c.pcs.eng.server.power?.powered(c.n.dim, c.n.x, c.n.y, c.n.z);
  return {
    title: 'Engineering Control',
    blocks: [
      { t: 'kv', k: 'Signal in', v: signal ? 'ON (a lever, button or sensor is powering the computer)' : 'off', tone: signal ? 'ok' : 'dim' },
      { t: 'btns', items: [{ label: `Signal out: ${c.pc.out ? 'ON' : 'off'}`, cmd: 'out', on: c.pc.out }] },
      { t: 'p', text: 'The signal goes out into cables, lamps, doors and machines touching the computer.', tone: 'dim' },
      { t: 'h', text: 'Machines on this network' },
      { t: 'btns', items: [{ label: 'All on', cmd: 'all_on', tone: 'ok' }, { label: 'All off', cmd: 'all_off', tone: 'bad' }] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function network(c: Ctx): Screen {
  if (!c.hw.net) return { title: 'Network Manager', blocks: [{ t: 'p', text: 'No network card installed.', tone: 'bad' }] };
  const remotes = c.pcs.network(c.n);
  const out: UiBlock[] = [];
  if (!remotes.length) out.push({ t: 'p', text: 'Nothing else on the network. Join computers (with network cards) and server racks with network cable.', tone: 'dim' });
  out.push({ t: 'list', rows: remotes.map((r) => ({ text: r.name, sub: `${r.drives.length} drive${r.drives.length === 1 ? '' : 's'} · ${r.at.join(', ')}`, cmd: 'remote', arg: r.at.join(','), sel: r.at.join(',') === c.pc.sel?.remote })) });
  const r = remotes.find((x) => x.at.join(',') === c.pc.sel?.remote);
  if (r) {
    for (const d of r.drives) {
      out.push({ t: 'h', text: `${r.name} ${d.name}: ${d.disk.label} (${diskFree(d.disk)} KB free)` });
      out.push({ t: 'list', rows: d.disk.files.map((f) => ({ text: f.name, sub: `${f.kind} · ${f.size} KB`, cmd: 'rsel', arg: `${d.key}/${f.name}`, sel: c.pc.sel?.rfile === `${d.key}/${f.name}` })), empty: 'Empty' });
    }
    const btns: UiButton[] = [];
    const local = c.pc.sel?.file ? findFile(c, c.pc.sel.file) : null;
    if (local) for (const d of r.drives) btns.push({ label: `Send ${local.file.name} to ${d.name}`, cmd: 'send', arg: d.key });
    if (c.pc.sel?.rfile) btns.push({ label: 'Copy here', cmd: 'fetch' }, targetButton(c));
    if (!local) out.push({ t: 'p', text: 'Pick a file in the File Manager to send it.', tone: 'dim' });
    if (btns.length) out.push({ t: 'btns', items: btns });
  }
  return { title: 'Network Manager', blocks: out };
}

function sendFile(c: Ctx, remoteDrive: string): { text: string; tone?: Tone } {
  const local = c.pc.sel?.file ? findFile(c, c.pc.sel.file) : null;
  const r = c.pcs.network(c.n).find((x) => x.at.join(',') === c.pc.sel?.remote);
  const to = r?.drives.find((d) => d.key === remoteDrive);
  if (!local || !r || !to) return { text: 'Pick a file and a drive on the network', tone: 'warn' };
  const res = c.pcs.disks.copy(local.drive.disk, local.file.name, to.disk);
  if (!res.ok) return { text: res.why ?? 'Transfer failed', tone: 'bad' };
  to.save();
  c.pcs.log(c.n, `sent ${local.file.name} to ${r.name} ${to.name}`);
  c.pcs.grantNet(c);
  return { text: `Sent ${local.file.name} to ${r.name}`, tone: 'ok' };
}

function fetchFile(c: Ctx): { text: string; tone?: Tone } {
  const r = c.pcs.network(c.n).find((x) => x.at.join(',') === c.pc.sel?.remote);
  const ref = c.pc.sel?.rfile ?? '';
  const i = ref.indexOf('/');
  const from = r?.drives.find((d) => d.key === ref.slice(0, i));
  const t = targetDrive(c);
  if (!r || !from || !t) return { text: 'Pick a file on the network and a drive here', tone: 'warn' };
  const res = c.pcs.disks.copy(from.disk, ref.slice(i + 1), t.disk);
  if (!res.ok) return { text: res.why ?? 'Transfer failed', tone: 'bad' };
  t.save();
  c.pcs.log(c.n, `copied ${ref.slice(i + 1)} from ${r.name}`);
  c.pcs.grantNet(c);
  return { text: `Copied ${ref.slice(i + 1)} to ${t.name}`, tone: 'ok' };
}

// ---------------------------------------------------------------------------
// Blueprints
// ---------------------------------------------------------------------------

let BLOCK_ITEM: Map<string, number> | null = null;
/** The item that places a block (for blueprints). */
function itemForBlock(blockId: string): number | undefined {
  if (!BLOCK_ITEM) {
    BLOCK_ITEM = new Map();
    for (const it of items) {
      if (it.def.block && !BLOCK_ITEM.has(it.def.block)) BLOCK_ITEM.set(it.def.block, it.num);
      if (it.def.wallBlock && !BLOCK_ITEM.has(it.def.wallBlock)) BLOCK_ITEM.set(it.def.wallBlock, it.num);
    }
  }
  return BLOCK_ITEM.get(blockId) ?? itemById.get(blockId)?.num;
}

function blueprint(c: Ctx): Screen {
  const r = c.pc.bpR ?? 3;
  const out: UiBlock[] = [
    { t: 'p', text: `Captures every block within ${r} of the computer. Building puts back what is missing, using blocks from your inventory.`, tone: 'dim' },
    { t: 'btns', items: [{ label: `Radius: ${r}`, cmd: 'bp_r' }, targetButton(c), { label: 'Capture', cmd: 'capture', tone: 'ok' }] },
  ];
  const rows: UiRow[] = [];
  for (const d of c.pcs.drives(c.n))
    for (const f of d.disk.files)
      if (f.kind === 'blueprint') {
        const ref = `${d.key}/${f.name}`;
        rows.push({ text: f.name, sub: `${(f.data as Blueprint)?.blocks?.length ?? 0} blocks on ${d.name}`, cmd: 'sel', arg: ref, sel: c.pc.sel?.file === ref, btns: [{ label: 'Build', cmd: 'build', arg: ref, tone: 'ok' }] });
      }
  out.push({ t: 'h', text: 'Blueprints' }, { t: 'list', rows, empty: 'No blueprints yet' });
  const sel = c.pc.sel?.file ? findFile(c, c.pc.sel.file) : null;
  if (sel?.file.kind === 'blueprint') out.push({ t: 'h', text: `${sel.file.name}: what it takes` }, ...blueprintNeeds(c, sel.file, c.pc.sel!.file!));
  return { title: 'Blueprint Manager', blocks: out };
}

function capture(c: Ctx): { text: string; tone?: Tone } {
  const r = Math.max(2, Math.min(7, c.pc.bpR ?? 3));
  const dim = c.n.dim;
  const palette: string[] = [];
  const index = new Map<string, number>();
  const list: Blueprint['blocks'] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (!dx && !dy && !dz) continue;
        const x = c.n.x + dx;
        const y = c.n.y + dy;
        const z = c.n.z + dz;
        if (y < 0 || y > 255 || !dim.isLoaded(x, z)) continue;
        const s = dim.getState(x, y, z);
        if (s === 0) continue;
        const def = blocks[STATE_BLOCK[s]!]!.def;
        if (def.hardness < 0 || def.model === 'liquid') continue;
        const str = stateToString(s);
        let i = index.get(str);
        if (i === undefined) {
          i = palette.length;
          palette.push(str);
          index.set(str, i);
        }
        list.push([dx, dy, dz, i]);
      }
  if (!list.length) return { text: 'Nothing to capture around the computer', tone: 'warn' };
  const bp: Blueprint = { size: [r * 2 + 1, r * 2 + 1, r * 2 + 1], palette, blocks: list };
  return saveFile(c, { name: uniqueName(c, 'blueprint', 'bp'), kind: 'blueprint', size: sizeOf(bp), data: bp });
}

/** What building a blueprint needs, against what the viewer carries. */
function blueprintNeeds(c: Ctx, file: DataFile, ref: string): UiBlock[] {
  const bp = file.data as Blueprint;
  if (!bp || !Array.isArray(bp.blocks)) return [{ t: 'p', text: 'Not a readable blueprint', tone: 'bad' }];
  const need = new Map<number, number>();
  let unbuildable = 0;
  let missing = 0;
  for (const [dx, dy, dz, i] of bp.blocks) {
    const st = safeState(bp.palette[i]);
    const id = st ? blocks[STATE_BLOCK[st]!]!.id : null;
    const item = id ? itemForBlock(id) : undefined;
    if (!item) {
      unbuildable++;
      continue;
    }
    // Already standing: nothing needed
    if (c.n.dim.getState(c.n.x + dx, c.n.y + dy, c.n.z + dz) === st) continue;
    missing++;
    need.set(item, (need.get(item) ?? 0) + 1);
  }
  const have = (num: number): number => (c.p ? c.p.inventory.slots.reduce((a, s) => a + (s && s.id === num && !s.tag?.data ? s.count : 0), 0) : 0);
  const rows: UiRow[] = [...need.entries()].sort((a, b) => b[1] - a[1]).map(([num, cnt]) => {
    const h = have(num);
    return { text: items[num]!.def.name, sub: `${cnt} needed, you carry ${h}`, tone: h >= cnt ? 'ok' : 'bad' };
  });
  const out: UiBlock[] = [{ t: 'kv', k: 'Blocks missing here', v: String(missing) }];
  if (unbuildable) out.push({ t: 'p', text: `${unbuildable} block${unbuildable === 1 ? '' : 's'} can't be built from items (fluids, portals...)`, tone: 'dim' });
  out.push({ t: 'list', rows, empty: 'Everything is already in place' });
  void ref;
  return out;
}

function safeState(s: string | undefined): number {
  if (!s) return 0;
  try {
    return stateFromString(s);
  } catch {
    return 0;
  }
}

function build(c: Ctx, ref: string): { text: string; tone?: Tone } {
  const f = findFile(c, ref);
  const bp = f?.file.data as Blueprint | undefined;
  const p = c.p;
  if (!f || f.file.kind !== 'blueprint' || !bp || !p) return { text: 'Not a blueprint', tone: 'bad' };
  if (c.pcs.eng.server.roleOf(p) === 'visitor') return { text: 'Visitors can\'t build', tone: 'bad' };
  const dim = c.n.dim;
  const creative = p.gamemode === 'creative';
  const cheat = c.pcs.eng.server.admin.inContext(p);
  let placed = 0;
  let short = 0;
  for (const [dx, dy, dz, i] of bp.blocks) {
    if (placed >= 512) break;
    const x = c.n.x + dx;
    const y = c.n.y + dy;
    const z = c.n.z + dz;
    if (y < 1 || y > 255 || !dim.isLoaded(x, z)) continue;
    const st = safeState(bp.palette[i]);
    if (!st) continue;
    const here = dim.getState(x, y, z);
    if (here === st || (here !== 0 && STATE_SOLID[here])) continue;
    if (here !== 0 && blocks[STATE_BLOCK[here]!]!.def.model !== 'liquid' && !blocks[STATE_BLOCK[here]!]!.def.replaceable) continue;
    const id = blocks[STATE_BLOCK[st]!]!.id;
    const num = itemForBlock(id);
    if (num === undefined) continue;
    if (!creative) {
      // Plain stacks only (never a drive or anything carrying data)
      const slot = p.inventory.slots.findIndex((s) => s && s.id === num && !s.tag?.data);
      if (slot < 0) {
        short++;
        continue;
      }
      const s = p.inventory.get(slot)!;
      p.inventory.set(slot, s.count > 1 ? { ...s, count: s.count - 1 } : null);
    }
    dim.setBlock(x, y, z, st);
    c.pcs.eng.server.admin.setBlockMark(dim, x, y, z, cheat || creative);
    if (COMPONENT_BY_ID.has(id)) c.pcs.eng.onPlaced(p, dim, x, y, z, { id: num, count: 1 });
    placed++;
  }
  c.pcs.eng.server.interaction.syncInventory(p);
  c.pcs.log(c.n, `built ${placed} block${placed === 1 ? '' : 's'} from ${f.file.name}`);
  if (!placed && !short) return { text: 'Everything is already in place', tone: 'ok' };
  return { text: `Placed ${placed} block${placed === 1 ? '' : 's'}${short ? `; ${short} missing from your inventory` : ''}`, tone: short ? 'warn' : 'ok' };
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

const MAP_R = 24;

/** A top-down map of the loaded land around (x, z). */
export function renderMap(dim: Dimension, cx: number, cz: number, r = MAP_R): MapData {
  const w = r * 2;
  const colors: number[] = new Array(w * w).fill(0x101014);
  for (let dz = 0; dz < w; dz++)
    for (let dx = 0; dx < w; dx++) {
      const x = cx - r + dx;
      const z = cz - r + dz;
      if (!dim.isLoaded(x, z)) continue;
      let y = Math.min(255, dim.getHeight(x, z));
      let s = 0;
      while (y > 0) {
        s = dim.getState(x, y, z);
        if (s !== 0) break;
        y--;
      }
      const base = mapColorOf(s);
      // Shade by height for relief
      const k = 0.75 + Math.max(-0.25, Math.min(0.35, (y - 64) / 120));
      const r8 = Math.min(255, ((base >> 16) & 255) * k);
      const g8 = Math.min(255, ((base >> 8) & 255) * k);
      const b8 = Math.min(255, (base & 255) * k);
      colors[dz * w + dx] = (Math.round(r8) << 16) | (Math.round(g8) << 8) | Math.round(b8);
    }
  return { w, h: w, x: cx, z: cz, dim: dim.id, colors };
}

function mapBlocks(m: MapData): UiBlock[] {
  if (!m || !Array.isArray(m.colors)) return [{ t: 'p', text: 'Not a readable map', tone: 'bad' }];
  return [{ t: 'map', w: m.w, h: m.h, colors: m.colors, marker: [m.w / 2, m.h / 2] }, { t: 'kv', k: 'Centre', v: `${m.x}, ${m.z} (${m.dim})` }];
}

function map(c: Ctx): Screen {
  const now = c.pcs.eng.server.tickNo;
  // Re-drawn at most every two seconds
  const cached = c.pcs.mapCache.get(c.n.key);
  const m = cached && now - cached.at < 40 ? cached.map : renderMap(c.n.dim, c.n.x, c.n.z);
  if (!cached || cached.map !== m) c.pcs.mapCache.set(c.n.key, { at: now, map: m });
  return { title: 'Map Viewer', blocks: [...mapBlocks(m), { t: 'btns', items: [targetButton(c), { label: 'Save map', cmd: 'save_map', tone: 'ok' }] }] };
}

function saveMap(c: Ctx): { text: string; tone?: Tone } {
  const m = renderMap(c.n.dim, c.n.x, c.n.z);
  return saveFile(c, { name: uniqueName(c, `map_${c.n.x}_${c.n.z}`, 'map'), kind: 'map', size: sizeOf(m) >> 2, data: m });
}

// ---------------------------------------------------------------------------
// Logs, scanner, BIOS programs
// ---------------------------------------------------------------------------

function logs(c: Ctx): Screen {
  const rows: UiRow[] = [];
  for (const d of c.pcs.drives(c.n)) for (const f of d.disk.files) if (f.kind === 'log' || f.kind === 'lore' || f.kind === 'story' || f.kind === 'quest') rows.push({ text: f.name, sub: d.name, tone: f.kind === 'story' || f.corrupt ? 'glitch' : undefined, btns: [{ label: 'Read', cmd: 'open', arg: `${d.key}/${f.name}` }] });
  return {
    title: 'Digital Logs',
    blocks: [{ t: 'h', text: 'System log' }, { t: 'text', lines: c.pc.log.length ? c.pc.log.slice(-14) : ['(nothing yet)'] }, { t: 'h', text: 'Logs and notes on the drives' }, { t: 'list', rows, empty: 'None' }],
  };
}

function scanner(c: Ctx): Screen {
  const out: UiBlock[] = [];
  const sc = c.pcs.scope(c.n);
  out.push({ t: 'h', text: 'Network' });
  if (sc) out.push({ t: 'list', rows: c.pcs.eng.control.alerts(sc).map((a) => ({ text: a, tone: 'bad' as Tone })), empty: 'No problems found' });
  else out.push({ t: 'p', text: 'Not on a power network.', tone: 'dim' });
  out.push({ t: 'h', text: 'Drives' });
  for (const d of c.pcs.drives(c.n)) {
    const odd = d.disk.files.filter((f) => f.kind === 'story' || f.corrupt);
    if (!odd.length) out.push({ t: 'kv', k: d.name, v: `${d.disk.files.length} files, clean`, tone: 'ok' });
    else {
      out.push({ t: 'kv', k: d.name, v: `${odd.length} file${odd.length === 1 ? '' : 's'} the scanner can't identify`, tone: 'glitch' });
      for (const f of odd) out.push({ t: 'p', text: f.kind === 'story' ? `UNKNOWN EXECUTABLE ${f.name}. ORIGIN: UNKNOWN. THREAT: ████████` : `${f.name}: corrupted`, tone: 'glitch' });
    }
  }
  return { title: 'System Scanner', blocks: out };
}

function diagnostics(c: Ctx): Screen {
  const hw = c.hw;
  const ok = (b: boolean): Tone => (b ? 'ok' : 'bad');
  return {
    title: 'Diagnostics',
    blocks: [
      { t: 'kv', k: 'Power supply', v: hw.psu ? 'OK' : 'missing', tone: ok(hw.psu) },
      { t: 'kv', k: 'Motherboard', v: hw.mobo ? 'OK' : 'missing', tone: ok(hw.mobo) },
      { t: 'kv', k: 'CPU', v: hw.cpu ? 'OK' : 'missing', tone: ok(hw.cpu) },
      { t: 'kv', k: 'RAM', v: `${hw.ram} module${hw.ram === 1 ? '' : 's'}`, tone: ok(hw.ram > 0) },
      { t: 'kv', k: 'Hard drives', v: String(hw.hdds.filter(Boolean).length), tone: hw.hdds.some(Boolean) ? 'ok' : 'warn' },
      { t: 'kv', k: 'Graphics', v: hw.gpu ? 'OK' : 'none', tone: hw.gpu ? 'ok' : 'dim' },
      { t: 'kv', k: 'Network card', v: hw.net ? 'OK' : 'none', tone: hw.net ? 'ok' : 'dim' },
      { t: 'kv', k: 'USB', v: hw.usb ? (items[hw.usb.id]?.def.name ?? 'device') : 'empty' },
      { t: 'h', text: 'Around it' },
      { t: 'kv', k: 'Monitor', v: hw.monitors.length ? `${hw.monitors.length}` : 'none', tone: ok(hw.monitors.length > 0) },
      { t: 'kv', k: 'Keyboard', v: hw.keyboard ? 'OK' : 'none', tone: ok(hw.keyboard) },
      { t: 'kv', k: 'Mouse', v: hw.mouse ? 'OK' : 'none', tone: hw.mouse ? 'ok' : 'dim' },
      { t: 'kv', k: 'Speaker', v: hw.speaker ? 'OK' : 'none', tone: hw.speaker ? 'ok' : 'dim' },
      { t: 'kv', k: 'Power draw', v: `${c.pcs.useOf(hw).toFixed(1)} EU/t` },
    ],
  };
}

function diskUtility(c: Ctx): Screen {
  const out: UiBlock[] = [];
  const drives = c.pcs.drives(c.n);
  if (!drives.length) out.push({ t: 'p', text: 'No drives found.', tone: 'bad' });
  for (const d of drives) {
    const os = d.disk.files.some((f) => f.name === 'honkos.sys');
    out.push({ t: 'h', text: `${d.name}: ${d.disk.label}` }, { t: 'bar', label: `${diskUsed(d.disk)} / ${d.disk.cap} KB${os ? ' · HonkOS installed' : ''}`, value: diskUsed(d.disk), max: d.disk.cap, tone: d.disk.kind === 'corrupted' ? 'glitch' : undefined });
    const btns: UiButton[] = [];
    if (d.disk.kind === 'hdd' && !os) btns.push({ label: 'Install HonkOS', cmd: 'install', arg: d.key, tone: 'ok' });
    if (d.disk.kind !== 'corrupted') btns.push({ label: 'Wipe', cmd: 'wipe', arg: d.key, tone: 'bad' });
    if (btns.length) out.push({ t: 'btns', items: btns });
  }
  return { title: 'Disk Utility', blocks: out };
}

function installOs(c: Ctx, key: string): { text: string; tone?: Tone } {
  const d = c.pcs.drives(c.n).find((x) => x.key === key);
  if (!d || d.disk.kind !== 'hdd') return { text: 'HonkOS installs onto a hard drive', tone: 'bad' };
  const need = OS_FILES.reduce((a, f) => a + f.size, 0);
  if (diskFree(d.disk) < need) return { text: `HonkOS needs ${need} KB free`, tone: 'bad' };
  for (const f of OS_FILES) c.pcs.disks.write(d.disk, f);
  d.disk.label = 'HonkOS';
  d.save();
  c.pcs.log(c.n, `HonkOS installed on ${d.name}`);
  c.pcs.eng.grant(c.n, 'install_os');
  if (c.p) c.pcs.eng.server.interaction.grant(c.p, 'install_os');
  c.pc.app = '';
  c.pcs.sound(c.n, 'computer.boot', 0.8);
  return { text: 'HonkOS installed', tone: 'ok' };
}

function wipe(c: Ctx, key: string): { text: string; tone?: Tone } {
  const d = c.pcs.drives(c.n).find((x) => x.key === key);
  if (!d) return { text: 'No such drive', tone: 'bad' };
  const r = c.pcs.disks.wipe(d.disk);
  if (!r.ok) return { text: r.why ?? 'Could not wipe', tone: 'bad' };
  d.disk.label = d.disk.kind === 'hdd' ? 'Hard Drive' : 'Flash Drive';
  d.save();
  c.pcs.log(c.n, `${d.name} wiped`);
  return { text: `${d.name} wiped`, tone: 'ok' };
}

export { PROGRAM_BY_ID };
