/**
 * V5.5: the disks behind drive items.
 *
 * A drive item carries only its disk's id (and, for tooltips, its label and
 * how full it is) in its tag; the files are kept with the world in
 * `level.digital`. So a flash drive's files travel with the item (into
 * another computer, a chest, another player's hands) and survive saves,
 * while inventories and the network only ever carry a few bytes per drive.
 */
import type { GameServer } from '../../GameServer';
import type { ItemStack } from '../../../common/game/itemstack';
import { items } from '../../../common/registry/items';
import { DRIVE_CAPACITY, DRIVE_LABEL, diskUsed, driveKindOf, type DataFile, type Disk, type DriveKind } from '../../../common/digital/data';

export interface DriveTag {
  disk?: string;
  label?: string;
  used?: number;
  cap?: number;
  /** Corrupted drives: the dragon kills counter when it was made (it speaks once the dragon has died since). */
  born?: number;
  /** Corrupted drives: who held it in the malware. */
  owner?: string;
  /** Corrupted drives: the clean (cheat-free) dragon kills counter when it was made. */
  bornLegit?: number;
  /** Corrupted drives: made with cheats somewhere along the way (nothing it starts counts). */
  cheat?: boolean;
  /** Corrupted drives: HER0BRINE.EXE has already run from it (it is just a broken drive now). */
  spent?: boolean;
}

export class DiskStore {
  constructor(private readonly server: GameServer) {}

  private get store() {
    return this.server.level.digital;
  }

  /** A new, empty disk. */
  create(kind: DriveKind, label = DRIVE_LABEL[kind]): Disk {
    const st = this.store;
    const id = 'd' + (st.next++).toString(36);
    const d: Disk = { id, kind, label, cap: DRIVE_CAPACITY[kind], files: [] };
    st.disks[id] = d;
    return d;
  }

  get(id: string | undefined): Disk | null {
    return id ? (this.store.disks[id] ?? null) : null;
  }

  /** The disk behind a drive stack, made the first time it is used (the stack's tag changes then). */
  diskOf(stack: ItemStack | null | undefined): Disk | null {
    if (!stack) return null;
    const kind = driveKindOf(items[stack.id]?.id);
    if (!kind) return null;
    const tag = this.tag(stack);
    let d = this.get(tag.disk);
    if (!d) {
      d = this.create(kind);
      this.syncTag(stack, d);
    }
    return d;
  }

  tag(stack: ItemStack): DriveTag {
    return ((stack.tag?.data as DriveTag | undefined) ?? {}) as DriveTag;
  }

  /** Writes the disk's id, label and usage into the drive's tag. */
  syncTag(stack: ItemStack, d: Disk): void {
    const prev = this.tag(stack);
    stack.tag = { ...(stack.tag ?? {}), data: { ...prev, disk: d.id, label: d.label, used: diskUsed(d), cap: d.cap } };
  }

  /** Puts a file on a disk (replacing one with the same name unless that one is read-only). */
  write(d: Disk, f: DataFile): { ok: boolean; why?: string } {
    const old = d.files.find((x) => x.name === f.name);
    if (old?.ro) return { ok: false, why: `${f.name} is read-only` };
    const used = diskUsed(d) - (old?.size ?? 0);
    if (used + f.size > d.cap) return { ok: false, why: `Not enough space on ${d.label} (${d.cap - used} KB free, ${f.size} KB needed)` };
    if (d.files.length >= 256 && !old) return { ok: false, why: 'Too many files on the drive' };
    if (old) d.files[d.files.indexOf(old)] = clone(f);
    else d.files.push(clone(f));
    return { ok: true };
  }

  remove(d: Disk, name: string): { ok: boolean; why?: string } {
    const f = d.files.find((x) => x.name === name);
    if (!f) return { ok: false, why: 'No such file' };
    if (f.ro) return { ok: false, why: `${name} can't be deleted` };
    d.files.splice(d.files.indexOf(f), 1);
    return { ok: true };
  }

  /** Copies a file from one disk to another (data, never things). */
  copy(from: Disk, name: string, to: Disk): { ok: boolean; why?: string } {
    if (from === to) return { ok: false, why: 'Same drive' };
    const f = from.files.find((x) => x.name === name);
    if (!f) return { ok: false, why: 'No such file' };
    if (f.kind === 'system') return { ok: false, why: 'System files stay where they are' };
    // Story files don't copy: they come out as noise
    if (f.kind === 'story' || f.corrupt) return { ok: false, why: `${name}: read error (the data is damaged)` };
    return this.write(to, { ...clone(f), ro: false });
  }

  /** Empties a drive (everything, the OS too). */
  wipe(d: Disk): { ok: boolean; why?: string } {
    if (d.kind === 'corrupted') return { ok: false, why: 'The drive does not respond' };
    d.files = [];
    return { ok: true };
  }
}

function clone(f: DataFile): DataFile {
  return JSON.parse(JSON.stringify(f)) as DataFile;
}
