/**
 * The Update Log (Options > Update Log): what each update added, with
 * screenshots, item icons, recipes and step-by-step examples. Entries are
 * plain data; UpdateLogScreen.ts draws them.
 */
import { V6_LOG } from './updateLogV6';
import { itemById } from '../../common/registry/items';

/** A card: a picture (or an item icon), a title, a description and a line of details. */
export interface Card {
  /** Screenshot name in public/updatelog/<version>/ (without .webp). */
  img?: string;
  /** Item id whose icon stands in for a picture. */
  icon?: string;
  title: string;
  text: string;
  meta?: string;
  /** Opens this section of the same entry when the card is clicked. */
  link?: string;
}

/**
 * Text supports **bold**. Table cells starting with "@item_id " show that
 * item's icon before the rest of the text.
 */
export type Block =
  | { k: 'p'; text: string }
  | { k: 'h'; text: string }
  | { k: 'img'; img: string; caption: string }
  | { k: 'gallery'; items: { img: string; caption: string }[] }
  | { k: 'cards'; title?: string; items: Card[] }
  | { k: 'items'; title?: string; ids: string[] }
  | { k: 'list'; items: string[] }
  | { k: 'table'; title?: string; head: string[]; rows: string[][] }
  | { k: 'tip'; text: string }
  | {
      k: 'example';
      title: string;
      text?: string;
      steps?: string[];
      /** Shows the crafting recipe (normal or engineering) of this item. */
      recipe?: string;
      /** Shows "a + b > result" (smithing and the like). */
      equation?: { parts: string[]; result: string; where: string };
    }
  /** The advancements from one id to another, in the order of the game's list. */
  | { k: 'advancements'; from: string; to: string };

export interface Section {
  id: string;
  title: string;
  /** Item id shown beside the title in the list. */
  icon: string;
  blocks: Block[];
}

export interface UpdateEntry {
  /** "V6": also the folder of its pictures (lowercased). */
  version: string;
  name: string;
  tagline: string;
  /** The picture at the top of its first section. */
  hero: string;
  sections: Section[];
}

/** Newest first. */
export const UPDATE_LOG: readonly UpdateEntry[] = [V6_LOG];

/** Where an entry's picture is served from (relative to the page, like the game's other assets). */
export function imageUrl(entry: UpdateEntry, name: string): string {
  return `updatelog/${entry.version.toLowerCase()}/${name}.webp`;
}

/** An advancement's icon as an item (a few use blocks that have no item: a close relative stands in). */
export function advancementIcon(icon: string): string {
  if (itemById.has(icon)) return icon;
  const plain = icon.replace(/^(restored|cracked|chiseled|stripped)_/, '');
  return itemById.has(plain) ? plain : 'end_stone';
}

/** Every picture an entry uses (the tests check that each one exists). */
export function entryImages(entry: UpdateEntry): string[] {
  const out = new Set<string>([entry.hero]);
  for (const s of entry.sections)
    for (const b of s.blocks) {
      if (b.k === 'img') out.add(b.img);
      else if (b.k === 'gallery') {
        for (const i of b.items) out.add(i.img);
      } else if (b.k === 'cards') {
        for (const c of b.items) if (c.img) out.add(c.img);
      }
    }
  return [...out];
}

/** Every item id an entry shows an icon of (the tests check that each one exists). */
export function entryItems(entry: UpdateEntry): string[] {
  const out = new Set<string>();
  for (const s of entry.sections) {
    out.add(s.icon);
    for (const b of s.blocks) {
      if (b.k === 'items') for (const id of b.ids) out.add(id);
      else if (b.k === 'cards') {
        for (const c of b.items) if (c.icon) out.add(c.icon);
      } else if (b.k === 'table') {
        for (const r of b.rows) for (const c of r) if (c.startsWith('@')) out.add(c.slice(1).split(' ')[0]!);
      } else if (b.k === 'example') {
        if (b.recipe) out.add(b.recipe);
        if (b.equation) for (const id of [...b.equation.parts, b.equation.result]) out.add(id);
      }
    }
  }
  return [...out];
}
