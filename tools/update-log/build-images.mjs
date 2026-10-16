/**
 * Makes the Update Log's pictures (public/updatelog/<version>/*.webp) from
 * game screenshots:
 *
 *   UPDATE_LOG_SHOTS=1 node tests/e2e/v6.mjs           V6, the End Expansion (clean copies in tests/e2e/out/clean)
 *   node tools/update-log/capture-online.mjs            V6.5, browser multiplayer
 *   UPDATE_LOG_SHOTS=1 node tests/e2e/haunting.mjs      V6.5, the Haunting
 *   node tests/e2e/auto-optimize.mjs                    V6.5, Auto Optimize
 *   UPDATE_LOG_SHOTS=1 node tests/e2e/halloween.mjs     V7, the Halloween Update
 *   UPDATE_LOG_SHOTS=1 node tests/e2e/villages.mjs      V7 phase 2: the villages and the heads
 *   UPDATE_LOG_SHOTS=1 node tests/e2e/trick-or-treat.mjs V7 phase 3: trick-or-treating
 *   UPDATE_LOG_SHOTS=1 node tests/e2e/haunting4.mjs     V7 phase 4: the hauntings
 *   UPDATE_LOG_SHOTS=1 node tests/e2e/v7-release.mjs    V7 phase 5: the release
 *   node tools/update-log/build-images.mjs [v6 v6.5 v7] resize, brighten and encode (all, or just those)
 *
 * Encoding runs in the Chromium that Playwright already uses, so nothing else
 * needs installing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const SHOTS = path.resolve('tests/e2e/out');
const ROOT = path.resolve('public/updatelog');
const only = process.argv.slice(2);

/**
 * The End is dark: game views get an automatic exposure (brightened towards an average
 * brightness, up to 2.2 times). Menus and windows are left as they are.
 */
const GAME = 'auto';
const shots = [];
/** The version the pictures added next belong to (their folder). */
let version = 'v6';
const add = (name, src, opts = {}) => shots.push({ name, src, width: 800, filter: GAME, version, ...opts });

add('title-expanded-end', 'clean/v6-title-expanded-end.png', { width: 1280 });
for (const t of ['crystal-fields', 'end-eclipse']) add(`title-${t}`, `clean/v6-title-${t}.png`);
// The eclipse is meant to be dark
add('eclipse-sky', 'clean/v6-eclipse-sky.png', { filter: 'brightness(1.15)' });
for (const n of ['portal-dormant', 'portal-alive', 'arrival', 'chorus-tree', 'ender-bridge', 'crystal-generator', 'void-skiff', 'ancient-gateway', 'discovery-title', 'glyph-wall', 'dragon-nest', 'dragon-nest-crack', 'storm', 'storm-remnant', 'eclipse-monolith', 'citadel-exterior', 'citadel-glyph', 'citadel-parkour', 'guardian-phase1', 'guardian-phase2', 'guardian-phase3', 'guardian-victory', 'telegraph-lunge', 'telegraph-throw', 'telegraph-sentinel', 'telegraph-bulwark'])
  add(n, `clean/v6-${n}.png`);
for (const b of ['end_barrens', 'shattered_end', 'astral_end', 'highlands', 'end_crystal_fields', 'chorus_forest', 'void_wastes']) add(`biome-${b}`, `clean/v6-biome-${b}.png`);
for (const m of ['endling', 'void_stalker', 'chorus_beast', 'end_crystal_mite', 'end_phantom']) add(`mob-${m}`, `clean/v6-mob-${m}.png`);
for (const o of ['ender_ore', 'void_crystal_ore', 'ancient_end_fragment', 'astral_ore']) add(`ore-${o}`, `clean/v6-ore-${o}.png`);
for (const s of ['end_outpost', 'end_settlement', 'end_ruins', 'end_library', 'end_observatory', 'end_shipyard', 'end_metropolis', 'end_palace', 'end_colossus', 'crystal_cathedral', 'void_observatory', 'end_fortress', 'fallen_city'])
  add(`structure-${s}`, `clean/v6-structure-${s}.png`);
for (const c of ['guardian_sentinel', 'guardian_bulwark']) add(`construct-${c}`, `clean/v6-construct-${c}.png`);
for (const d of ['breath-wave', 'wing-gust', 'roar', 'pillar-weave', 'strafing-dive', 'crystal-fury', 'edge-strike', 'dragon-storm']) add(`dragon-${d}`, `clean/v6-dragon-${d}.png`);
// Windows and menus: as they are
for (const n of ['teleport-node', 'elytra-smithing', 'elytra-tooltip', 'ender-alloy-armor', 'glyph-tablet', 'admin-teleport-end']) add(n, `clean/v6-${n}.png`, { filter: '' });
// The quest tracker is part of the HUD, so this one keeps it
add('quest-tracker', 'v6-quest-tracker.png');

// ---------------------------------------------------------------- V6.5: multiplayer, the Haunting, Auto Optimize
version = 'v6.5';
for (const m of ['signin', 'host-tab', 'host-form', 'hosting-panel', 'friends-join', 'join-code', 'public']) add(`mp-${m}`, `clean/ul-mp-${m}.png`, { filter: '' });
add('mp-together', 'clean/ul-mp-together.png');
add('haunting-tab', 'haunting-tab.png', { filter: '' });
// Whichever sighting the haunting gave (it is random how close he came)
add('haunting-sighting', ['clean/haunting-sighting-far.png', 'clean/haunting-sighting-mid.png', 'clean/haunting-sighting-near.png']);
add('haunting-not-safe', 'haunting-not-safe.png', { filter: '' });
add('haunting-ban', 'haunting-ban.png', { filter: '' });
add('haunting-lair', 'clean/haunting-lair-wake.png');
add('auto-optimize-toast', 'auto-optimize-toast.png', { filter: '' });
add('auto-optimize-settings', 'auto-optimize-video-settings.png', { filter: '' });

// ---------------------------------------------------------------- V7: the Halloween Update
version = 'v7';
add('title-haunted-forest', 'clean/halloween-scene-haunted_forest.png', { width: 1280 });
for (const t of ['pumpkin_patch', 'ghost_marsh']) add(`title-${t.replace('_', '-')}`, `clean/halloween-scene-${t}.png`);
add('title-menu', 'halloween-title-haunted_forest.png', { filter: '' });
for (const d of ['overworld', 'nether', 'end', 'expanded_end', 'farlands', 'computer']) add(`pumpkin-${d.replace('_', '-')}`, `clean/halloween-pumpkin-${d}.png`);
add('pumpkins-day', 'clean/halloween-pumpkins-day.png', { filter: '' });
add('pumpkins-night', 'clean/halloween-pumpkins-night.png');
add('ghost', 'clean/halloween-ghost.png');
for (const n of ['world-option', 'creative-tab']) add(n, `clean/halloween-${n}.png`, { filter: '' });
// Phase 2: the villages and the heads (tests/e2e/villages.mjs)
for (const t of ['trick_village', 'abandoned_village']) add(`title-${t.replace('_', '-')}`, `clean/halloween-scene-${t}.png`);
add('trick-village', 'clean/villages-trick-village.png');
add('trick-village-day', 'clean/villages-trick-village-day.png', { filter: '' });
add('trick-village-door', 'clean/villages-trick-village-door.png');
add('abandoned-village', 'clean/villages-abandoned-village.png', { filter: '' });
add('abandoned-inside', 'clean/villages-abandoned-inside.png');
add('abandoned-guardians', 'clean/villages-abandoned-guardians.png', { filter: '' });
add('heads', 'clean/villages-heads.png', { filter: '' });
add('heads-worn', 'clean/villages-heads-worn.png', { filter: '' });
add('admin-villages', 'clean/halloween-admin-villages.png', { filter: '' });
// Phase 3: trick-or-treating (tests/e2e/trick-or-treat.mjs)
add('title-trick-or-treat', 'trick-title-scene.png', { width: 1280 });
for (const [name, src] of [['candy-home-give', 'trick-candy-home-give'], ['candy-home', 'trick-candy-home'], ['rejected', 'trick-rejected'], ['knock-prompt', 'trick-knock-prompt'], ['trick-grab', 'trick-home-grab'], ['trick-drag', 'trick-home-drag'], ['candy-ground', 'trick-candy-ground'], ['hand-poisoned', 'trick-hand-poisoned_candy'], ['costume-carved-pumpkin', 'trick-costume-carved_pumpkin'], ['costume-zombie-head', 'trick-costume-zombie_head']])
  add(name, `clean/${src}.png`);
for (const n of ['sack-partial', 'sack-full', 'sack-tooltip']) add(n, `clean/trick-${n}.png`, { filter: '' });
add('trick-loot', 'clean/trick-home-loot.png', { filter: '' });
add('admin-trick', 'clean/trick-admin.png', { filter: '' });
// These keep the HUD: the boss bar, the quest tracker
add('trick-fight', 'trick-home-fight.png');
add('trick-herobrine', 'trick-home-herobrine.png');
add('quest', 'trick-quest.png');
// Phase 4: the hauntings (tests/e2e/haunting4.mjs)
for (const c of ['null', 'green_steve', 'cave_dweller']) add(`appear-${c}`, `clean/haunting4-appear-${c}.png`);
add('auto-sighting', 'clean/haunting4-auto-sighting.png');
for (const n of ['null-figure', 'null-sign', 'null-erase', 'green-friend', 'green-house', 'green-copy', 'green-room', 'green-replaced', 'dweller-watch', 'dweller-drag', 'dweller-dawn']) add(n, `clean/haunting4-${n}.png`);
// Whichever of its moves the run caught
add('dweller-crawl', ['clean/haunting4-dweller-lunge.png', 'clean/haunting4-dweller-crawl.png']);
add('dweller-eyes', 'clean/haunting4-dweller-eyes.png', { filter: '' });
// The panel, the end screens, and those that keep the HUD (the chat) or the colour drained out
for (const [name, src] of [['haunt-tab', 'haunting4-tab-null'], ['haunt-talk', 'haunting4-talk-green_steve'], ['null-end', 'haunting4-null-end'], ['auto-status', 'haunting4-auto-status'], ['null-drain', 'haunting4-null-drain'], ['auto-notice', 'haunting4-auto-notice']]) add(name, `${src}.png`, { filter: '' });

// Phase 5: the release (tests/e2e/v7-release.mjs)
for (const t of ['ghost_forest', 'haunted_camp']) add(`title-${t.replace('_', '-')}`, `clean/v7r-scene-${t}.png`);
add('advancements', 'v7r-advancements.png', { filter: '' });
add('admin', 'v7r-admin-halloween-1920.png', { filter: '', width: 1000 });
add('admin-after', 'v7r-admin-after.png', { filter: '' });
add('always-on', 'clean/v7r-always-on.png');
add('mp-together', 'clean/v7r-mp-alice.png');
// These keep the HUD: the quest tracker's last word
add('quest-done', 'v7r-quest-done.png');

if (only.length) shots.splice(0, shots.length, ...shots.filter((s) => only.includes(s.version)));
// A list of sources: the first one there is used
for (const s of shots) if (Array.isArray(s.src)) s.src = s.src.find((f) => fs.existsSync(path.join(SHOTS, f))) ?? s.src[0];
// A picture already made whose screenshot is not here is kept as it is (only what was captured is rebuilt)
const kept = shots.filter((s) => !fs.existsSync(path.join(SHOTS, s.src)) && fs.existsSync(path.join(ROOT, s.version, `${s.name}.webp`)));
if (kept.length) {
  console.log(`Keeping ${kept.length} pictures whose screenshots are not here: ${kept.map((s) => `${s.version}/${s.name}`).join(', ')}`);
  shots.splice(0, shots.length, ...shots.filter((s) => !kept.includes(s)));
}
const missing = shots.filter((s) => !fs.existsSync(path.join(SHOTS, s.src)));
if (missing.length) {
  console.error('Missing screenshots (run the captures first):\n  ' + missing.map((s) => s.src).join('\n  '));
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const page = await browser.newPage();
let total = 0;
for (const s of shots) {
  const b64 = fs.readFileSync(path.join(SHOTS, s.src)).toString('base64');
  const url = await page.evaluate(
    async ({ b64, width, filter }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const w = Math.min(width, img.width);
      const h = Math.round((w * img.height) / img.width);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      if (filter === 'auto') {
        // Average brightness (Rec. 709 luma), then a brightness factor towards 0.36, from 1.0 to 2.2
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4 * 7) {
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          n++;
        }
        const k = Math.min(2.2, Math.max(1, 0.36 / Math.max(0.01, sum / n)));
        ctx.clearRect(0, 0, w, h);
        filter = `brightness(${k.toFixed(2)}) contrast(1.05) saturate(1.08)`;
      }
      if (filter) ctx.filter = filter;
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/webp', 0.8);
    },
    { b64, width: s.width, filter: s.filter },
  );
  const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  const dir = path.join(ROOT, s.version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${s.name}.webp`), buf);
  total += buf.length;
}
await browser.close();
console.log(`${shots.length} pictures, ${(total / 1024).toFixed(0)} KB in ${path.relative(process.cwd(), ROOT)} (${[...new Set(shots.map((s) => s.version))].join(', ')})`);
