/**
 * Structural validation of client messages. Anything that does not match the
 * expected shape exactly is rejected before reaching game logic.
 */
import type { C2S, ClickMode } from './protocol';
import { LIMITS } from './protocol';
import { sanitizeStack } from '../game/itemstack';
import { validateAdmin } from '../game/admin';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const COORD = 3.1e7;
const inRange = (v: unknown, lo: number, hi: number): v is number => isNum(v) && v >= lo && v <= hi;
const CLICK_MODES: ClickMode[] = ['pickup', 'quick', 'swap', 'drop', 'drag_start', 'drag_add', 'drag_end', 'collect', 'clone'];

export function validateC2S(raw: unknown): C2S | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      if (!isInt(m.version) || !isStr(m.name, 64) || !isInt(m.viewDistance) || !isStr(m.registryHash, 128)) return null;
      if (m.token !== undefined && !isStr(m.token, 512)) return null;
      return { t: 'hello', version: m.version, name: m.name, token: m.token as string | undefined, viewDistance: m.viewDistance, registryHash: m.registryHash };
    case 'move':
      if (!inRange(m.x, -COORD, COORD) || !inRange(m.y, -512, 1024) || !inRange(m.z, -COORD, COORD)) return null;
      if (!isNum(m.yaw) || !inRange(m.pitch, -Math.PI, Math.PI) || !isBool(m.onGround) || !isBool(m.flying) || !isBool(m.sneak) || !isBool(m.sprint) || !isInt(m.seq)) return null;
      return { t: 'move', x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, onGround: m.onGround, flying: m.flying, sneak: m.sneak, sprint: m.sprint, seq: m.seq, glide: m.glide === true };
    case 'dig':
      if (m.action !== 'start' && m.action !== 'abort' && m.action !== 'finish') return null;
      if (!isInt(m.x) || !isInt(m.y) || !isInt(m.z) || !inRange(m.face, 0, 5) || !isInt(m.face)) return null;
      return { t: 'dig', action: m.action, x: m.x, y: m.y, z: m.z, face: m.face };
    case 'use_on':
      if (!isInt(m.x) || !isInt(m.y) || !isInt(m.z) || !isInt(m.face) || !inRange(m.face, 0, 5)) return null;
      if (!inRange(m.hx, 0, 1) || !inRange(m.hy, 0, 1) || !inRange(m.hz, 0, 1) || (m.hand !== 0 && m.hand !== 1) || !isNum(m.yaw) || !isNum(m.pitch) || !isInt(m.seq)) return null;
      return { t: 'use_on', x: m.x, y: m.y, z: m.z, face: m.face, hx: m.hx, hy: m.hy, hz: m.hz, hand: m.hand, yaw: m.yaw, pitch: m.pitch, seq: m.seq };
    case 'use':
      if ((m.hand !== 0 && m.hand !== 1) || (m.action !== 'start' && m.action !== 'release')) return null;
      return { t: 'use', hand: m.hand, action: m.action };
    case 'hotbar':
      if (!isInt(m.slot) || m.slot < 0 || m.slot > 8) return null;
      return { t: 'hotbar', slot: m.slot };
    case 'click':
      if (!isInt(m.window) || !isInt(m.slot) || !isInt(m.button) || !isInt(m.seq)) return null;
      if (!CLICK_MODES.includes(m.mode as ClickMode)) return null;
      if (m.slot < -999 || m.slot > 200 || m.button < 0 || m.button > 40) return null;
      return { t: 'click', window: m.window, slot: m.slot, button: m.button, mode: m.mode as ClickMode, seq: m.seq };
    case 'close_window':
      if (!isInt(m.window)) return null;
      return { t: 'close_window', window: m.window };
    case 'creative_set':
      if (!isInt(m.slot) || m.slot < -1 || m.slot > 45) return null;
      return { t: 'creative_set', slot: m.slot, item: sanitizeStack(m.item) };
    case 'creative_pick':
      return { t: 'creative_pick', item: sanitizeStack(m.item) };
    case 'chat':
      if (!isStr(m.text, LIMITS.chatLength) || m.text.trim().length === 0) return null;
      return { t: 'chat', text: m.text };
    case 'attack':
      if (!isInt(m.id)) return null;
      return { t: 'attack', id: m.id };
    case 'interact':
      if (!isInt(m.id) || (m.hand !== 0 && m.hand !== 1)) return null;
      return { t: 'interact', id: m.id, hand: m.hand };
    case 'respawn':
      return { t: 'respawn' };
    case 'drop':
      if (!isBool(m.all)) return null;
      return { t: 'drop', all: m.all };
    case 'swap_hands':
      return { t: 'swap_hands' };
    case 'settings':
      if (!isInt(m.viewDistance)) return null;
      return { t: 'settings', viewDistance: m.viewDistance };
    case 'swing':
      return { t: 'swing' };
    case 'set_flying':
      if (!isBool(m.flying)) return null;
      return { t: 'set_flying', flying: m.flying };
    case 'sign_text':
      if (!isInt(m.x) || !isInt(m.y) || !isInt(m.z) || !Array.isArray(m.lines) || m.lines.length !== 4) return null;
      if (!m.lines.every((l) => isStr(l, LIMITS.signLine))) return null;
      return { t: 'sign_text', x: m.x, y: m.y, z: m.z, lines: m.lines as string[] };
    case 'enchant':
      if (!isInt(m.option) || m.option < 0 || m.option > 2) return null;
      return { t: 'enchant', option: m.option };
    case 'rename':
      if (!isStr(m.name, 50)) return null;
      return { t: 'rename', name: m.name };
    case 'trade':
      if (!isInt(m.index) || m.index < 0 || m.index > 32) return null;
      return { t: 'trade', index: m.index };
    case 'wake':
      return { t: 'wake' };
    case 'request_progress':
      return { t: 'request_progress' };
    case 'ping':
      if (!isNum(m.time)) return null;
      return { t: 'ping', time: m.time };
    case 'admin': {
      if (!isInt(m.req)) return null;
      const action = validateAdmin(m.action);
      if (!action) return null;
      return { t: 'admin', req: m.req, action };
    }
    case 'vehicle_move':
      if (!inRange(m.x, -COORD, COORD) || !inRange(m.y, -512, 1024) || !inRange(m.z, -COORD, COORD) || !isNum(m.yaw)) return null;
      return { t: 'vehicle_move', x: m.x, y: m.y, z: m.z, yaw: m.yaw };
    case 'dismount':
      return { t: 'dismount' };
    case 'eng_cfg':
      if (!isInt(m.window) || !isStr(m.key, 48) || !(isStr(m.value, 48) || (isNum(m.value) && Number.isFinite(m.value)))) return null;
      return { t: 'eng_cfg', window: m.window, key: m.key, value: m.value as string | number };
    case 'eng_fill':
      if (!isInt(m.recipe) || m.recipe < 0 || m.recipe > 10000 || !isBool(m.all)) return null;
      return { t: 'eng_fill', recipe: m.recipe, all: m.all };
    case 'pc_cmd':
      if (!isInt(m.window) || !isStr(m.cmd, 48)) return null;
      if (m.arg !== undefined && !(isStr(m.arg, 96) || (isNum(m.arg) && Number.isFinite(m.arg)))) return null;
      return { t: 'pc_cmd', window: m.window, cmd: m.cmd, ...(m.arg !== undefined ? { arg: m.arg as string | number } : {}) };
    default:
      return null;
  }
}
