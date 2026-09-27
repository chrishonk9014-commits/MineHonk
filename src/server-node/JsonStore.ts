/** A small JSON document persisted atomically with debounced writes. */
import { readJson, writeJson } from './fsutil';

export class JsonStore<T> {
  data: T;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    readonly file: string,
    initial: T,
    private readonly delayMs: number,
  ) {
    this.data = initial;
  }

  static async open<T>(file: string, fallback: () => T, sanitize: (raw: unknown) => T | null, log: (m: string) => void, delayMs = 250): Promise<JsonStore<T>> {
    const raw = await readJson(file, log);
    const data = raw === null ? fallback() : (sanitize(raw) ?? fallback());
    return new JsonStore(file, data, delayMs);
  }

  /** Schedules a save. */
  changed(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, this.delayMs);
  }

  save(): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(this.data)) as T;
    this.writing = this.writing.then(() => writeJson(this.file, snapshot)).catch(() => {});
    return this.writing;
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      await this.save();
    }
    await this.writing;
  }
}
