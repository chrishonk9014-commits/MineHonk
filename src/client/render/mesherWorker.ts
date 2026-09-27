/// <reference lib="webworker" />
/** Mesher worker entry: receives padded section data, returns vertex buffers. */
import { Mesher, type MeshInput } from './mesher';
import type { AtlasMeta } from './atlasInfo';

let mesher: Mesher | null = null;

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data as { type: 'init'; atlas: AtlasMeta } | ({ type: 'mesh'; id: number; key: string } & MeshInput);
  if (m.type === 'init') {
    mesher = new Mesher(m.atlas);
    (self as unknown as Worker).postMessage({ type: 'ready' });
    return;
  }
  if (!mesher) return;
  const t0 = performance.now();
  const layers = mesher.mesh(m);
  const transfer: ArrayBuffer[] = [];
  for (const l of layers) transfer.push(l.pos.buffer as ArrayBuffer, l.uv.buffer as ArrayBuffer, l.col.buffer as ArrayBuffer, l.light.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage({ type: 'mesh', id: m.id, key: m.key, layers, ms: performance.now() - t0 }, transfer);
};
