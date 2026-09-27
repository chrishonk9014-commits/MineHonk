/** Item slot rendering and tooltips. */
import { el } from './dom';
import type { ItemIcons } from '../render/ItemIcons';
import type { Slot } from '../../common/game/itemstack';
import { items } from '../../common/registry/items';
import { romanNumeral } from '../../common/data/enchantments';
import { enchantName } from '../../common/game/enchanting';
import { blockById } from '../../common/registry/blocks';

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
  const url = icons.icon(stack.id);
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
  return it?.def.name ?? '?';
}

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
  const d = it.def;
  if (d.food) tooltipEl.append(el('div', { class: 'dim' }, `Restores ${d.food.hunger / 2} hunger`));
  if (d.weapon && d.tool?.type !== undefined) {
    tooltipEl.append(el('div', { class: 'dim' }, ''), el('div', { class: 'dim' }, 'When in Main Hand:'), el('div', { class: 'blue' }, ` ${d.weapon.damage} Attack Damage`), el('div', { class: 'blue' }, ` ${d.weapon.speed} Attack Speed`));
  }
  if (d.armor) tooltipEl.append(el('div', { class: 'blue' }, `+${d.armor.defense} Armor`), ...(d.armor.toughness ? [el('div', { class: 'blue' }, `+${d.armor.toughness} Armor Toughness`)] : []));
  if (d.durability && (stack.damage ?? 0) > 0) tooltipEl.append(el('div', { class: 'dim' }, `Durability: ${d.durability - (stack.damage ?? 0)} / ${d.durability}`));
  if (it.id === 'farlands_compass') tooltipEl.append(el('div', { class: 'rarity-glitched' }, 'Points somewhere it should not.'));
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
