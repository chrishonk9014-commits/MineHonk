/** This build's game version and its compatibility key (players must match to play together). */
import { PROTOCOL_VERSION } from '../../common/net/protocol';
import { registryHash } from '../../common/registry/hash';

declare const __GAME_VERSION__: string;
declare const __HUB_URL__: string;

export const GAME_VERSION = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : 'dev';

/** The cloud hub this build talks to ('' when none: the self-hosted server flow). */
export const HUB_URL = typeof __HUB_URL__ === 'string' ? __HUB_URL__ : '';

let compat: string | null = null;

/** Protocol and game content: two players can play together only if these match. */
export function compatKey(): string {
  compat ??= `${PROTOCOL_VERSION}:${registryHash()}`;
  return compat;
}
