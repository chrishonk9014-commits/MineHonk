import type { S2C } from '../../common/net/protocol';

/** Transport-agnostic connection to one client. */
export interface Connection {
  readonly id: string;
  /** Human readable remote description (for logs). */
  readonly remote: string;
  send(msg: S2C): void;
  close(reason?: string): void;
  /** Bytes queued but not yet flushed (backpressure hint). */
  readonly buffered?: number;
}

/** Authenticated identity supplied by the transport layer. */
export interface Identity {
  uuid: string;
  name: string;
  /** True when this identity belongs to the world's owner/host. */
  isHost?: boolean;
}
