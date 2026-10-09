/** Browser entry point. */
import './render/colorSetup';
import './ui/style.css';
import { initItems, itemById } from '../common/registry/items';
import { stateFromString, blockById, STATE_BLOCK } from '../common/registry/blocks';
import { loadSettings, loadProfile } from './settings';
import { loadAssets, applyUiTextures } from './assets/loadAssets';
import { setIcons } from './ui/slots';
import { AudioEngine } from './audio/Audio';
import { Input } from './input/Input';
import { App } from './App';
import { compatKey } from './net/version';

async function boot(): Promise<void> {
  const status = document.getElementById('boot-status');
  const setStatus = (t: string): void => {
    if (status) status.textContent = t;
  };
  try {
    if (!window.WebGL2RenderingContext) throw new Error('This browser does not support WebGL 2.');
    setStatus('Preparing registries...');
    initItems();
    const settings = loadSettings();
    const profile = loadProfile();
    const assets = await loadAssets(setStatus);
    setIcons(assets.icons);
    applyUiTextures(assets.icons);
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const ui = document.getElementById('ui')!;
    const input = new Input(canvas, settings);
    const audio = new AudioEngine(settings);
    document.getElementById('boot')?.remove();
    const app = new App(canvas, ui, assets, settings, profile, audio, input);
    // Developer handle: only in development builds and automated test browsers
    if (import.meta.env.DEV || navigator.webdriver) Object.assign(window, { minehonk: app, minehonkState: stateFromString, minehonkRegistry: { itemById, blockById, blockOfState: (st: number) => STATE_BLOCK[st] }, minehonkNet: { compatKey } });
  } catch (e) {
    console.error(e);
    setStatus(`Failed to start: ${(e as Error).message}`);
  }
}

void boot();
