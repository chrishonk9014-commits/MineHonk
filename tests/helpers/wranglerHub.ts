/**
 * Runs the cloud hub locally under Wrangler (workerd, with local D1 and
 * Durable Objects) on a free port and a fresh database, for tests.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

export interface LocalHub {
  base: string;
  port: number;
  stop(): Promise<void>;
}

export async function startLocalHub(vars: Record<string, string> = {}): Promise<LocalHub> {
  const persist = mkdtempSync(path.join(tmpdir(), 'mh-hub-'));
  const hubDir = path.resolve('hub');
  const wrangler = path.resolve('node_modules/.bin/wrangler');
  execFileSync(wrangler, ['d1', 'migrations', 'apply', 'minehonk-hub', '--local', '--persist-to', persist], { cwd: hubDir, stdio: 'ignore', env: { ...process.env, CI: '1' } });
  const port = await freePort();
  const args = ['dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist, '--inspector-port', String(await freePort()), '--var', 'DEV:1', '--var', 'STUN_URLS:none'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const child: ChildProcess = spawn(wrangler, args, { cwd: hubDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: true });
  let log = '';
  child.stdout?.on('data', (d) => (log += d));
  child.stderr?.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > 90_000) {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {}
      throw new Error(`the hub did not start:\n${log.slice(-2000)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return {
    base,
    port,
    async stop() {
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {}
      rmSync(persist, { recursive: true, force: true });
    },
  };
}
