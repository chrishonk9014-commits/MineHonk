/// <reference lib="webworker" />
/** Mesher worker entry: receives padded section data, returns vertex buffers and visibility. */
import { Mesher, type MeshInput } from './mesher';
import type { AtlasMeta } from './atlasInfo';

let mesher: Mesher | null = null;

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data as { type: 'init'; atlas: AtlasMeta } | ({ type: 'mesh'; id: number } & MeshInput);
  if (m.type === 'init') {
    mesher = new Mesher(m.atlas);
    (self as unknown as Worker).postMessage({ type: 'ready' });
    return;
  }
  if (!mesher) return;
  const t0 = performance.now();
  const out = mesher.mesh(m);
  const transfer: ArrayBuffer[] = [];
  for (const l of out.layers) transfer.push(l.u16.buffer as ArrayBuffer, l.u8.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage({ type: 'mesh', id: m.id, layers: out.layers, vis: out.vis, ms: performance.now() - t0 }, transfer);
};
