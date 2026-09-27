/** Durable file helpers: atomic replace (write, fsync, rename) and safe reads. */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Writes `data` to `file` atomically; readers see either the old or the new file. */
export async function writeAtomic(file: string, data: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  const h = await fs.open(tmp, 'w');
  try {
    await h.writeFile(data);
    await h.datasync();
  } finally {
    await h.close();
  }
  await fs.rename(tmp, file);
}

export async function readIfExists(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** Reads JSON, falling back to `file.bak` when the main copy is damaged. */
export async function readJson(file: string, log: (m: string) => void = () => {}): Promise<unknown | null> {
  for (const f of [file, `${file}.bak`]) {
    const buf = await readIfExists(f);
    if (!buf) continue;
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      log(`[storage] ${path.basename(f)} is damaged${f === file ? ', trying the backup' : ''}`);
    }
  }
  return null;
}

/** Writes JSON atomically, keeping the previous version as `file.bak`. */
export async function writeJson(file: string, data: unknown, backup = true): Promise<void> {
  if (backup) {
    try {
      await fs.copyFile(file, `${file}.bak`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  await writeAtomic(file, JSON.stringify(data));
}
