/**
 * Item sprites. Shapes are hand-authored 16x16 masks recoloured per
 * material, which keeps the whole set stylistically consistent.
 *
 * Palette letters: o outline, a dark, b mid, c light, d highlight,
 * h/H/k handle (light/dark/outline), and per-mask extras.
 */
import { Tex, type RGB, hex, shade, mix } from './canvas';
import type { PainterRegistry } from './registry';
import { DYE } from './blocksDeco';
import { MOB_DEFS } from '../../src/common/data/mobs';
import { hashInts } from '../../src/common/math/rng';

type Pal = Record<string, RGB>;

export function matPal(base: RGB, outlineMul = 0.45): Pal {
  return { o: shade(base, outlineMul), a: shade(base, 0.72), b: base, c: shade(base, 1.2), d: shade(base, 1.45) };
}
const HANDLE: Pal = { h: hex(0x8a6a3a), H: hex(0x5c4222), k: hex(0x2c1e0e) };

const M: Record<string, string[]> = {
  sword: [
    '................',
    '.............ooo',
    '............ocdo',
    '...........ocdbo',
    '..........ocdbo.',
    '.........ocdbo..',
    '........ocdbo...',
    '.......ocdbo....',
    '..oo..ocdbo.....',
    '..oaoocdbo......',
    '...oabdbo.......',
    '....oabo........',
    '...khHoao.......',
    '..khHk.oo.......',
    '.okHk...........',
    '.oko............',
  ],
  pickaxe: [
    '................',
    '....ooooo.......',
    '...occcccoo.....',
    '....oooobbbo....',
    '........obbbo...',
    '.......khobbo...',
    '......khHkobo...',
    '.....khHk.obbo..',
    '....khHk...obo..',
    '...khHk....obo..',
    '..khHk......oo..',
    '.khHk...........',
    'khHk............',
    'kHk.............',
    '.k..............',
    '................',
  ],
  axe: [
    '................',
    '.......ooo......',
    '......occbo.....',
    '.....occbbbo....',
    '.....ocbbbbao...',
    '......obbbbao...',
    '......khoabao...',
    '.....khHkoaao...',
    '....khHk..oo....',
    '...khHk.........',
    '..khHk..........',
    '.khHk...........',
    'khHk............',
    'kHk.............',
    '.k..............',
    '................',
  ],
  shovel: [
    '................',
    '..........ooo...',
    '.........occbo..',
    '........occbbo..',
    '........ocbbbao.',
    '.........obbaao.',
    '........khoaao..',
    '.......khHkoo...',
    '......khHk......',
    '.....khHk.......',
    '....khHk........',
    '...khHk.........',
    '..khHk..........',
    '.khHk...........',
    '.kk.............',
    '................',
  ],
  hoe: [
    '................',
    '.....ooooo......',
    '....occccbo.....',
    '.....ooobbo.....',
    '........obbo....',
    '.......khobo....',
    '......khHkoo....',
    '.....khHk.......',
    '....khHk........',
    '...khHk.........',
    '..khHk..........',
    '.khHk...........',
    'khHk............',
    'kHk.............',
    '.k..............',
    '................',
  ],
  helmet: [
    '................',
    '................',
    '................',
    '....oooooooo....',
    '...occccccbbo...',
    '..ocbbbbbbbbao..',
    '..obboooooobao..',
    '..obo......oao..',
    '..obo......oao..',
    '..ooo......ooo..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  chestplate: [
    '................',
    '...ooo....ooo...',
    '..ocbo....ocbo..',
    '..obbboooobbao..',
    '..obbbccbbbbao..',
    '..ooobbbbbaooo..',
    '....obbbbbao....',
    '....obbbbbao....',
    '....obbbbbao....',
    '....obbbbbao....',
    '....obbbbaao....',
    '....oooooooo....',
    '................',
    '................',
    '................',
    '................',
  ],
  leggings: [
    '................',
    '................',
    '....oooooooo....',
    '....occbbbao....',
    '....obbbbbao....',
    '....obbooboo....',
    '....obbo.obo....',
    '....obbo.obo....',
    '....obbo.obo....',
    '....obbo.oao....',
    '....obao.oao....',
    '....oooo.ooo....',
    '................',
    '................',
    '................',
    '................',
  ],
  boots: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '...ooo....ooo...',
    '...ocbo...obbo..',
    '...obbo...obao..',
    '...obbo...obao..',
    '..obbbo...obbao.',
    '..ooooo...ooooo.',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  ingot: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......oooooo....',
    '....oodcccbbo...',
    '...occcbbbbao...',
    '..ocbbbbbbaao...',
    '..obbbbbbaaoo...',
    '..oaaaaaaoo.....',
    '..ooooooo.......',
    '................',
    '................',
    '................',
    '................',
  ],
  nugget: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......ooo.......',
    '.....ocdbo......',
    '....ocbbbao.....',
    '....obbbbao.....',
    '.....ooaaoo.....',
    '.......oo.......',
    '................',
    '................',
    '................',
    '................',
  ],
  gem: [
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....odcccbbo....',
    '...odccbbbbao...',
    '..oooooooooooo..',
    '...obbbbbbbao...',
    '....obbbbbao....',
    '.....obbbao.....',
    '......obao......',
    '.......oo.......',
    '................',
    '................',
    '................',
    '................',
  ],
  emerald: [
    '................',
    '................',
    '.......oo.......',
    '......ocdo......',
    '.....occbbo.....',
    '....occbbbao....',
    '....ocbbbbao....',
    '....obbbbbao....',
    '....obbbbaao....',
    '.....obbaao.....',
    '......oaao......',
    '.......oo.......',
    '................',
    '................',
    '................',
    '................',
  ],
  raw: [
    '................',
    '................',
    '................',
    '.......ooo......',
    '.....ooccbo.....',
    '....occbbbbo....',
    '...ocbbabbbao...',
    '...obbbbbaaao...',
    '..obbabbbbbao...',
    '..obbbbbaabao...',
    '...oabbbbbaoo...',
    '....ooaaaao.....',
    '......oooo......',
    '................',
    '................',
    '................',
  ],
  dust: [
    '................',
    '................',
    '................',
    '................',
    '.......c........',
    '.....c..b.......',
    '......bcb..c....',
    '....cbbabb......',
    '...b.babcab.....',
    '....abcbbab.c...',
    '..c.bbabcbba....',
    '...aabbcbabb....',
    '....oaaaaaao....',
    '................',
    '................',
    '................',
  ],
  lump: [
    '................',
    '................',
    '................',
    '......ooo.......',
    '....ooccbo......',
    '...ocbbbbbo.....',
    '..ocbbabbbbo....',
    '..obbbbbabbao...',
    '..obabbbbbbao...',
    '...obbbbabaao...',
    '...oabbbbaao....',
    '....ooaaaoo.....',
    '......ooo.......',
    '................',
    '................',
    '................',
  ],
  shard: [
    '................',
    '................',
    '..........oo....',
    '.........ocdo...',
    '........occbo...',
    '.......occbo....',
    '......occbbo....',
    '.....ocbbbo.....',
    '....ocbbbo......',
    '...ocbbao.......',
    '...obbao........',
    '...oaao.........',
    '....oo..........',
    '................',
    '................',
    '................',
  ],
  ball: [
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '.....odccbo.....',
    '....odcbbbao....',
    '....ocbbbbao....',
    '....obbbbbao....',
    '....obbbbaao....',
    '.....oaaaao.....',
    '......oooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  stick: [
    '................',
    '................',
    '................',
    '...........kk...',
    '..........khHk..',
    '.........khHk...',
    '........khHk....',
    '.......khHk.....',
    '......khHk......',
    '.....khHk.......',
    '....khHk........',
    '...khHk.........',
    '..khHk..........',
    '..kHk...........',
    '...k............',
    '................',
  ],
  rod: [
    '................',
    '...........oo...',
    '..........ocbo..',
    '.........ocbo...',
    '........ocbo....',
    '.......ocbo.....',
    '......ocbo......',
    '.....ocbo.......',
    '....ocbo........',
    '...ocbo.........',
    '..ocbo..........',
    '..obo...........',
    '...o............',
    '................',
    '................',
    '................',
  ],
  bone: [
    '................',
    '................',
    '............oo..',
    '...........ocdo.',
    '..........ocbo..',
    '.........ocbo...',
    '........ocbo....',
    '.......ocbo.....',
    '......ocbo......',
    '.....ocbo.......',
    '..ooocbo........',
    '.ocdcbo.........',
    '..ocbo..........',
    '...oo...........',
    '................',
    '................',
  ],
  feather: [
    '................',
    '...........oo...',
    '..........occo..',
    '.........occbo..',
    '........occbbo..',
    '.......occbbo...',
    '......occbbo....',
    '.....occbbo.....',
    '....ocbbbo......',
    '....obbbo.......',
    '...oabao........',
    '..oHoo..........',
    '.oH.............',
    '.o..............',
    '................',
    '................',
  ],
  string: [
    '................',
    '................',
    '..........cc....',
    '.........c..c...',
    '........c....c..',
    '.......c......b.',
    '......c.......b.',
    '.....b.......b..',
    '....b.......b...',
    '...b......bb....',
    '...b....bb......',
    '....bbbb........',
    '................',
    '................',
    '................',
    '................',
  ],
  sheet: [
    '................',
    '................',
    '...oooooooooo...',
    '...occcccccco...',
    '...ocbbbbbbbo...',
    '...occcccccco...',
    '...ocbbbbbbbo...',
    '...occcccccco...',
    '...ocbbbbbbbo...',
    '...occcccccco...',
    '...ocbbbbbbbo...',
    '...occcccccco...',
    '...oooooooooo...',
    '................',
    '................',
    '................',
  ],
  book: [
    '................',
    '................',
    '...ooooooooo....',
    '..occcccccbbo...',
    '..obbbbbbbbao...',
    '..obbbccbbbao...',
    '..obbbbbbbbao...',
    '..obbbbbbbbao...',
    '..obbbbbbbbao...',
    '..obbbbbbbbao...',
    '..oaaaaaaaaao...',
    '..odddddddddo...',
    '...ooooooooo....',
    '................',
    '................',
    '................',
  ],
  bucket: [
    '................',
    '................',
    '................',
    '...oooooooooo...',
    '..oaaaaaaaaaao..',
    '..obcccccccbao..',
    '..obbbbbbbbbao..',
    '...obbbbbbbao...',
    '...obbbbbbbao...',
    '...obbbbbbbao...',
    '....obbbbbao....',
    '....oaaaaaao....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
  ],
  bottle: [
    '................',
    '......oooo......',
    '......occo......',
    '.......oo.......',
    '......oddo......',
    '.....oddddo.....',
    '....oddddddo....',
    '....oddddddo....',
    '....oddddddo....',
    '....oddddddo....',
    '.....oddddo.....',
    '......oooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  apple: [
    '................',
    '........H.......',
    '.......Hgg......',
    '....oooHoooo....',
    '...ocdbbbbbao...',
    '..ocdbbbbbbbao..',
    '..obbbbbbbbbao..',
    '..obbbbbbbbbao..',
    '..obbbbbbbbaao..',
    '...obbbbbbaao...',
    '...oabbbbaaao...',
    '....ooaooaoo....',
    '......o..o......',
    '................',
    '................',
    '................',
  ],
  bread: [
    '................',
    '................',
    '................',
    '................',
    '.......oooooo...',
    '.....oocdcdcbo..',
    '....ocbcbcbcbao.',
    '...ocbbbbbbbbao.',
    '..ocbbbbbbbbaoo.',
    '..obbbbbbbbaao..',
    '..obbbbbbbaaoo..',
    '...oaaaaaaoo....',
    '....oooooo......',
    '................',
    '................',
    '................',
  ],
  meat: [
    '................',
    '................',
    '................',
    '.......ooooo....',
    '.....ooccbbbo...',
    '....ocbbbbbbao..',
    '...ocbbbabbbao..',
    '...obbbbbbbbao..',
    '...obbbbbbbaao..',
    '..ooobbbbbaao...',
    '.odoooaaaaoo....',
    '.oddo.oooo......',
    '..oo............',
    '................',
    '................',
    '................',
  ],
  fish: [
    '................',
    '................',
    '................',
    '................',
    '...........o....',
    '.......oooooo...',
    '.....oocbbbbao.o',
    '...oocbbbbbbbaoo',
    '..ocbdbbbbbbbaoo',
    '..obbbbbbbbbaaoo',
    '...ooaaaaaaaao.o',
    '.....oooooooo...',
    '................',
    '................',
    '................',
    '................',
  ],
  potato: [
    '................',
    '................',
    '................',
    '................',
    '.......oooo.....',
    '.....oocccbo....',
    '....ocbbbabbo...',
    '...ocbabbbbbao..',
    '...obbbbbbabao..',
    '...obbbabbbbao..',
    '....oabbbbbao...',
    '.....oaaaaoo....',
    '......oooo......',
    '................',
    '................',
    '................',
  ],
  carrot: [
    '................',
    '..........g..g..',
    '...........gG...',
    '..........gGg...',
    '.........oooo...',
    '........occbo...',
    '.......occbo....',
    '......occbao....',
    '.....ocbbao.....',
    '....ocbbao......',
    '...ocbaao.......',
    '...obaao........',
    '..obao..........',
    '..ooo...........',
    '................',
    '................',
  ],
  seeds: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......b........',
    '....c.......c...',
    '.........a......',
    '...b...c....b...',
    '.......a........',
    '.....b....c.....',
    '..a.......b.....',
    '......c.a.......',
    '................',
    '................',
    '................',
  ],
  berries: [
    '................',
    '................',
    '........g.......',
    '.......gG.......',
    '......g..g......',
    '.....oo..oo.....',
    '....ocbooccbo...',
    '....obboocbbo...',
    '.....oo.obbo....',
    '....ocbo.oo.....',
    '....obbo........',
    '.....oo.........',
    '................',
    '................',
    '................',
    '................',
  ],
  bowl: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..oooooooooooo..',
    '..osssssssssso..',
    '..okcccccccbko..',
    '...okbbbbbbko...',
    '....okkkkkko....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  cookie: [
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '....oocbbboo....',
    '...ocbbabbbao...',
    '...obabbbbbao...',
    '...obbbbbabao...',
    '...obbabbbbao...',
    '....oabbbbao....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
    '................',
  ],
  slice: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '...o............',
    '...ogo..........',
    '...ogcoo........',
    '...ogcbbooo.....',
    '...ogcbabbbooo..',
    '...ogcbbbabbbo..',
    '...oggggggggo...',
    '...ooooooooo....',
    '................',
    '................',
    '................',
  ],
  egg: [
    '................',
    '................',
    '................',
    '......oooo......',
    '.....occcbo.....',
    '....occbbbbo....',
    '....ocbbbbbo....',
    '...ocbbbbbbao...',
    '...obbbbbbbao...',
    '...obbbbbbaao...',
    '....obbbbaao....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
    '................',
  ],
  compass: [
    '................',
    '................',
    '.....oooooo.....',
    '....occccbao....',
    '...ocbbbbbbao...',
    '...obbbrrbbao...',
    '...obbbrrbbao...',
    '...obbbwwbbao...',
    '...obbbwwbbao...',
    '...obbbbbbbao...',
    '....oaaaaaao....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
    '................',
  ],
  bow: [
    '................',
    '..........ookkk.',
    '........ookhHks.',
    '.......okhHk..s.',
    '......okhk...s..',
    '.....okHk...s...',
    '.....khk...s....',
    '....khk...s.....',
    '....khk..s......',
    '...khk..s.......',
    '...khk.s........',
    '..kHkss.........',
    '..kk.s..........',
    '..ks............',
    '..s.............',
    '................',
  ],
  arrow: [
    '................',
    '.............oo.',
    '............ocdo',
    '...........ocbo.',
    '..........khoo..',
    '.........khk....',
    '........khk.....',
    '.......khk......',
    '......khk.......',
    '.....khk........',
    '..f.khk.........',
    '..ffhk..........',
    '..fffff.........',
    '...ff...........',
    '................',
    '................',
  ],
  disc: [
    '................',
    '................',
    '.....oooooo.....',
    '....oaaaaaao....',
    '...oaaccaaaao...',
    '..oaacaaaaaaao..',
    '..oaaaabbaaaao..',
    '..oaaabddbaaao..',
    '..oaaabddbaaao..',
    '..oaaaabbaaaao..',
    '..oaaaaaaaaaao..',
    '...oaaaaaaaao...',
    '....oaaaaaao....',
    '.....oooooo.....',
    '................',
    '................',
  ],
  star: [
    '................',
    '.......oo.......',
    '.......oco......',
    '......ocdco.....',
    '.oooooocdcoooo..',
    '.ocddddddddddo..',
    '..occcdddcccoo..',
    '...oocdddcoo....',
    '....occdcco.....',
    '...occo.occo....',
    '...oco...oco....',
    '...oo.....oo....',
    '................',
    '................',
    '................',
    '................',
  ],
  totem: [
    '................',
    '......oooo......',
    '.....occcco.....',
    '.....ogcgco.....',
    '.....occcco.....',
    '....oooccooo....',
    '...occcbbccco...',
    '...ooccbbccoo...',
    '....occbbcco....',
    '....ocbbbbco....',
    '....obbaabbo....',
    '.....ob..bo.....',
    '.....oo..oo.....',
    '................',
    '................',
    '................',
  ],
  shield: [
    '................',
    '...oooooooooo...',
    '...ocbbbbbbao...',
    '...obkkkkkkao...',
    '...obkiiiikao...',
    '...obkiiiikao...',
    '...obkiiiikao...',
    '...obkiiiikao...',
    '...obkkkkkkao...',
    '....obbbbbao....',
    '.....obbbao.....',
    '......oaao......',
    '.......oo.......',
    '................',
    '................',
    '................',
  ],
  shears: [
    '................',
    '................',
    '..........oo....',
    '.........ocdo...',
    '........ocbo....',
    '.......ocbo.oo..',
    '......ocbooccbo.',
    '.....ocboocbbo..',
    '....ooooccbo....',
    '...orro.ooo.....',
    '..orrro.........',
    '..orro..........',
    '...oo...........',
    '................',
    '................',
    '................',
  ],
  flint_steel: [
    '................',
    '................',
    '...ooooo........',
    '..occcbao.......',
    '..obboobao......',
    '..obo..obo......',
    '..oo...obo......',
    '.......oao...oo.',
    '........o...offo',
    '...........offfo',
    '..........offfo.',
    '..........offo..',
    '...........oo...',
    '................',
    '................',
    '................',
  ],
  pearl: [
    '................',
    '................',
    '................',
    '......oooo......',
    '.....occcbo.....',
    '....ocdcbbbo....',
    '....occbbbao....',
    '....obbbeeao....',
    '....obbbeeao....',
    '....oabbbaao....',
    '.....oaaaao.....',
    '......oooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  end_crystal: [
    '................',
    '................',
    '...oooooooooo...',
    '...oc......co...',
    '...o.c....c.o...',
    '...o..okko..o...',
    '...o..keek..o...',
    '...o..keek..o...',
    '...o..okko..o...',
    '...o.c....c.o...',
    '...oc......co...',
    '...oooooooooo...',
    '................',
    '....aaaaaaaa....',
    '...abbbbbbbba...',
    '................',
  ],
  eye: [
    '................',
    '................',
    '................',
    '......oooo......',
    '.....occcbo.....',
    '....ocbbbbbo....',
    '....obbkkbbo....',
    '....obkeekbo....',
    '....obkeekbo....',
    '....obbkkbao....',
    '.....oaaaao.....',
    '......oooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  core: [
    '................',
    '................',
    '.......oo.......',
    '......ocdo......',
    '.....ocddbo.....',
    '....ocddcbbo....',
    '...ocdccbbbao...',
    '...obccbbbbao...',
    '....obbbbbao....',
    '.....obbbao.....',
    '......obao......',
    '.......oo.......',
    '................',
    '................',
    '................',
    '................',
  ],
  leather: [
    '................',
    '................',
    '................',
    '....oo....oo....',
    '...ocbo..ocbo...',
    '...obbbooobbo...',
    '....obbbbbbo....',
    '....obbbbbbao...',
    '...obbbbbbbao...',
    '...obbbbbbaao...',
    '....obbaabao....',
    '....oooooooo....',
    '................',
    '................',
    '................',
    '................',
  ],
  membrane: [
    '................',
    '................',
    '...o.......o....',
    '...oco...ocdo...',
    '....occoocbbo...',
    '....ocbbbbbbo...',
    '...ocbbbbbbao...',
    '...obbbbbbao....',
    '....obbbbaao....',
    '....oobbaoo.....',
    '......oao.......',
    '.......o........',
    '................',
    '................',
    '................',
    '................',
  ],
  tag: [
    '................',
    '................',
    '..........ooo...',
    '.........occbo..',
    '........occbo...',
    '.......occbo.o..',
    '......occbo.....',
    '.....occbo......',
    '....ocbbo.......',
    '...ocbbo........',
    '...obko.........',
    '...oko..........',
    '....o...........',
    '................',
    '................',
    '................',
  ],
  saddle: [
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '...ocbbbbbbao...',
    '..ocbbbbbbbbao..',
    '..obbboooobbao..',
    '..oboo....ooao..',
    '..ogo......ogo..',
    '..ogo......ogo..',
    '..ooo......ooo..',
    '................',
    '................',
    '................',
    '................',
  ],
  rocket: [
    '................',
    '..........oo....',
    '.........occo...',
    '........occbo...',
    '.......ocbbo....',
    '......ocrbo.....',
    '.....ocrbo......',
    '....ocbbo.......',
    '....obbo........',
    '...oboo.........',
    '..ohk...........',
    '..hk............',
    '.hk.............',
    '.k..............',
    '................',
    '................',
  ],
  wings: [
    '................',
    '.oooo......oooo.',
    'occbbo....occbbo',
    'ocbbbbo..ocbbbao',
    'obbbbbao.obbbbao',
    'obbbbbao.obbbaao',
    'obbbbaao.obbbaao',
    'obbbbao..obbbao.',
    'obbbaao..obbaao.',
    'obbbao...obbao..',
    '.obbao...obao...',
    '.obao....oao....',
    '..oo.....oo.....',
    '................',
    '................',
    '................',
  ],
  trident: [
    '................',
    '..........o.o.o.',
    '..........oco.co',
    '...........occo.',
    '..........ocbo..',
    '.........ocbo...',
    '........ocbo....',
    '.......ocbo.....',
    '......ocbo......',
    '.....ocbo.......',
    '....ocbo........',
    '...ocbo.........',
    '..ocbo..........',
    '..obo...........',
    '...o............',
    '................',
  ],
  scale: [
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....ocdccbbo....',
    '...ocdcbbbbao...',
    '...occbbbbbao...',
    '...obbbbbbaao...',
    '....obbbbaao....',
    '.....obbaao.....',
    '......oaao......',
    '.......oo.......',
    '................',
    '................',
    '................',
    '................',
  ],
  pepper: [
    '................',
    '..........gg....',
    '.........gGg....',
    '........oooo....',
    '.......ocdbo....',
    '......occbbo....',
    '.....occbbao....',
    '....occbbao.....',
    '...ocbbbao......',
    '..ocbbaao.......',
    '..obbaao........',
    '...oaoo.........',
    '....o...........',
    '................',
    '................',
    '................',
  ],
  honeycomb: [
    '................',
    '................',
    '....oo...oo.....',
    '...ocbo.ocbo....',
    '...obbo.obbo....',
    '..oo.oo.oo.oo...',
    '..ocbo.ocbo.o...',
    '..obbo.obbo.....',
    '...oo...oo......',
    '....ocbo.ocbo...',
    '....obbo.obbo...',
    '.....oo...oo....',
    '................',
    '................',
    '................',
    '................',
  ],
  dye: [
    '................',
    '................',
    '................',
    '................',
    '.......oo.......',
    '......ocbo......',
    '.....ocbbbo.....',
    '....ocbbbbbo....',
    '....obbbbbbo....',
    '....obbbbbao....',
    '.....oaaaao.....',
    '......oooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  torch: [
    '................',
    '................',
    '.......yy.......',
    '.......yYy......',
    '......yYYy......',
    '.......ff.......',
    '.......hH.......',
    '.......hH.......',
    '.......hH.......',
    '.......hH.......',
    '.......hH.......',
    '.......hH.......',
    '.......hH.......',
    '.......hH.......',
    '................',
    '................',
  ],
  sign: [
    '................',
    '..oooooooooooo..',
    '..obbbbbbbbbbo..',
    '..obccccccccbo..',
    '..obbbbbbbbbbo..',
    '..obccccccccbo..',
    '..obbbbbbbbbbo..',
    '..oooooooooooo..',
    '.......kk.......',
    '.......kk.......',
    '.......kk.......',
    '.......kk.......',
    '.......kk.......',
    '................',
    '................',
    '................',
  ],
  spyglass: [
    '................',
    '............oo..',
    '...........ocbo.',
    '..........ocbbo.',
    '.........oabbo..',
    '........oaaoo...',
    '.......ocbo.....',
    '......ocbo......',
    '.....ocbo.......',
    '....ocbo........',
    '...ocbo.........',
    '..ocbo..........',
    '..ooo...........',
    '................',
    '................',
    '................',
  ],
  clock: [
    '................',
    '................',
    '.....oooooo.....',
    '....occccbao....',
    '...ocbbbbbbao...',
    '...ob.....bao...',
    '...ob..w..bao...',
    '...ob..ww.bao...',
    '...ob.....bao...',
    '...obbbbbbbao...',
    '....oaaaaaao....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
    '................',
  ],
  fang: [
    '................',
    '................',
    '....oooooo......',
    '....occccbo.....',
    '.....occbbo.....',
    '......ocbbo.....',
    '......ocbbo.....',
    '.......ocbo.....',
    '.......ocbo.....',
    '........oco.....',
    '........obo.....',
    '.........o......',
    '................',
    '................',
    '................',
    '................',
  ],
  wart: [
    '................',
    '................',
    '................',
    '........oo......',
    '.......ocbo.....',
    '.....ooobbo.....',
    '....ocbooao.....',
    '....obbo.oo.....',
    '.....oo.ocbo....',
    '....ocbooboo....',
    '....obbo.oo.....',
    '.....oo.........',
    '................',
    '................',
    '................',
    '................',
  ],
  cane: [
    '................',
    '.........g......',
    '........gg......',
    '.......g.b......',
    '.........b.g....',
    '.........bgg....',
    '.....g...b......',
    '....gg...a......',
    '......b..b......',
    '......b..b......',
    '......a..b......',
    '......b..a......',
    '......b..b......',
    '......b..b......',
    '................',
    '................',
  ],
};

export function paintMask(t: Tex, name: keyof typeof M, pal: Pal): void {
  t.clear();
  t.mask(M[name]!, { ...HANDLE, ...pal });
}

const TOOL_MATS: Record<string, RGB> = {
  wooden: hex(0x9c7a44),
  stone: hex(0x8a8a8a),
  iron: hex(0xd8d8d8),
  golden: hex(0xf5d33a),
  diamond: hex(0x4fe3d6),
  netherite: hex(0x4a3f42),
  glitched: hex(0xc050ff),
  ender_alloy: hex(0x2a8a7a),
};
const ARMOR_MATS: Record<string, RGB> = {
  leather: hex(0x8f5a32),
  chainmail: hex(0xa8a8a8),
  iron: hex(0xd8d8d8),
  golden: hex(0xf5d33a),
  diamond: hex(0x4fe3d6),
  netherite: hex(0x4a3f42),
  glitched: hex(0xc050ff),
  ender_alloy: hex(0x2a8a7a),
};

/** V6: Ender Alloy's violet sheen over teal. */
function enderify(t: Tex): void {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const c = t.get(x, y);
      // On the teal metal only (not on wooden handles)
      if (t.alpha(x, y) && (x * 3 + y) % 9 === 0 && c[1] > c[0] + 30 && c[1] > 90) t.set(x, y, hex(0x9a6af0));
    }
}

function glitchify(t: Tex): void {
  // magenta/cyan pixel sparkle for glitched items
  for (let i = 0; i < 6; i++) {
    const x = t.rng.int(16);
    const y = t.rng.int(16);
    if (t.alpha(x, y) && t.rng.bool()) t.set(x, y, t.rng.bool() ? hex(0x00ffff) : hex(0xff40ff));
  }
}

export function registerItems(r: PainterRegistry): void {
  for (const [mat, base] of Object.entries(TOOL_MATS)) {
    for (const tool of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'] as const) {
      r.add(`${mat}_${tool}`, (t) => {
        paintMask(t, tool, matPal(base, mat === 'netherite' || mat === 'ender_alloy' ? 0.55 : 0.42));
        if (mat === 'glitched') glitchify(t);
        if (mat === 'ender_alloy') enderify(t);
      });
    }
  }
  for (const [mat, base] of Object.entries(ARMOR_MATS)) {
    for (const piece of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
      r.add(`${mat}_${piece}`, (t) => {
        paintMask(t, piece, matPal(base));
        if (mat === 'chainmail') for (let y = 0; y < 16; y += 2) for (let x = y % 4 === 0 ? 0 : 1; x < 16; x += 2) if (t.alpha(x, y) && t.get(x, y)[0] > 100) t.set(x, y, hex(0x606060));
        if (mat === 'glitched') glitchify(t);
        if (mat === 'ender_alloy') enderify(t);
      });
    }
  }
  r.add('turtle_helmet', (t) => paintMask(t, 'helmet', matPal(hex(0x3a9a3a))));
  r.add('elytra', (t) => paintMask(t, 'wings', matPal(hex(0x8a8aa8))));

  // Materials
  const ingot = (n: string, c: number) => r.add(n, (t) => paintMask(t, 'ingot', matPal(hex(c))));
  ingot('iron_ingot', 0xd8d8d8);
  ingot('gold_ingot', 0xf5d33a);
  ingot('copper_ingot', 0xd8784a);
  ingot('netherite_ingot', 0x4a3f42);
  ingot('brick', 0xa0522d);
  ingot('nether_brick', 0x4e2428);
  ingot('nullium_ingot', 0x28303a);
  r.add('glitched_ingot', (t) => {
    paintMask(t, 'ingot', matPal(hex(0xc050ff)));
    glitchify(t);
  });
  const nug = (n: string, c: number) => r.add(n, (t) => paintMask(t, 'nugget', matPal(hex(c))));
  nug('iron_nugget', 0xd8d8d8);
  nug('gold_nugget', 0xf5d33a);
  r.add('diamond', (t) => paintMask(t, 'gem', matPal(hex(0x4fe3d6))));
  r.add('emerald', (t) => paintMask(t, 'emerald', matPal(hex(0x17c544))));
  r.add('lapis_lazuli', (t) => paintMask(t, 'lump', matPal(hex(0x2552c6))));
  r.add('quartz', (t) => paintMask(t, 'gem', matPal(hex(0xeae4dc))));
  r.add('amethyst_shard', (t) => paintMask(t, 'shard', matPal(hex(0xa070e8))));
  r.add('lumen_shard', (t) => paintMask(t, 'shard', matPal(hex(0x6ae8f0))));
  r.add('echo_shard', (t) => paintMask(t, 'shard', matPal(hex(0x0f6a7a))));
  r.add('prismarine_shard', (t) => paintMask(t, 'shard', matPal(hex(0x5aa090))));
  r.add('prismarine_crystals', (t) => paintMask(t, 'gem', matPal(hex(0xb8e8d8))));
  r.add('void_shard', (t) => paintMask(t, 'shard', matPal(hex(0x6a3ad0))));
  r.add('sunstone_shard', (t) => paintMask(t, 'shard', matPal(hex(0xffb13a))));
  r.add('glitch_shard', (t) => {
    paintMask(t, 'shard', matPal(hex(0xff40ff)));
    glitchify(t);
  });
  r.add('netherite_scrap', (t) => paintMask(t, 'raw', matPal(hex(0x5a4a44))));
  r.add('raw_iron', (t) => paintMask(t, 'raw', matPal(hex(0xd8af93))));
  r.add('raw_gold', (t) => paintMask(t, 'raw', matPal(hex(0xf5c53b))));
  r.add('raw_copper', (t) => paintMask(t, 'raw', matPal(hex(0xd8784a))));
  r.add('raw_nullium', (t) => paintMask(t, 'raw', matPal(hex(0x2a2e3a))));
  r.add('coal', (t) => paintMask(t, 'lump', matPal(hex(0x2a2a2a), 0.4)));
  r.add('charcoal', (t) => paintMask(t, 'lump', matPal(hex(0x3a3024), 0.4)));
  r.add('flint', (t) => paintMask(t, 'shard', matPal(hex(0x4a4a4a))));
  r.add('clay_ball', (t) => paintMask(t, 'ball', matPal(hex(0xa4aab6))));
  r.add('slime_ball', (t) => paintMask(t, 'ball', matPal(hex(0x72c050))));
  r.add('snowball', (t) => paintMask(t, 'ball', matPal(hex(0xf0f8f8))));
  r.add('magma_cream', (t) => paintMask(t, 'ball', matPal(hex(0xd0561a))));
  r.add('heart_of_the_sea', (t) => paintMask(t, 'core', matPal(hex(0x2a8ad8))));
  r.add('ember_core', (t) => paintMask(t, 'core', matPal(hex(0xff6a1a))));
  r.add('glitch_core', (t) => {
    paintMask(t, 'core', matPal(hex(0xd040ff)));
    glitchify(t);
  });
  r.add('data_fragment', (t) => {
    paintMask(t, 'shard', matPal(hex(0x20e060)));
    for (let y = 3; y < 13; y += 2) for (let x = 4; x < 12; x++) if (t.alpha(x, y) && t.rng.bool()) t.set(x, y, hex(0xd0ffd0));
  });
  r.add('cinder', (t) => paintMask(t, 'lump', matPal(hex(0xb8481a))));
  r.add('redstone', (t) => paintMask(t, 'dust', matPal(hex(0xd41a0a))));
  r.add('glowstone_dust', (t) => paintMask(t, 'dust', matPal(hex(0xf0c060))));
  r.add('gunpowder', (t) => paintMask(t, 'dust', matPal(hex(0x5a5a5a))));
  r.add('sugar', (t) => paintMask(t, 'dust', matPal(hex(0xf4f4f4))));
  r.add('blaze_powder', (t) => paintMask(t, 'dust', matPal(hex(0xf0a020))));
  r.add('bone_meal', (t) => paintMask(t, 'dust', matPal(hex(0xe8e8d8))));
  r.add('stick', (t) => paintMask(t, 'stick', {}));
  r.add('blaze_rod', (t) => paintMask(t, 'rod', matPal(hex(0xf0b030))));
  r.add('bone', (t) => paintMask(t, 'bone', matPal(hex(0xe4e0cc))));
  r.add('feather', (t) => paintMask(t, 'feather', matPal(hex(0xf0f0f0))));
  r.add('string', (t) => paintMask(t, 'string', matPal(hex(0xf0f0f0))));
  r.add('paper', (t) => paintMask(t, 'sheet', matPal(hex(0xf0ece0), 0.7)));
  r.add('book', (t) => paintMask(t, 'book', { ...matPal(hex(0x7a4a24)), d: hex(0xf0ece0) }));
  r.add('enchanted_book', (t) => paintMask(t, 'book', { ...matPal(hex(0x6a2a8a)), d: hex(0xf0ece0) }));
  r.add('leather', (t) => paintMask(t, 'leather', matPal(hex(0x9a5a2a))));
  r.add('rabbit_hide', (t) => paintMask(t, 'leather', matPal(hex(0xb89060))));
  r.add('phantom_membrane', (t) => paintMask(t, 'membrane', matPal(hex(0xc8c0a8))));
  r.add('sky_ray_membrane', (t) => paintMask(t, 'membrane', matPal(hex(0x6ab0f0))));
  r.add('dragon_scale', (t) => paintMask(t, 'scale', matPal(hex(0x3a2a4a))));
  r.add('scute', (t) => paintMask(t, 'scale', matPal(hex(0x4aa84a))));
  r.add('shulker_shell', (t) => paintMask(t, 'scale', matPal(hex(0x9a6aa0))));
  r.add('nautilus_shell', (t) => paintMask(t, 'ball', matPal(hex(0xe8d8c8))));
  r.add('honeycomb', (t) => paintMask(t, 'honeycomb', matPal(hex(0xf0a820))));
  r.add('candle', (t) => {
    t.clear();
    for (let y = 5; y < 15; y++) for (let x = 6; x < 10; x++) t.set(x, y, x === 6 ? hex(0xf8f0d8) : x === 9 ? hex(0xc8b890) : hex(0xe8dcb8));
    t.set(7, 4, hex(0x2a2a2a));
    t.set(7, 3, hex(0x3a3a3a));
    for (let x = 6; x < 10; x++) t.set(x, 15, hex(0xb8a880));
  });
  r.add('conduit', (t) => {
    t.clear();
    const cage = hex(0x6a4a2a);
    const dark = hex(0x3a2818);
    for (let y = 2; y < 14; y++)
      for (let x = 2; x < 14; x++) {
        const edge = x === 2 || x === 13 || y === 2 || y === 13;
        const bar = (x + y) % 4 === 0;
        if (edge || bar) t.set(x, y, edge ? dark : cage);
      }
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, hex(0x2a8ad8));
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) t.set(x, y, hex(0x8ae0ff));
    t.set(7, 7, hex(0x0a1a2a));
    t.set(8, 8, hex(0x0a1a2a));
  });
  r.add('ghast_tear', (t) => paintMask(t, 'shard', matPal(hex(0xd8f0f0))));
  r.add('nether_star', (t) => paintMask(t, 'star', matPal(hex(0xf0f0e8))));
  r.add('ink_sac', (t) => paintMask(t, 'dye', matPal(hex(0x2a2a3a))));
  r.add('glow_ink_sac', (t) => paintMask(t, 'dye', matPal(hex(0x3ad8c8))));
  r.add('rabbit_foot', (t) => paintMask(t, 'fang', matPal(hex(0xc8a070))));
  r.add('stalker_fang', (t) => paintMask(t, 'fang', matPal(hex(0xe8e4d8))));
  r.add('spider_eye', (t) => paintMask(t, 'eye', { ...matPal(hex(0x9a2a3a)), e: hex(0xd83040), k: hex(0x3a0a10) }));
  r.add('fermented_spider_eye', (t) => paintMask(t, 'eye', { ...matPal(hex(0x7a3a4a)), e: hex(0xa05060), k: hex(0x3a1a20) }));
  r.add('corrupted_eye', (t) => {
    paintMask(t, 'eye', { ...matPal(hex(0x3a1a5a)), e: hex(0xff40ff), k: hex(0x000000) });
    glitchify(t);
  });
  r.add('ender_pearl', (t) => paintMask(t, 'pearl', { ...matPal(hex(0x1a6a5a)), e: hex(0x0a2a2a) }));
  r.add('ender_eye', (t) => paintMask(t, 'eye', { ...matPal(hex(0x2a8a6a)), e: hex(0x0a1a1a), k: hex(0x6ae8a8) }));
  r.add('end_crystal', (t) => paintMask(t, 'end_crystal', { o: hex(0xb8b8d8), c: hex(0xf0f0ff), k: hex(0xc050c8), e: hex(0xffb8ff), a: hex(0x1a1020), b: hex(0x3a2a4a) }));
  r.add('rift_pearl', (t) => {
    paintMask(t, 'pearl', { ...matPal(hex(0x8a2ad0)), e: hex(0xff60ff) });
    glitchify(t);
  });
  r.add('dragon_breath', (t) => paintMask(t, 'bottle', { o: hex(0x6a6a7a), c: hex(0xa8a8b8), d: hex(0xd070e0) }));
  r.add('experience_bottle', (t) => paintMask(t, 'bottle', { o: hex(0x6a6a7a), c: hex(0xa8a8b8), d: hex(0x8ae84a) }));
  r.add('glass_bottle', (t) => paintMask(t, 'bottle', { o: hex(0x8a9aa8), c: hex(0xc8d8e0), d: hex(0xe8f4f8) }));
  r.add('honey_bottle', (t) => paintMask(t, 'bottle', { o: hex(0x8a6a2a), c: hex(0xc8a060), d: hex(0xf0b030) }));
  r.add('potion', (t) => paintMask(t, 'bottle', { o: hex(0x6a6a7a), c: hex(0xa8a8b8), d: hex(0x3a5ad8) }));
  // Almost black, with violet swirls and one bright point that seems to look back
  r.add('mysterious_potion', (t) => {
    paintMask(t, 'bottle', { o: hex(0x4a3a5a), c: hex(0x8a7aa8), d: hex(0x160820) });
    const liquid: [number, number][] = [];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const c = t.get(x, y);
        if (c[3] > 0 && c[0] < 0x30 && c[2] < 0x40) liquid.push([x, y]);
      }
    for (const [x, y] of liquid) {
      const h = (x * 7 + y * 13 + x * y) % 11;
      if (h === 0) t.set(x, y, hex(0x7a2ad0));
      else if (h === 5) t.set(x, y, hex(0x3a1060));
    }
    // The point of light: the liquid pixel nearest the middle of the bottle
    let best = liquid[0];
    for (const p of liquid) if ((p[0] - 8) ** 2 + (p[1] - 11) ** 2 < (best![0] - 8) ** 2 + (best![1] - 11) ** 2) best = p;
    if (best) {
      t.set(best[0], best[1], hex(0xffc8ff));
      if (best[0] + 1 < 16 && liquid.some((q) => q[0] === best![0] + 1 && q[1] === best![1])) t.set(best[0] + 1, best[1], hex(0xff50d8));
    }
  });
  r.add('splash_potion', (t) => {
    paintMask(t, 'bottle', { o: hex(0x6a6a7a), c: hex(0xa8a8b8), d: hex(0xd83a5a) });
    t.set(7, 0, hex(0xa8a8b8));
    t.set(8, 0, hex(0xa8a8b8));
  });
  for (const [c, v] of Object.entries(DYE)) r.add(c + '_dye', (t) => paintMask(t, 'dye', matPal(hex(v))));
  const bucket = (n: string, fill: RGB | null) =>
    r.add(n, (t) => {
      paintMask(t, 'bucket', matPal(hex(0xc8c8c8)));
      if (fill) for (let x = 3; x < 13; x++) t.set(x, 4, fill), t.set(x, 5, shade(fill, 1.2));
    });
  bucket('bucket', null);
  bucket('water_bucket', hex(0x3a6ae0));
  bucket('lava_bucket', hex(0xf08020));
  bucket('milk_bucket', hex(0xf8f8f8));
  r.add('compass', (t) => paintMask(t, 'compass', { ...matPal(hex(0x8a8a8a)), r: hex(0xd02020), w: hex(0xf0f0f0) }));
  r.add('farlands_compass', (t) => {
    paintMask(t, 'compass', { ...matPal(hex(0x5a2a7a)), r: hex(0xff40ff), w: hex(0x00ffff) });
    glitchify(t);
  });
  r.add('recovery_compass', (t) => paintMask(t, 'compass', { ...matPal(hex(0x1f4a52)), r: hex(0x3ae0d0), w: hex(0x0a1418) }));
  r.add('clock', (t) => paintMask(t, 'clock', { ...matPal(hex(0xf0c040)), w: hex(0x2a2a2a) }));
  r.add('spyglass', (t) => paintMask(t, 'spyglass', matPal(hex(0xc87a4a))));
  r.add('bow', (t) => paintMask(t, 'bow', { s: hex(0xe0e0e0) }));
  r.add('crossbow', (t) => {
    paintMask(t, 'bow', { s: hex(0xe0e0e0) });
    for (let i = 4; i < 13; i++) t.set(i, 16 - i, hex(0x6a6a6a));
  });
  r.add('arrow', (t) => paintMask(t, 'arrow', { ...matPal(hex(0x9a9a9a)), f: hex(0xf0f0f0) }));
  r.add('spectral_arrow', (t) => paintMask(t, 'arrow', { ...matPal(hex(0xf0d040)), f: hex(0xf8e880) }));
  r.add('shield', (t) => paintMask(t, 'shield', { ...matPal(hex(0x8a6a3a)), k: hex(0x6a6a6a), i: hex(0x9a7a4a) }));
  r.add('trident', (t) => paintMask(t, 'trident', matPal(hex(0x5aa8a0))));
  r.add('totem_of_undying', (t) => paintMask(t, 'totem', { ...matPal(hex(0xf0c040)), g: hex(0x20a060) }));
  r.add('flint_and_steel', (t) => paintMask(t, 'flint_steel', { ...matPal(hex(0xa8a8a8)), f: hex(0x3a3a3a) }));
  r.add('fire_charge', (t) => {
    paintMask(t, 'ball', matPal(hex(0x3a2a1a)));
    for (let i = 0; i < 8; i++) t.set(5 + t.rng.int(6), 5 + t.rng.int(6), t.rng.bool() ? hex(0xff8a1a) : hex(0xffd040));
  });
  r.add('shears', (t) => paintMask(t, 'shears', { ...matPal(hex(0xd8d8d8)), r: hex(0x8a3a2a) }));
  r.add('fishing_rod', (t) => {
    paintMask(t, 'stick', {});
    for (let y = 4; y < 14; y++) t.set(13, y, hex(0xe0e0e0));
    t.set(13, 14, hex(0x6a6a6a));
  });
  r.add('carrot_on_a_stick', (t) => {
    paintMask(t, 'stick', {});
    for (let y = 4; y < 11; y++) t.set(13, y, hex(0xe0e0e0));
    // A carrot dangling from the line
    t.rect(12, 11, 3, 3, hex(0xf08a1a));
    t.set(13, 14, hex(0xc86a10));
    t.set(12, 10, hex(0x4a9a2a));
    t.set(14, 10, hex(0x4a9a2a));
  });
  r.add('name_tag', (t) => paintMask(t, 'tag', { ...matPal(hex(0xe8dcc0)), k: hex(0x6a6a6a) }));
  r.add('saddle', (t) => paintMask(t, 'saddle', { ...matPal(hex(0x8a4a24)), g: hex(0xa8a8a8) }));
  r.add('lead', (t) => paintMask(t, 'string', matPal(hex(0xc8a070))));
  r.add('firework_rocket', (t) => paintMask(t, 'rocket', { ...matPal(hex(0xd0d0d0)), r: hex(0xd02020) }));
  const disc = (n: string, c: number) => r.add(n, (t) => paintMask(t, 'disc', { ...matPal(hex(0x2a2a2a)), a: hex(0x1a1a1a), b: hex(c), d: hex(0xf0f0f0), c: hex(0x3a3a3a) }));
  disc('music_disc_meadow', 0x4ac050);
  disc('music_disc_deepcave', 0x2a6ad0);
  disc('music_disc_overflow', 0xd040ff);
  disc('music_disc_ember', 0xf06a20);
  disc('music_disc_drift', 0xc8b0f0);
  disc('music_disc_skyward', 0x7ad0ff);
  disc('music_disc_echo', 0x1ab0b8);
  disc('music_disc_hollow', 0x0a3a4a);
  r.add('disc_fragment', (t) => {
    // A broken wedge of a dark record
    t.clear();
    for (let y = 3; y < 14; y++)
      for (let x = 3; x < 14; x++) {
        const dx = x - 3;
        const dy = y - 3;
        if (dx + dy > 13 || Math.hypot(dx, dy) > 10.5) continue;
        const ring = Math.round(Math.hypot(dx, dy)) % 3 === 0;
        t.set(x, y, ring ? hex(0x2a2a30) : hex(0x16161c));
      }
    t.set(4, 4, hex(0x1ab0b8));
    t.set(5, 4, hex(0x1ab0b8));
    t.set(4, 5, hex(0x1ab0b8));
  });
  r.add('resonance_charm', (t) => {
    // Original: a teal crystal in a bone setting on a cord; it soaks up sound
    t.clear();
    for (let x = 4; x < 12; x++) t.set(x, 1 + Math.round(Math.abs(x - 7.5) / 2), hex(0x5a4a3a));
    const bone = hex(0xd8d0b8);
    for (let y = 5; y < 15; y++)
      for (let x = 4; x < 12; x++) {
        const d = Math.abs(x - 7.5) + Math.abs(y - 9.5);
        if (d > 5.5) continue;
        t.set(x, y, d > 4.2 ? bone : d > 2.5 ? hex(0x1ab0b8) : d > 1 ? hex(0x6af0f0) : hex(0xe0ffff));
      }
  });
  r.add('bowl', (t) => paintMask(t, 'bowl', { o: hex(0x3a2a14), s: hex(0x5a4222), k: hex(0x6a4a24), c: hex(0x9a7a44), b: hex(0x7a5a34) }));
  const stew = (n: string, c: RGB) => r.add(n, (t) => paintMask(t, 'bowl', { o: hex(0x3a2a14), s: c, k: hex(0x6a4a24), c: hex(0x9a7a44), b: hex(0x7a5a34) }));
  stew('mushroom_stew', hex(0xc8a070));
  stew('beetroot_soup', hex(0xb02a3a));
  stew('rabbit_stew', hex(0xa87a3a));

  // Food
  const fruit = (n: string, c: number, mask: keyof typeof M = 'apple', extra: Pal = {}) => r.add(n, (t) => paintMask(t, mask, { ...matPal(hex(c)), g: hex(0x3a9a2a), G: hex(0x2a7a1a), ...extra }));
  fruit('apple', 0xd02a2a);
  fruit('golden_apple', 0xf5d33a);
  r.add('enchanted_golden_apple', (t) => paintMask(t, 'apple', { ...matPal(hex(0xf5d33a)), g: hex(0x3a9a2a), G: hex(0x2a7a1a), d: hex(0xffffff) }));
  fruit('glitch_berry', 0xd040ff, 'berries');
  fruit('sweet_berries', 0xc01a2a, 'berries');
  fruit('glow_berries', 0xffb02a, 'berries');
  fruit('carrot', 0xf08a1a, 'carrot');
  fruit('golden_carrot', 0xf5d33a, 'carrot');
  fruit('ember_pepper', 0xe0401a, 'pepper');
  fruit('sunroot', 0xffc02a, 'carrot', { g: hex(0x6a9a2a), G: hex(0x4a7a1a) });
  fruit('roasted_sunroot', 0xc88a2a, 'carrot', { g: hex(0x4a6a1a), G: hex(0x3a5a1a) });
  fruit('beetroot', 0xa8203a, 'carrot', { g: hex(0x3a8a2a) });
  r.add('bread', (t) => paintMask(t, 'bread', matPal(hex(0xc89040))));
  r.add('cookie', (t) => paintMask(t, 'cookie', matPal(hex(0xc88a4a))));
  r.add('pumpkin_pie', (t) => paintMask(t, 'bread', matPal(hex(0xd08a3a))));
  r.add('potato', (t) => paintMask(t, 'potato', matPal(hex(0xd8b060))));
  r.add('baked_potato', (t) => paintMask(t, 'potato', matPal(hex(0xc88a3a))));
  r.add('poisonous_potato', (t) => paintMask(t, 'potato', matPal(hex(0xa8b050))));
  r.add('melon_slice', (t) => paintMask(t, 'slice', { ...matPal(hex(0xe03a3a)), g: hex(0x4a9a2a), a: hex(0x2a2a2a) }));
  r.add('glistering_melon_slice', (t) => paintMask(t, 'slice', { ...matPal(hex(0xf0d040)), g: hex(0xd0a020), a: hex(0xffffff) }));
  r.add('dried_kelp', (t) => paintMask(t, 'leather', matPal(hex(0x3a5a2a))));
  r.add('chorus_fruit', (t) => paintMask(t, 'ball', matPal(hex(0x8a5a9a))));
  r.add('egg', (t) => paintMask(t, 'egg', matPal(hex(0xe8dcc0))));
  // Spawn eggs: the egg silhouette in each mob's colours with seeded spots
  for (const m of MOB_DEFS) {
    if (m.id === 'ender_dragon') continue;
    r.add('spawn_egg_' + m.id, (t) => {
      paintMask(t, 'egg', matPal(hex(m.egg[0])));
      const spot = hex(m.egg[1]);
      for (let y = 3; y < 15; y++)
        for (let x = 3; x < 13; x++) {
          const c = t.get(x, y);
          if (c[3] === 0) continue;
          const edge = t.get(x - 1, y)[3] === 0 || t.get(x + 1, y)[3] === 0 || t.get(x, y - 1)[3] === 0 || t.get(x, y + 1)[3] === 0;
          if (edge) continue;
          if (hashInts(m.egg[1], x, y, m.id.length) % 5 === 0) t.set(x, y, spot);
        }
    });
  }
  const meat = (n: string, c: number) => r.add(n, (t) => paintMask(t, 'meat', { ...matPal(hex(c)), d: hex(0xf0ece0) }));
  meat('beef', 0xc83a3a);
  meat('cooked_beef', 0x8a4a2a);
  meat('porkchop', 0xf09a9a);
  meat('cooked_porkchop', 0xc88a5a);
  meat('mutton', 0xd84a4a);
  meat('cooked_mutton', 0x9a5a3a);
  meat('chicken', 0xf0c8b0);
  meat('cooked_chicken', 0xc88a4a);
  meat('rabbit', 0xe8a8a0);
  meat('cooked_rabbit', 0xb8804a);
  meat('rotten_flesh', 0x8a6a3a);
  meat('stalker_steak', 0x5a3a6a);
  const fish = (n: string, c: number) => r.add(n, (t) => paintMask(t, 'fish', { ...matPal(hex(c)), d: hex(0x1a1a1a) }));
  fish('cod', 0xb8a080);
  fish('cooked_cod', 0x9a7a4a);
  fish('salmon', 0xc85a4a);
  fish('cooked_salmon', 0xa85a3a);
  fish('tropical_fish', 0xf08a2a);
  fish('pufferfish', 0xe8d040);
  const seeds = (n: string, c: number) => r.add(n, (t) => paintMask(t, 'seeds', matPal(hex(c))));
  seeds('wheat_seeds', 0x5a9a2a);
  seeds('beetroot_seeds', 0xa87a4a);
  seeds('pumpkin_seeds', 0xe8d8a0);
  seeds('melon_seeds', 0x2a2a2a);
  seeds('sunroot_seeds', 0xffc02a);
  r.add('wheat', (t) => paintMask(t, 'cane', { g: hex(0xd8b04a), a: hex(0x9a7a2a), b: hex(0xc8a03a) }));
  r.add('sugar_cane', (t) => paintMask(t, 'cane', { g: hex(0x5ab03a), a: hex(0x6a9a3a), b: hex(0x8ac850) }));
  r.add('kelp', (t) => paintMask(t, 'cane', { g: hex(0x3a8a2a), a: hex(0x2a6a1a), b: hex(0x4a9a2a) }));
  r.add('nether_wart', (t) => paintMask(t, 'wart', matPal(hex(0xa01a2a))));
  r.add('torch', (t) => paintMask(t, 'torch', { y: hex(0xffd040), Y: hex(0xfff0a0), f: hex(0xffa020) }));
  r.add('soul_torch', (t) => paintMask(t, 'torch', { y: hex(0x40d8e8), Y: hex(0xd0ffff), f: hex(0x2ab0c8) }));
  r.add('sign', (t) => paintMask(t, 'sign', { ...matPal(hex(0xa2824e)), k: hex(0x6a5030) }));
  void mix;
}
