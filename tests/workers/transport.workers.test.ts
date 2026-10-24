/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RagwallaWebSocket } from '../../src/client/websocket-client';

// Proves the Workers transport against REAL workerd: the SDK runs in workerd (so
// isWorkersRuntime() is true and createWorkersSocket() is used), and its outbound
// fetch(Upgrade) is routed to the in-pool test worker, which serves a genuine
// WebSocketPair. This exercises fetch + Upgrade + accept + the synthesized open event
// end-to-end — the thing the jest fakes can only approximate.

let originalFetch: typeof globalThis.fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
  // Route the SDK's outbound websocket-upgrade fetch to our in-pool worker.
  globalThis.fetch = ((input: any, init?: any) => SELF.fetch(input, init)) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function until(pred: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('RagwallaWebSocket on real workerd (fetch + Upgrade transport)', () => {
  it('selects the Workers transport (WebSocketPair is present)', () => {
    expect(typeof (globalThis as any).WebSocketPair).toBe('function');
  });

  it('connect() resolves via the synthesized open, then frames flow both ways', async () => {
    const ws = new RagwallaWebSocket({ baseURL: 'wss://test.ai.ragwalla.com/v1', reconnectAttempts: 0 });
    const connectionStatus: any[] = [];
    const echoes: any[] = [];
    ws.on('connectionStatus', (m: any) => connectionStatus.push(m));
    ws.on('rawMessage', (m: any) => { if (m?.type === 'echo') echoes.push(m); });

    // The whole point: this resolves on workerd, where new WebSocket(url) would never
    // emit 'open'. createWorkersSocket synthesizes it after accept().
    await ws.connect('agent', 'main', 'tok');
    expect(ws.isConnected()).toBe(true);

    // Server greeted us with a `connected` frame on accept → handled inbound.
    await until(() => connectionStatus.length > 0);
    expect(connectionStatus[0]).toMatchObject({ currentThreadId: 'thr_workerd' });

    // Outbound send works and the server echoes it back → full round trip on real workerd.
    ws.sendMessage({ role: 'user', content: 'ping' });
    await until(() => echoes.length > 0);
    expect(echoes[0].type).toBe('echo');
    expect(String(echoes[0].received)).toContain('ping');

    ws.disconnect();
  });
});
