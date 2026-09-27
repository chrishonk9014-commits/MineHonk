/** Atlas metadata shared between main thread and mesher workers. */
export interface AtlasEntry {
  i: number;
  n?: number;
  t?: number;
}
export interface AtlasMeta {
  tile: number;
  columns: number;
  width: number;
  height: number;
  textures: Record<string, AtlasEntry>;
}

export class AtlasLookup {
  readonly cols: number;
  readonly rows: number;
  constructor(readonly meta: AtlasMeta) {
    this.cols = meta.width / meta.tile;
    this.rows = meta.height / meta.tile;
  }
  entry(name: string): AtlasEntry {
    return this.meta.textures[name] ?? this.meta.textures['missing_block'] ?? { i: 0 };
  }
  has(name: string): boolean {
    return name in this.meta.textures;
  }
  /** UV (0..1 over the atlas) for a tile-local uv. */
  uv(tile: number, u: number, v: number): [number, number] {
    const col = tile % this.cols;
    const row = Math.floor(tile / this.cols);
    return [(col + u) / this.cols, (row + v) / this.rows];
  }
}
