/**
 * V6 phase 3: the made-up script of the ancient End. Six glyphs, each 8 x 8
 * ('#' cut into the stone, 'o' glowing). Ender Glyph Stone shows one per
 * face (tools/textures/v6.ts); reading a stone shows a seeded run of them
 * (src/client/ui/LorePage.ts). They mean nothing: nobody can read them.
 */
export const GLYPHS: string[][] = [
  ['.#......', '.#.###..', '.##...#.', '.#.###..', '.#..#...', '.#...#..', '.#....#.', '.#.....#'],
  ['..####..', '.#....#.', '#..oo..#', '#..oo..#', '.#....#.', '..####..', '....#...', '...##...'],
  ['########', '......#.', '..o..#..', '....#...', '...#..o.', '..#.....', '.#......', '########'],
  ['#..#..#.', '#..#..#.', '.#.#.#..', '..###...', '...#....', '...#....', '..o#o...', '...#....'],
  ['...#....', '..#.#...', '.#...#..', '#.....#.', '#######.', '........', '.######.', '...o....'],
  ['.###....', '#...#...', '....#...', '...#....', '..#.....', '........', 'o..o..o.', '.o....o.'],
];

/**
 * V6 phase 5: two more for the Void Citadel's Glyph Locks (eight in all: the
 * six above, then these). The phase 3 stones and lore pages keep their six.
 */
export const CITADEL_GLYPHS: string[][] = [
  ...GLYPHS,
  ['#......#', '.#....#.', '..#..#..', '...oo...', '...oo...', '..#..#..', '.#....#.', '#......#'],
  ['..#..#..', '..#..#..', '########', '..#..#..', '..#..#..', '########', '..#..#..', '..o..o..'],
];
