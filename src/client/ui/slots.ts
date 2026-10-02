/** Item slot rendering and tooltips. */
import { loreBookName } from '../../common/endExpansion/lore';
import { el } from './dom';
import type { ItemIcons } from '../render/ItemIcons';
import type { Slot } from '../../common/game/itemstack';
import { items, itemById } from '../../common/registry/items';
import { romanNumeral } from '../../common/data/enchantments';
import { enchantName } from '../../common/game/enchanting';
import { blockById } from '../../common/registry/blocks';
import { POTION_BY_ID } from '../../common/data/potions';

let icons: ItemIcons | null = null;
export function setIcons(i: ItemIcons): void {
  icons = i;
}

export function iconEl(stack: Slot, showCount = true): HTMLElement | null {
  if (!stack || !icons) return null;
  const it = items[stack.id];
  if (!it) return null;
  const glint = !!(stack.tag?.ench && Object.keys(stack.tag.ench).length) || !!stack.tag?.stored || !!it.def.glint;
  const icon = el('div', { class: 'item-icon' + (glint ? ' glint' : '') });
  const url = icons.iconFor(stack);
  icon.style.backgroundImage = `url(${url})`;
  if (glint) {
    icon.style.setProperty('mask-image', `url(${url})`);
    icon.style.setProperty('-webkit-mask-image', `url(${url})`);
  }
  const frag = document.createDocumentFragment() as unknown as HTMLElement;
  const wrap = el('div', { style: { position: 'absolute', inset: '0' } }, icon);
  if (showCount && stack.count > 1) wrap.append(el('div', { class: 'count' }, String(stack.count)));
  const dur = it.def.durability;
  if (dur && stack.damage && stack.damage > 0) {
    const f = 1 - stack.damage / dur;
    const bar = el('div', { style: { width: `${Math.max(1, Math.round(f * 13))}/13` } });
    bar.style.width = `${f * 100}%`;
    bar.style.background = `hsl(${Math.round(f * 120)}, 100%, 50%)`;
    wrap.append(el('div', { class: 'durability' }, bar));
  }
  void frag;
  return wrap;
}

export function fillSlot(slotEl: HTMLElement, stack: Slot): void {
  const old = slotEl.querySelector(':scope > .content');
  if (old) old.remove();
  const ic = iconEl(stack);
  if (ic) {
    ic.classList.add('content');
    slotEl.append(ic);
  }
}

export function itemDisplayName(stack: Slot): string {
  if (!stack) return '';
  if (stack.tag?.name) return stack.tag.name;
  const it = items[stack.id];
  if (it?.id === 'compass' && stack.tag?.data?.lodestone) return 'Lodestone Compass';
  // V6 phase 3: a lore book is called by what it holds
  if (it?.id === 'book' && stack.tag?.lore) return loreBookName(stack.tag.lore) ?? it.def.name;
  if (stack.tag?.potion && (it?.id === 'potion' || it?.id === 'splash_potion')) {
    const p = POTION_BY_ID.get(stack.tag.potion);
    if (p) return (it.id === 'splash_potion' ? 'Splash ' : '') + p.name;
  }
  return it?.def.name ?? '?';
}

function ticksToTime(t: number): string {
  const s = Math.round(t / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const HARMFUL = new Set(['slowness', 'poison', 'instant_damage', 'weakness', 'wither', 'hunger', 'nausea', 'blindness', 'darkness', 'levitation', 'mining_fatigue']);

const tooltipEl = el('div', { class: 'tooltip hidden' });
let tooltipAttached = false;

export function showTooltip(stack: Slot, x: number, y: number, advanced = false): void {
  if (!tooltipAttached) {
    document.getElementById('ui')!.append(tooltipEl);
    tooltipAttached = true;
  }
  if (!stack) {
    hideTooltip();
    return;
  }
  const it = items[stack.id]!;
  tooltipEl.innerHTML = '';
  const rarity = it.def.rarity && it.def.rarity !== 'common' ? `rarity-${it.def.rarity}` : stack.tag?.ench ? 'rarity-rare' : '';
  tooltipEl.append(el('div', { class: rarity + (stack.tag?.name ? ' italic' : '') }, itemDisplayName(stack)));
  for (const [id, lvl] of Object.entries(stack.tag?.ench ?? {})) tooltipEl.append(el('div', { class: 'ench' }, `${enchantName(id)}${lvl > 1 || id !== 'silk_touch' ? ' ' + romanNumeral(lvl) : ''}`));
  for (const [id, lvl] of Object.entries(stack.tag?.stored ?? {})) tooltipEl.append(el('div', { class: 'yellow' }, `${enchantName(id)} ${romanNumeral(lvl)}`));
  if (stack.tag?.potion) {
    const p = POTION_BY_ID.get(stack.tag.potion);
    if (p && p.effects.length === 0) tooltipEl.append(el('div', { class: 'dim' }, 'No Effects'));
    for (const e of p?.effects ?? []) {
      const nm = e.id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const lvl = e.amp > 0 ? ' ' + romanNumeral(e.amp + 1) : '';
      const dur = e.duration > 20 ? ` (${ticksToTime(e.duration * (it.id === 'splash_potion' ? 0.75 : 1))})` : '';
      tooltipEl.append(el('div', { class: HARMFUL.has(e.id) ? 'error-text' : 'blue' }, nm + lvl + dur));
    }
  }
  const d = it.def;
  if (d.food) tooltipEl.append(el('div', { class: 'dim' }, `Restores ${d.food.hunger / 2} hunger`));
  if (d.weapon && d.tool?.type !== undefined) {
    tooltipEl.append(el('div', { class: 'dim' }, ''), el('div', { class: 'dim' }, 'When in Main Hand:'), el('div', { class: 'blue' }, ` ${d.weapon.damage} Attack Damage`), el('div', { class: 'blue' }, ` ${d.weapon.speed} Attack Speed`));
  }
  if (d.armor) tooltipEl.append(el('div', { class: 'blue' }, `+${d.armor.defense} Armor`), ...(d.armor.toughness ? [el('div', { class: 'blue' }, `+${d.armor.toughness} Armor Toughness`)] : []));
  if (d.durability && (stack.damage ?? 0) > 0) tooltipEl.append(el('div', { class: 'dim' }, `Durability: ${d.durability - (stack.damage ?? 0)} / ${d.durability}`));
  if (d.tooltip) tooltipEl.append(el('div', { class: 'dim italic' }, d.tooltip));
  // Packed contents (a shulker box, a V6 Void Pack): the first five stacks, then a count of the rest
  if ((it.id === 'shulker_box' || it.id === 'void_pack') && Array.isArray(stack.tag?.data?.items)) {
    const packed = (stack.tag!.data!.items as ({ id?: unknown; count?: unknown } | null)[]).filter((e) => e && typeof e.id === 'string');
    for (const e of packed.slice(0, 5)) tooltipEl.append(el('div', {}, `${itemById.get(String(e!.id).replace(/^minehonk:/, ''))?.def.name ?? String(e!.id)} x${Number(e!.count ?? 1)}`));
    if (packed.length > 5) tooltipEl.append(el('div', { class: 'dim italic' }, `and ${packed.length - 5} more...`));
  }
  if (it.id === 'farlands_compass') tooltipEl.append(el('div', { class: 'rarity-glitched' }, 'Points somewhere it should not.'));
  if (it.id === 'mysterious_potion') tooltipEl.append(el('div', { class: 'dim italic' }, 'Something in it is looking back.'));
  // V5.5: drives show what they hold
  if (it.id === 'hard_drive' || it.id === 'flash_drive' || it.id === 'corrupted_flash_drive') {
    const t = stack.tag?.data as { label?: string; used?: number; cap?: number; spent?: boolean } | undefined;
    if (it.id === 'corrupted_flash_drive') tooltipEl.append(el('div', { class: 'rarity-glitched' }, t?.spent ? 'Empty now. Something used to be on it.' : 'Do not plug this in.'));
    if (t?.label && it.id !== 'corrupted_flash_drive') tooltipEl.append(el('div', {}, `"${t.label}"`));
    if (typeof t?.used === 'number' && typeof t.cap === 'number') tooltipEl.append(el('div', { class: 'dim' }, it.id === 'corrupted_flash_drive' ? `${t.used} / ??? KB` : `${t.used} / ${t.cap} KB used`));
    else if (it.id !== 'corrupted_flash_drive') tooltipEl.append(el('div', { class: 'dim' }, 'Empty'));
  }
  if (it.id === 'witch_grimoire') tooltipEl.append(el('div', { class: 'dim italic' }, 'Two doors, one bottle.'));
  if (it.id === 'book' && stack.tag?.lore) tooltipEl.append(el('div', { class: 'dim' }, 'Right-click to read'));
  if (it.id === 'corrupted_eye') {
    tooltipEl.append(el('div', { class: 'dim italic' }, 'It remembers the End breaking.'));
    tooltipEl.append(el('div', { class: 'dim' }, 'Throw: shows the way to a glitched portal'));
  }
  if (stack.tag?.admin) tooltipEl.append(el('div', { class: 'dim' }, 'Cheat item: never counts for advancements'));
  if (advanced) {
    tooltipEl.append(el('div', { class: 'dim' }, `minehonk:${it.id}`));
    if (d.block && blockById.get(d.block)) tooltipEl.append(el('div', { class: 'dim' }, `hardness ${blockById.get(d.block)!.def.hardness}`));
  }
  tooltipEl.classList.remove('hidden');
  const r = tooltipEl.getBoundingClientRect();
  let tx = x + 14;
  let ty = y - 14;
  if (tx + r.width > window.innerWidth) tx = x - r.width - 14;
  if (ty + r.height > window.innerHeight) ty = window.innerHeight - r.height - 4;
  tooltipEl.style.left = tx + 'px';
  tooltipEl.style.top = Math.max(4, ty) + 'px';
}

export function hideTooltip(): void {
  tooltipEl.classList.add('hidden');
}
