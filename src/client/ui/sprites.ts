/** GUI pixel-art sprites painted at runtime and exposed as data URLs. */
type Pal = Record<string, string>;

function draw(w: number, h: number, rows: string[], pal: Pal): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const col = pal[r[x]!];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c.toDataURL();
}

const HEART = ['.XX...XX.', 'XrrX.XrrX', 'XrwrXrrrX', 'XrrrrrrrX', '.XrrrrrX.', '..XrrrX..', '...XrX...', '....X....', '.........'];
const HALF = ['.XX...XX.', 'XrrX.XeeX', 'XrwrXeeeX', 'XrrrreeeX', '.XrrreeX.', '..XrreX..', '...XrX...', '....X....', '.........'];
const FOOD = ['.....XXX.', '....XbbbX', '...XbcbbX', '...XbbbbX', '..XbbbbX.', '.XXXXXX..', 'XwX......', 'XwwX.....', '.XX......'];
const FOOD_HALF = ['.....XXX.', '....XbbbX', '...XeeeeX', '...XeeeeX', '..XeeeeX.', '.XXXXXX..', 'XeX......', 'XeeX.....', '.XX......'];
const ARMOR = ['.XX...XX.', 'XggX.XggX', 'XgwgggggX', 'XgggggggX', '.XgggggX.', '.XgggggX.', '.XgggggX.', '..XXXXX..', '.........'];
const ARMOR_HALF = ['.XX...XX.', 'XggX.XeeX', 'XgwggeeeX', 'XggggeeeX', '.XgggeeX.', '.XgggeeX.', '.XgggeeX.', '..XXXXX..', '.........'];
const BUBBLE = ['..XXXXX..', '.XbbbbbX.', 'XbwwbbbbX', 'XbwbbbbbX', 'XbbbbbbbX', 'XbbbbbbbX', '.XbbbbbX.', '..XXXXX..', '.........'];

export interface GuiSprites {
  heart: string;
  heartHalf: string;
  heartEmpty: string;
  heartGold: string;
  heartGoldHalf: string;
  heartPoison: string;
  heartPoisonHalf: string;
  heartWither: string;
  heartWitherHalf: string;
  heartHardcore: string;
  heartHardcoreHalf: string;
  heartInfinite: string;
  food: string;
  foodHalf: string;
  foodEmpty: string;
  foodHunger: string;
  foodHungerHalf: string;
  armor: string;
  armorHalf: string;
  armorEmpty: string;
  bubble: string;
  bubblePop: string;
  arrowEmpty: string;
  arrowFull: string;
  flameEmpty: string;
  flameFull: string;
  crosshair: string;
}

let cache: GuiSprites | null = null;

export function sprites(): GuiSprites {
  if (cache) return cache;
  const red = { X: '#000000', r: '#e0141e', w: '#ffc8c8', e: '#3a0a0a' };
  const gold = { X: '#000000', r: '#f5c518', w: '#fff6b0', e: '#3a2a0a' };
  const poison = { X: '#000000', r: '#7a9a1a', w: '#d8f090', e: '#1a2a0a' };
  const wither = { X: '#1a1a1a', r: '#2a2a2a', w: '#6a6a6a', e: '#0a0a0a' };
  const hard = { X: '#000000', r: '#c01020', w: '#ffffff', e: '#3a0a0a' };
  const empty = { X: '#000000', r: '#3a0a0a', w: '#3a0a0a', e: '#3a0a0a' };
  const heartHardcoreRows = HEART.map((r, i) => (i === 1 ? 'XrrXXXrrX' : r));
  const inf = draw(9, 9, HEART, { X: '#000000', r: '#e040ff', w: '#ffffff', e: '#3a0a3a' });
  const foodPal = { X: '#000000', b: '#b8682a', c: '#e8a060', w: '#f0e8d8', e: '#3a2a1a' };
  const hungerPal = { X: '#000000', b: '#6a8a2a', c: '#a8c860', w: '#d8e8a8', e: '#1a2a0a' };
  const foodEmpty = { X: '#000000', b: '#3a2a1a', c: '#3a2a1a', w: '#3a2a1a', e: '#3a2a1a' };
  const armorPal = { X: '#000000', g: '#d0d0d0', w: '#ffffff', e: '#3a3a3a' };
  const armorEmpty = { X: '#3a3a3a', g: '#1a1a1a', w: '#1a1a1a', e: '#1a1a1a' };
  const bubblePal = { X: '#1a3a8a', b: '#4a8ae8', w: '#ffffff' };
  const arrow = (fill: boolean): string =>
    draw(24, 17, ['........XX..............', '........XfX.............', '........XffX............', 'XXXXXXXXXfffX...........', 'XffffffffffffX..........', 'XfffffffffffffX.........', 'XffffffffffffffX........', 'XfffffffffffffffX.......', 'XffffffffffffffX........', 'XfffffffffffffX.........', 'XffffffffffffX..........', 'XXXXXXXXXfffX...........', '........XffX............', '........XfX.............', '........XX..............'], { X: '#8b8b8b', f: fill ? '#ffffff' : '#8b8b8b' });
  const flame = (fill: boolean): string =>
    draw(14, 14, ['......y.......', '.....yy.......', '.....yyy......', '....yyoy......', '....yoooy.....', '...yyoooy.y...', '...yooroooy...', '..yyorrroyy...', '..yoorrrooy...', '.yoorrrrrooy..', '.yoorrrrrroy..', '..yoorrrroy...', '...yyoooyy....', '....yyyyy.....'], fill ? { y: '#ffd040', o: '#ff8a1a', r: '#e0401a' } : { y: '#8b8b8b', o: '#8b8b8b', r: '#8b8b8b' });
  cache = {
    heart: draw(9, 9, HEART, red),
    heartHalf: draw(9, 9, HALF, red),
    heartEmpty: draw(9, 9, HEART, empty),
    heartGold: draw(9, 9, HEART, gold),
    heartGoldHalf: draw(9, 9, HALF, gold),
    heartPoison: draw(9, 9, HEART, poison),
    heartPoisonHalf: draw(9, 9, HALF, poison),
    heartWither: draw(9, 9, HEART, wither),
    heartWitherHalf: draw(9, 9, HALF, wither),
    heartHardcore: draw(9, 9, heartHardcoreRows, hard),
    heartHardcoreHalf: draw(9, 9, HALF.map((r, i) => (i === 1 ? 'XrrXXXeeX' : r)), hard),
    heartInfinite: inf,
    food: draw(9, 9, FOOD, foodPal),
    foodHalf: draw(9, 9, FOOD_HALF, foodPal),
    foodEmpty: draw(9, 9, FOOD, foodEmpty),
    foodHunger: draw(9, 9, FOOD, hungerPal),
    foodHungerHalf: draw(9, 9, FOOD_HALF, hungerPal),
    armor: draw(9, 9, ARMOR, armorPal),
    armorHalf: draw(9, 9, ARMOR_HALF, armorPal),
    armorEmpty: draw(9, 9, ARMOR, armorEmpty),
    bubble: draw(9, 9, BUBBLE, bubblePal),
    bubblePop: draw(9, 9, ['.........', '..X...X..', '.X.....X.', '.........', '.........', '.X.....X.', '..X...X..', '.........', '.........'], bubblePal),
    arrowEmpty: arrow(false),
    arrowFull: arrow(true),
    flameEmpty: flame(false),
    flameFull: flame(true),
    crosshair: draw(15, 15, ['.......w.......', '.......w.......', '.......w.......', '.......w.......', '.......w.......', '.......w.......', '...............', 'wwwwww...wwwwww', '...............', '.......w.......', '.......w.......', '.......w.......', '.......w.......', '.......w.......', '.......w.......'], { w: '#ffffff' }),
  };
  return cache;
}
