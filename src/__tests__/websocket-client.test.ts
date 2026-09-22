import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RagwallaWebSocket, RunToCompletionError } from '../client/websocket-client';
import type { RunResult } from '../types/index';

/**
 * Tests for the reconnect/resume client protocol (RECONNECT_RESUME_SPEC §6a):
 * activeMessageId lifecycle, resume_message_id on reconnect (and its never-without-
 * thread_id invariant), activeThreadId persistence from thread_info, and the new
 * resume / run_state inbound frames.
 *
 * The browser path builds the socket via a global `WebSocket`; the Workers path uses
 * fetch() with an Upgrade request. These tests install fakes so frames can be driven
 * synchronously and the (re)connect URL inspected without a network.
 */

type Handler = (event: any) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset(): void { FakeWebSocket.instances = []; }
  static get last(): FakeWebSocket { return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]; }

  url: string;
  readyState = 0; // CONNECTING until open
  sent: string[] = [];
  private handlers: Record<string, Handler[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: Handler): void { (this.handlers[type] ||= []).push(fn); }
  removeEventListener(type: string, fn: Handler): void {
    this.handlers[type] = (this.handlers[type] || []).filter((h) => h !== fn);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; }
  fire(type: string, event: any): void {
    if (type === 'open') {
      this.readyState = 1;
    }
    if (type === 'close') {
      this.readyState = 3;
    }
    (this.handlers[type] || []).forEach((h) => h(event));
  }
  frame(obj: unknown): void { this.fire('message', { data: JSON.stringify(obj) }); }
}

class FakeWorkersWebSocket {
  readyState = 0; // CONNECTING until accept()
  accepted = false;
  closed = false;
  sent: string[] = [];
  private handlers: Record<string, Handler[]> = {};

  accept(): void {
    this.accepted = true;
    this.readyState = 1;
  }
  addEventListener(type: string, fn: Handler): void { (this.handlers[type] ||= []).push(fn); }
  removeEventListener(type: string, fn: Handler): void {
    this.handlers[type] = (this.handlers[type] || []).filter((h) => h !== fn);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  fire(type: string, event: any): void { (this.handlers[type] || []).forEach((h) => h(event)); }
}

const BASE = 'wss://api.example.com/v1';

let originalWebSocket: unknown;
let originalWebSocketPair: unknown;
let originalFetch: unknown;

function newClient(): RagwallaWebSocket {
  return new RagwallaWebSocket({ baseURL: BASE, reconnectAttempts: 0 });
}

function newReconnectClient(): RagwallaWebSocket {
  return new RagwallaWebSocket({ baseURL: BASE, reconnectAttempts: 1, reconnectDelay: 0 });
}

function installWorkersRuntime(fetchMock: unknown): void {
  (globalThis as any).WebSocketPair = function WebSocketPair() {};
  (globalThis as any).fetch = fetchMock;
}

async function flushAsyncUpgrade(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushTimers(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await flushMicrotasks();
}

/** Connect and resolve by firing the socket's `open` event. */
async function connectOpen(
  client: RagwallaWebSocket,
  opts: { threadId?: string } = {},
): Promise<void> {
  const p = client.connect('agent', 'conn', 'tok', opts.threadId);
  FakeWebSocket.last.fire('open', {});
  await p;
}

/** Drive the SDK auto-reconnect path and return the reconnect URL. */
async function reconnectUrl(client: RagwallaWebSocket): Promise<URL> {
  const before = FakeWebSocket.instances.length;
  FakeWebSocket.last.fire('close', { code: 1006, reason: 'network drop' });
  await flushTimers();
  expect(FakeWebSocket.instances.length).toBe(before + 1);
  const url = new URL(FakeWebSocket.last.url);
  FakeWebSocket.last.fire('open', {});
  await flushMicrotasks();
  return url;
}

beforeEach(() => {
  FakeWebSocket.reset();
  originalWebSocket = (globalThis as any).WebSocket;
  originalWebSocketPair = (globalThis as any).WebSocketPair;
  originalFetch = (globalThis as any).fetch;
  (globalThis as any).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  (globalThis as any).WebSocket = originalWebSocket;
  if (originalWebSocketPair === undefined) {
    delete (globalThis as any).WebSocketPair;
  } else {
    (globalThis as any).WebSocketPair = originalWebSocketPair;
  }
  if (originalFetch === undefined) {
    delete (globalThis as any).fetch;
  } else {
    (globalThis as any).fetch = originalFetch;
  }
});

describe('Cloudflare Workers WebSocket transport', () => {
  it('uses fetch Upgrade with an https URL, accepts the socket, and synthesizes open', async () => {
    const workersSocket = new FakeWorkersWebSocket();
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({ status: 101, webSocket: workersSocket }));
    const webSocketConstructor = jest.fn();
    installWorkersRuntime(fetchMock);
    (globalThis as any).WebSocket = webSocketConstructor;

    const client = newClient();
    const connected = jest.fn();
    const chunk = jest.fn();
    client.on('connected', connected);
    client.on('chunk', chunk);

    const connectPromise = client.connect('agent', 'conn', 'tok');
    expect(client.isConnected()).toBe(false);
    await connectPromise;

    expect(webSocketConstructor).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [fetchUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(fetchUrl);
    expect(parsedUrl.protocol).toBe('https:');
    expect(parsedUrl.pathname).toBe('/v1/agents/agent/conn');
    expect(parsedUrl.searchParams.get('token')).toBe('tok');
    expect(parsedUrl.searchParams.get('continuation_mode')).toBe('auto');
    expect((init.headers as Record<string, string>).Upgrade).toBe('websocket');
    expect(workersSocket.accepted).toBe(true);
    expect(connected).toHaveBeenCalledWith({});
    expect(client.isConnected()).toBe(true);

    workersSocket.fire('message', {
      data: JSON.stringify({ type: 'chunk', messageId: 'msg_1', content: 'hello' })
    });
    expect(chunk).toHaveBeenCalledWith({ messageId: 'msg_1', content: 'hello' });

    client.send({ type: 'ping' });
    expect(workersSocket.sent).toEqual([JSON.stringify({ type: 'ping' })]);
  });

  it('emits error and close when the Workers upgrade fetch rejects', async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => {
      throw new Error('upgrade failed');
    });
    installWorkersRuntime(fetchMock);

    const client = newClient();
    const error = jest.fn();
    const disconnected = jest.fn();
    client.on('error', error);
    client.on('disconnected', disconnected);

    await expect(client.connect('agent', 'conn', 'tok')).rejects.toThrow('upgrade failed');
    expect(error).toHaveBeenCalledWith({ error: 'upgrade failed' });
    expect(disconnected).toHaveBeenCalledWith({ code: 1006, reason: 'fetch failed' });
  });

  it('emits error and close when the Workers upgrade response has no WebSocket', async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({ status: 200 }));
    installWorkersRuntime(fetchMock);

    const client = newClient();
    const disconnected = jest.fn();
    client.on('disconnected', disconnected);

    await expect(client.connect('agent', 'conn', 'tok')).rejects.toThrow('expected 101 upgrade, got HTTP 200');
    expect(disconnected).toHaveBeenCalledWith({ code: 1006, reason: 'no webSocket (HTTP 200)' });
  });

  it('closes an upgraded Workers socket without opening when disconnected before fetch resolves', async () => {
    let resolveFetch!: (response: { status: number; webSocket: FakeWorkersWebSocket }) => void;
    const fetchMock = jest.fn((_url: string, _init?: RequestInit) => new Promise<{ status: number; webSocket: FakeWorkersWebSocket }>((resolve) => {
      resolveFetch = resolve;
    }));
    installWorkersRuntime(fetchMock);

    const client = newClient();
    const connected = jest.fn();
    const disconnected = jest.fn();
    client.on('connected', connected);
    client.on('disconnected', disconnected);

    const connectPromise = client.connect('agent', 'conn', 'tok');
    connectPromise.catch(() => {});
    client.disconnect();

    const workersSocket = new FakeWorkersWebSocket();
    resolveFetch({ status: 101, webSocket: workersSocket });
    await flushAsyncUpgrade();

    expect(workersSocket.accepted).toBe(true);
    expect(workersSocket.closed).toBe(true);
    expect(connected).not.toHaveBeenCalled();
    expect(disconnected).not.toHaveBeenCalled();
  });
});

describe('RagwallaWebSocket reconnect/resume protocol (§6a)', () => {
  it('emits raw frame events for known frames before SDK normalization', async () => {
    const client = newClient();
    await connectOpen(client);

    const order: string[] = [];
    const rawFrame = jest.fn((frame: any) => {
      order.push(`rawFrame:${frame.type}`);
    });
    const frame = jest.fn((raw: any) => {
      order.push(`frame:${raw.type}`);
    });
    const chunk = jest.fn(() => {
      order.push('chunk');
    });

    client.on('rawFrame', rawFrame);
    client.on('frame', frame);
    client.on('chunk', chunk);

    const inbound = {
      type: 'chunk',
      messageId: 'msg_1',
      content: 'hello',
      futureField: { preserve: true }
    };
    FakeWebSocket.last.frame(inbound);

    expect(rawFrame).toHaveBeenCalledWith(inbound);
    expect(frame).toHaveBeenCalledWith(inbound);
    expect(chunk).toHaveBeenCalledWith({ messageId: 'msg_1', content: 'hello' });
    expect(order).toEqual(['rawFrame:chunk', 'frame:chunk', 'chunk']);
  });

  it('auto reconnect uses getReconnectToken and preserves thread/resume params', async () => {
    const getReconnectToken = jest.fn(async () => 'fresh_tok');
    const client = new RagwallaWebSocket({
      baseURL: BASE,
      reconnectAttempts: 1,
      reconnectDelay: 0,
      getReconnectToken
    });
    await connectOpen(client, { threadId: 'thr_1' });
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_1' });

    FakeWebSocket.last.fire('close', { code: 1006, reason: 'network drop' });
    await flushTimers();

    expect(getReconnectToken).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent',
      connectionId: 'conn',
      threadId: 'thr_1',
      resumeMessageId: 'msg_1',
      previousToken: 'tok',
      attempt: 1,
      reason: 'auto_reconnect'
    }));
    expect(FakeWebSocket.instances).toHaveLength(2);
    const reconnect = new URL(FakeWebSocket.last.url);
    expect(reconnect.searchParams.get('token')).toBe('fresh_tok');
    expect(reconnect.searchParams.get('thread_id')).toBe('thr_1');
    expect(reconnect.searchParams.get('resume_message_id')).toBe('msg_1');

    FakeWebSocket.last.fire('open', {});
    await flushMicrotasks();
  });

  it('carries resume_message_id on the FIRST connect when a resume seed is passed', async () => {
    // connect() resets the logical session (clearing activeMessageId) before dialing, so a
    // relay rebuilding around an in-flight message needs this parameter — a pre-connect
    // property assignment is wiped by the reset.
    const client = new RagwallaWebSocket({ baseURL: BASE });
    const connectPromise = client.connect('agent', 'conn', 'tok', 'thr_1', 'msg_inflight');
    FakeWebSocket.last.fire('open', {});
    await connectPromise;

    const url = new URL(FakeWebSocket.last.url);
    expect(url.searchParams.get('thread_id')).toBe('thr_1');
    expect(url.searchParams.get('resume_message_id')).toBe('msg_inflight');
  });

  it("emits 'reconnecting' with attempt metadata when a retry is scheduled", async () => {
    const reconnecting = jest.fn();
    const client = new RagwallaWebSocket({
      baseURL: BASE,
      reconnectAttempts: 2,
      reconnectDelay: 0,
      getReconnectToken: async () => 'fresh_tok',
    });
    client.on('reconnecting', reconnecting);
    await connectOpen(client, { threadId: 'thr_1' });

    FakeWebSocket.last.fire('close', { code: 1006, reason: 'network drop' });
    await flushTimers();

    expect(reconnecting).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, maxAttempts: 2, delayMs: 0 }),
    );
  });

  it('continues reconnecting when a reconnect socket closes before open', async () => {
    let tokenCounter = 0;
    const getReconnectToken = jest.fn(async () => `fresh_tok_${++tokenCounter}`);
    const client = new RagwallaWebSocket({
      baseURL: BASE,
      reconnectAttempts: 2,
      reconnectDelay: 0,
      getReconnectToken
    });
    await connectOpen(client, { threadId: 'thr_1' });

    FakeWebSocket.last.fire('close', { code: 1006, reason: 'network drop' });
    await flushTimers();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(new URL(FakeWebSocket.last.url).searchParams.get('token')).toBe('fresh_tok_1');

    FakeWebSocket.last.fire('close', { code: 1006, reason: 'closed before open' });
    await flushTimers();
    await flushTimers();

    expect(getReconnectToken).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(new URL(FakeWebSocket.last.url).searchParams.get('token')).toBe('fresh_tok_2');

    FakeWebSocket.last.fire('open', {});
    await flushMicrotasks();
    expect(client.isConnected()).toBe(true);
  });

  it('manual disconnect cancels a pending token refresh reconnect', async () => {
    let resolveToken!: (token: string) => void;
    const getReconnectToken = jest.fn(() => new Promise<string>((resolve) => {
      resolveToken = resolve;
    }));
    const reconnectFailed = jest.fn();
    const client = new RagwallaWebSocket({
      baseURL: BASE,
      reconnectAttempts: 1,
      reconnectDelay: 0,
      getReconnectToken
    });
    client.on('reconnectFailed', reconnectFailed);
    await connectOpen(client);

    FakeWebSocket.last.fire('close', { code: 1006, reason: 'network drop' });
    await flushTimers();
    expect(getReconnectToken).toHaveBeenCalledTimes(1);

    client.disconnect();
    resolveToken('fresh_after_disconnect');
    await flushMicrotasks();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.isConnected()).toBe(false);
    expect(reconnectFailed).not.toHaveBeenCalled();
  });

  it('explicit connect cancels a pending token refresh reconnect to the old agent', async () => {
    let resolveToken!: (token: string) => void;
    const getReconnectToken = jest.fn(() => new Promise<string>((resolve) => {
      resolveToken = resolve;
    }));
    const client = new RagwallaWebSocket({
      baseURL: BASE,
      reconnectAttempts: 1,
      reconnectDelay: 0,
      getReconnectToken
    });
    await connectOpen(client);

    FakeWebSocket.last.fire('close', { code: 1006, reason: 'network drop' });
    await flushTimers();
    expect(getReconnectToken).toHaveBeenCalledTimes(1);

    const explicitConnect = client.connect('agent_new', 'conn_new', 'tok_new');
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last.fire('open', {});
    await explicitConnect;

    resolveToken('old_agent_fresh_token');
    await flushMicrotasks();

    expect(FakeWebSocket.instances).toHaveLength(2);
    const explicitUrl = new URL(FakeWebSocket.last.url);
    expect(explicitUrl.pathname).toBe('/v1/agents/agent_new/conn_new');
    expect(explicitUrl.searchParams.get('token')).toBe('tok_new');
  });

  it('explicit connect closes and ignores a superseded pending connect socket', async () => {
    const client = newClient();
    const connected = jest.fn();
    const chunk = jest.fn();
    client.on('connected', connected);
    client.on('chunk', chunk);

    const oldConnect = client.connect('agent_old', 'conn_old', 'tok_old');
    const oldConnectRejection = expect(oldConnect).rejects.toThrow('WebSocket connection superseded');
    const oldSocket = FakeWebSocket.last;

    const newConnect = client.connect('agent_new', 'conn_new', 'tok_new');
    await oldConnectRejection;
    expect(oldSocket.readyState).toBe(3);

    const newSocket = FakeWebSocket.last;
    newSocket.fire('open', {});
    await newConnect;

    oldSocket.fire('open', {});
    oldSocket.frame({ type: 'chunk', messageId: 'old_msg', content: 'stale' });

    expect(connected).toHaveBeenCalledTimes(1);
    expect(chunk).not.toHaveBeenCalled();
    expect(new URL(newSocket.url).pathname).toBe('/v1/agents/agent_new/conn_new');
  });

  it('explicit connect closes and ignores a superseded auto-reconnect socket', async () => {
    const getReconnectToken = jest.fn(async () => 'fresh_reconnect_tok');
    const client = new RagwallaWebSocket({
      baseURL: BASE,
      reconnectAttempts: 1,
      reconnectDelay: 0,
      getReconnectToken
    });
    const reconnectFailed = jest.fn();
    const chunk = jest.fn();
    client.on('reconnectFailed', reconnectFailed);
    client.on('chunk', chunk);
    await connectOpen(client);

    FakeWebSocket.last.fire('close', { code: 1006, reason: 'network drop' });
    await flushTimers();

    const reconnectSocket = FakeWebSocket.last;
    expect(new URL(reconnectSocket.url).searchParams.get('token')).toBe('fresh_reconnect_tok');

    const explicitConnect = client.connect('agent_new', 'conn_new', 'tok_new');
    expect(reconnectSocket.readyState).toBe(3);

    const explicitSocket = FakeWebSocket.last;
    explicitSocket.fire('open', {});
    await explicitConnect;
    await flushMicrotasks();

    reconnectSocket.fire('open', {});
    reconnectSocket.frame({ type: 'chunk', messageId: 'old_msg', content: 'stale' });

    expect(reconnectFailed).not.toHaveBeenCalled();
    expect(chunk).not.toHaveBeenCalled();
    expect(new URL(explicitSocket.url).pathname).toBe('/v1/agents/agent_new/conn_new');
  });

  it('disconnect rejects a pending connect before open', async () => {
    const client = newClient();
    const connectPromise = client.connect('agent', 'conn', 'tok');
    expect(FakeWebSocket.instances).toHaveLength(1);

    client.disconnect();

    await expect(connectPromise).rejects.toThrow('WebSocket connection cancelled');
    expect(FakeWebSocket.last.readyState).toBe(3);
    expect(client.isConnected()).toBe(false);
  });

  it('sendAsync waits for a pending connect instead of opening a second socket', async () => {
    const client = newClient();
    const connectPromise = client.connect('agent', 'conn', 'tok');
    const connectingSocket = FakeWebSocket.last;

    const sendPromise = client.sendAsync({ type: 'ping' });
    await flushMicrotasks();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(connectingSocket.sent).toEqual([]);

    connectingSocket.fire('open', {});
    await Promise.all([connectPromise, sendPromise]);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(connectingSocket.sent).toEqual([JSON.stringify({ type: 'ping' })]);
  });

  it('sendAsync reconnects with a fresh token before sending when upstream is down', async () => {
    const getReconnectToken = jest.fn(async () => 'fresh_send_tok');
    const client = new RagwallaWebSocket({
      baseURL: BASE,
      reconnectAttempts: 0,
      reconnectDelay: 0,
      getReconnectToken
    });
    await connectOpen(client, { threadId: 'thr_1' });

    const oldSocket = FakeWebSocket.last;
    oldSocket.readyState = 3;
    const sendPromise = client.sendAsync({ type: 'ping' });
    await flushMicrotasks();

    expect(getReconnectToken).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent',
      connectionId: 'conn',
      threadId: 'thr_1',
      previousToken: 'tok',
      attempt: 0,
      reason: 'send'
    }));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.last.sent).toEqual([]);
    expect(new URL(FakeWebSocket.last.url).searchParams.get('token')).toBe('fresh_send_tok');

    FakeWebSocket.last.fire('open', {});
    await sendPromise;
    expect(FakeWebSocket.last.sent).toEqual([JSON.stringify({ type: 'ping' })]);
  });

  it('sendAsync rejects when its reconnect socket closes before open and allows a later retry', async () => {
    let tokenCounter = 0;
    const getReconnectToken = jest.fn(async () => `fresh_send_tok_${++tokenCounter}`);
    const client = new RagwallaWebSocket({
      baseURL: BASE,
      reconnectAttempts: 0,
      reconnectDelay: 0,
      getReconnectToken
    });
    await connectOpen(client);

    FakeWebSocket.last.readyState = 3;
    const failedSend = client.sendAsync({ type: 'ping' });
    await flushMicrotasks();
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.last.fire('close', { code: 1006, reason: 'closed before open' });
    await expect(failedSend).rejects.toThrow('WebSocket closed before open: closed before open');

    const retrySend = client.sendAsync({ type: 'ping_retry' });
    await flushMicrotasks();
    expect(FakeWebSocket.instances).toHaveLength(3);
    FakeWebSocket.last.fire('open', {});
    await retrySend;

    expect(FakeWebSocket.last.sent).toEqual([JSON.stringify({ type: 'ping_retry' })]);
  });

  it('sendAsync fails before sending when token refresh fails', async () => {
    const getReconnectToken = jest.fn(async () => {
      throw new Error('mint failed');
    });
    const client = new RagwallaWebSocket({
      baseURL: BASE,
      reconnectAttempts: 0,
      reconnectDelay: 0,
      getReconnectToken
    });
    await connectOpen(client);

    const oldSocket = FakeWebSocket.last;
    oldSocket.readyState = 3;

    await expect(client.sendAsync({ type: 'ping' })).rejects.toThrow('mint failed');
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(oldSocket.sent).toEqual([]);
  });

  it('public connect without threadId starts a fresh logical session', async () => {
    const client = newClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'thread_info', threadId: 'thr_old' });
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_old' });

    const connectPromise = client.connect('agent_b', 'conn_b', 'tok_b');
    const url = new URL(FakeWebSocket.last.url);

    expect(url.pathname).toBe('/v1/agents/agent_b/conn_b');
    expect(url.searchParams.has('thread_id')).toBe(false);
    expect(url.searchParams.has('resume_message_id')).toBe(false);

    FakeWebSocket.last.fire('open', {});
    await connectPromise;
  });

  it('public connect to a different thread does not resume the old message', async () => {
    const client = newClient();
    await connectOpen(client, { threadId: 'thr_old' });
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_old' });

    const connectPromise = client.connect('agent_b', 'conn_b', 'tok_b', 'thr_new');
    const url = new URL(FakeWebSocket.last.url);

    expect(url.pathname).toBe('/v1/agents/agent_b/conn_b');
    expect(url.searchParams.get('thread_id')).toBe('thr_new');
    expect(url.searchParams.has('resume_message_id')).toBe(false);

    FakeWebSocket.last.fire('open', {});
    await connectPromise;
  });

  it('auto reconnect preserves thread_id and resume_message_id', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'thread_info', threadId: 'thr_old' });
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_old' });

    const url = await reconnectUrl(client);

    expect(url.searchParams.get('thread_id')).toBe('thr_old');
    expect(url.searchParams.get('resume_message_id')).toBe('msg_old');
  });

  it('initial connect carries thread_id and no resume_message_id (no dead last_event_id)', async () => {
    const client = newClient();
    await connectOpen(client, { threadId: 'thr_1' });
    const url = new URL(FakeWebSocket.last.url);
    expect(url.searchParams.get('thread_id')).toBe('thr_1');
    expect(url.searchParams.has('resume_message_id')).toBe(false);
    expect(url.searchParams.has('last_event_id')).toBe(false);
  });

  it('message_created sets the in-flight id → reconnect carries resume_message_id (with thread_id from thread_info)', async () => {
    const client = newReconnectClient();
    await connectOpen(client); // brand-new thread: no thread_id arg
    FakeWebSocket.last.frame({ type: 'thread_info', threadId: 'thr_1' }); // §6a 2.5
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_1', role: 'assistant' });

    const url = await reconnectUrl(client);
    expect(url.searchParams.get('thread_id')).toBe('thr_1');
    expect(url.searchParams.get('resume_message_id')).toBe('msg_1');
  });

  it('chunk sets the in-flight id as a fallback when message_created was missed', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'thread_info', threadId: 'thr_1' });
    // No message_created — only chunks (socket joined mid-stream).
    FakeWebSocket.last.frame({ type: 'chunk', messageId: 'msg_2', content: 'partial' });

    expect((await reconnectUrl(client)).searchParams.get('resume_message_id')).toBe('msg_2');
  });

  it('complete clears the in-flight id → reconnect does NOT resume a finished message', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'thread_info', threadId: 'thr_1' });
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_1' });
    FakeWebSocket.last.frame({ type: 'complete', messageId: 'msg_1' });

    const url = await reconnectUrl(client);
    expect(url.searchParams.get('thread_id')).toBe('thr_1');
    expect(url.searchParams.has('resume_message_id')).toBe(false);
  });

  it('terminal run_state emits runState and clears the in-flight id', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'thread_info', threadId: 'thr_1' });
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_1' });

    const runState = jest.fn();
    const runResumed = jest.fn();
    client.on('runState', runState);
    client.on('runResumed', runResumed); // removed event — must never fire

    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'completed', activeTool: null });

    expect(runState).toHaveBeenCalledWith({ runId: 'run_1', runStatus: 'completed', activeTool: null });
    expect(runResumed).not.toHaveBeenCalled();
    expect((await reconnectUrl(client)).searchParams.has('resume_message_id')).toBe(false); // cleared
  });

  it('run_cancelled clears the in-flight id', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'thread_info', threadId: 'thr_1' });
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_1' });
    FakeWebSocket.last.frame({ type: 'run_cancelled', runId: 'run_1' });

    expect((await reconnectUrl(client)).searchParams.has('resume_message_id')).toBe(false);
  });

  it('non-terminal run_state emits runState only (the legacy runResumed is gone)', async () => {
    const client = newClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'thread_info', threadId: 'thr_1' });

    const runState = jest.fn();
    const runResumed = jest.fn();
    client.on('runState', runState);
    client.on('runResumed', runResumed); // removed event — must never fire

    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'in_progress', activeTool: null });

    expect(runState).toHaveBeenCalledWith({ runId: 'run_1', runStatus: 'in_progress', activeTool: null });
    expect(runResumed).not.toHaveBeenCalled();
  });

  it("resume frame is forwarded as a 'resume' event with messageId + content", async () => {
    const client = newClient();
    await connectOpen(client);

    const resume = jest.fn();
    client.on('resume', resume);
    FakeWebSocket.last.frame({ type: 'resume', messageId: 'msg_1', content: 'Hello, resumed world' });

    expect(resume).toHaveBeenCalledWith({ messageId: 'msg_1', content: 'Hello, resumed world' });
  });

  it('connected.currentThreadId also persists activeThreadId for reconnect', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'connected', currentThreadId: 'thr_9', activeRunId: 'run_9', activeRunStatus: 'in_progress' });
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_9' });

    const url = await reconnectUrl(client);
    expect(url.searchParams.get('thread_id')).toBe('thr_9');
    expect(url.searchParams.get('resume_message_id')).toBe('msg_9');
  });

  it('INVARIANT: an in-flight id without a known thread_id sends NO resume_message_id, and reconnect still proceeds', async () => {
    const client = newReconnectClient();
    await connectOpen(client); // no thread_info / connected, no explicit threadId → activeThreadId null
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_1' });

    // The gate withholds resume_message_id (it would be unscoped without thread_id) and the
    // reconnect proceeds normally — it does NOT throw inside connect() (which would strand
    // the auto-reconnect path with no retry).
    const url = await reconnectUrl(client);
    expect(url.searchParams.has('resume_message_id')).toBe(false);
    expect(url.searchParams.has('thread_id')).toBe(false);
  });

  it('an explicit threadId persists for reconnect even before any server frame arrives', async () => {
    // Drop after `open` but before connected/thread_info: the reconnect must still carry
    // the thread the caller named, or the worker loses history + can't resume.
    const client = newReconnectClient();
    await connectOpen(client, { threadId: 'thr_explicit' });

    expect((await reconnectUrl(client)).searchParams.get('thread_id')).toBe('thr_explicit');
  });

  it('explicit threadId + in-flight message → reconnect carries thread_id AND resume_message_id without a thread_info frame', async () => {
    const client = newReconnectClient();
    await connectOpen(client, { threadId: 'thr_explicit' });
    FakeWebSocket.last.frame({ type: 'message_created', messageId: 'msg_1' }); // no thread_info first

    const url = await reconnectUrl(client);
    expect(url.searchParams.get('thread_id')).toBe('thr_explicit');
    expect(url.searchParams.get('resume_message_id')).toBe('msg_1');
  });
});

describe('native requestId correlation', () => {
  it('sends caller IDs on chat and command helpers without generating IDs for legacy calls', async () => {
    const client = newClient();
    await connectOpen(client);
    client.sendMessage({ role: 'user', content: 'hello' }, { requestId: 'chat-1' });
    await client.sendMessageAsync({ role: 'user', content: 'next' }, { requestId: 'chat-2' });
    client.setContinuationMode('manual', { requestId: 'mode' });
    client.setTruncationStrategy(undefined, { requestId: 'truncation' });
    client.setMaxKbCharsPerChunk(500, { requestId: 'kb' });
    client.setSemanticAugmentation(true, { requestId: 'semantic' });
    client.continueRun('run-1', { requestId: 'continue' });
    client.cancelRun(undefined, { requestId: 'cancel' });
    client.send({ type: 'ping' });
    client.sendMessage({ role: 'user', content: 'legacy' });

    const frames = FakeWebSocket.last.sent.map(text => JSON.parse(text));
    expect(frames.slice(0, 8).map(frame => frame.requestId)).toEqual([
      'chat-1', 'chat-2', 'mode', 'truncation', 'kb', 'semantic', 'continue', 'cancel',
    ]);
    expect(frames[0]).toMatchObject({ type: 'message', content: 'hello' });
    expect(frames[3]).toEqual({ type: 'set_truncation_strategy', truncationStrategy: null, requestId: 'truncation' });
    expect(frames[6]).toEqual({ type: 'continue_run', runId: 'run-1', requestId: 'continue' });
    expect(frames[7]).toEqual({ type: 'cancel_run', requestId: 'cancel' });
    expect(FakeWebSocket.last.sent[8]).toBe('{"type":"ping"}');
    expect(frames[9]).not.toHaveProperty('requestId');
  });

  it('preserves a chat ID while waiting for the connection to open', async () => {
    const client = newClient();
    const opening = client.connect('agent', 'conn', 'tok');
    const sending = client.sendMessageAsync({ role: 'user', content: 'hello' }, { requestId: 'waiting' });
    expect(FakeWebSocket.last.sent).toEqual([]);
    FakeWebSocket.last.fire('open', {});
    await Promise.all([opening, sending]);
    expect(JSON.parse(FakeWebSocket.last.sent[0]).requestId).toBe('waiting');
  });

  it('retains IDs for raw send and sendAsync, including an empty string ID', async () => {
    const client = newClient();
    await connectOpen(client);
    client.send({ type: 'load_thread_history', threadId: 't1', requestId: '' });
    await client.sendAsync({ type: 'create_new_thread', requestId: 'create' });
    expect(FakeWebSocket.last.sent.map(text => JSON.parse(text))).toEqual([
      { type: 'load_thread_history', threadId: 't1', requestId: '' },
      { type: 'create_new_thread', requestId: 'create' },
    ]);
  });

  it.each([
    ['thread_history', 'threadHistory', { threadId: 't1', messages: [], messageCount: 0 }],
    ['chunk', 'chunk', { messageId: 'm1', content: 'text' }],
    ['typing', 'typing', { isTyping: false }],
    ['error', 'error', { error: 'Unknown command', code: 'UNKNOWN_TYPE' }],
    ['continuation_mode_updated', 'continuationModeUpdated', { data: { mode: 'manual' } }],
  ])('retains requestId when normalizing %s', async (type, event, payload) => {
    const client = newClient();
    await connectOpen(client);
    const listener = jest.fn();
    const raw = jest.fn();
    client.on(event as string, listener);
    client.on('rawFrame', raw);
    const frame = { type, ...payload as object, requestId: 'request-1' };
    FakeWebSocket.last.frame(frame);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request-1' }));
    expect(raw).toHaveBeenCalledWith(frame);
  });

  it('keeps out-of-order replies independent and does not stamp unsolicited events', async () => {
    const client = newClient();
    await connectOpen(client);
    const pongs = jest.fn();
    const acks = jest.fn();
    const errors = jest.fn();
    const raw = jest.fn();
    client.on('pong', pongs);
    client.on('requestAck', acks);
    client.on('error', errors);
    client.on('rawMessage', raw);
    FakeWebSocket.last.frame({ type: 'pong', requestId: '2' });
    FakeWebSocket.last.frame({ type: 'error', requestId: '1', error: 'refused' });
    FakeWebSocket.last.frame({ type: 'request_ack', requestId: '3', requestType: 'set_semantic_augmentation' });
    FakeWebSocket.last.frame({ type: 'pong' });
    expect(pongs.mock.calls.map(call => call[0])).toEqual([{ type: 'pong', requestId: '2' }, { type: 'pong' }]);
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ requestId: '1' }));
    expect(acks).toHaveBeenCalledWith({ type: 'request_ack', requestId: '3', requestType: 'set_semantic_augmentation' });
    expect(raw).toHaveBeenCalledTimes(3); // Preserve the old rawMessage path for pong/ack.
  });

  it('rejects correlated offline setters before changing local settings', async () => {
    const client = newClient();
    expect(() => client.setContinuationMode('manual', { requestId: 'mode' })).toThrow('must be connected');
    expect(() => client.setTruncationStrategy(undefined, { requestId: 'truncation' })).toThrow('must be connected');
    expect(() => client.setMaxKbCharsPerChunk(500, { requestId: 'kb' })).toThrow('must be connected');
    expect(() => client.setSemanticAugmentation(true, { requestId: 'semantic' })).toThrow('must be connected');
    await connectOpen(client);
    expect(new URL(FakeWebSocket.last.url).searchParams.get('continuation_mode')).toBe('auto');
    client.sendMessage({ role: 'user', content: 'hello' });
    expect(JSON.parse(FakeWebSocket.last.sent[0])).not.toHaveProperty('semanticAugmentation');
    expect(JSON.parse(FakeWebSocket.last.sent[0])).not.toHaveProperty('maxKbCharsPerChunk');
  });
});


describe('prompt/run correlation', () => {
  it('pairs overlapping requests when run_started arrives out of order', async () => {
    const client = newClient();
    await connectOpen(client, { threadId: 'thr_1' });
    const started = jest.fn();
    client.on('runStarted', started);
    client.sendMessage({ role: 'user', content: 'first' }, { requestId: 'first' });
    client.sendMessage({ role: 'user', content: 'second' }, { requestId: 'second' });
    for (const id of ['second', 'first']) {
      FakeWebSocket.last.frame({ type: 'run_started', threadId: 'thr_1',
        userMessageId: `msg_${id}`, runId: `run_${id}`, requestId: id });
    }
    expect(started.mock.calls.map(([frame]) => frame)).toEqual([
      { threadId: 'thr_1', userMessageId: 'msg_second', runId: 'run_second', requestId: 'second' },
      { threadId: 'thr_1', userMessageId: 'msg_first', runId: 'run_first', requestId: 'first' }
    ]);
    client.disconnect();
  });

  it('emits runStarted without a requestId and preserves reconnect provenance', async () => {
    const client = newClient();
    await connectOpen(client);
    const started = jest.fn();
    const state = jest.fn();
    client.on('runStarted', started);
    client.on('runState', state);
    FakeWebSocket.last.frame({ type: 'run_started', threadId: 'thr_1', userMessageId: 'msg_1', runId: 'run_1' });
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', userMessageId: 'msg_1', runStatus: 'failed', activeTool: null });
    expect(started).toHaveBeenCalledWith({ threadId: 'thr_1', userMessageId: 'msg_1', runId: 'run_1' });
    expect(state).toHaveBeenCalledWith({ runId: 'run_1', userMessageId: 'msg_1', runStatus: 'failed', activeTool: null });
    client.disconnect();
  });
});

describe('terminal and usage frames', () => {
  it('complete forwards the outcome the worker sent, and adds nothing it did not', async () => {
    const client = newClient();
    await connectOpen(client);
    const complete = jest.fn();
    client.on('complete', complete);
    FakeWebSocket.last.frame({
      type: 'complete', runId: 'run_1', failed: true, reason: 'expired',
      error: { code: 'expired', message: 'Run expired' },
    });
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_2', cancelled: true });
    FakeWebSocket.last.frame({ type: 'complete', messageId: 'msg_3' });
    expect(complete.mock.calls.map(([event]) => event)).toEqual([
      { messageId: undefined, runId: 'run_1', failed: true, reason: 'expired', error: { code: 'expired', message: 'Run expired' } },
      { messageId: undefined, runId: 'run_2', cancelled: true },
      { messageId: 'msg_3' },
    ]);
    expect(complete.mock.calls[2][0]).not.toHaveProperty('failed');
    client.disconnect();
  });

  it('tokenUsage reads the top-level frame fields', async () => {
    const client = newClient();
    await connectOpen(client);
    const usage = jest.fn();
    client.on('tokenUsage', usage);
    const call = { promptTokens: 1200, completionTokens: 300, cachedTokens: 1000 };
    const totals = { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 1000, llmCallCount: 1, models: ['m'] };
    FakeWebSocket.last.frame({ type: 'token_usage', runId: 'run_1', model: 'm', call, totals });
    expect(usage).toHaveBeenCalledWith({ runId: 'run_1', model: 'm', call, totals });
    client.disconnect();
  });

  it('names the started run on reconnect (resume_run_id), even with no message id yet', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'run_started', threadId: 'thr_new', userMessageId: 'msg_u', runId: 'run_1' });
    const url = await reconnectUrl(client);
    expect(url.searchParams.get('thread_id')).toBe('thr_new');
    expect(url.searchParams.get('resume_run_id')).toBe('run_1');
    expect(url.searchParams.has('resume_message_id')).toBe(false);
    client.disconnect();
  });

  it.each([
    ['complete', { type: 'complete', runId: 'run_1', messageId: 'msg_a' }],
    ['run_cancelled', { type: 'run_cancelled', runId: 'run_1' }],
    ['a terminal run_state', { type: 'run_state', runId: 'run_1', runStatus: 'failed', activeTool: null }],
  ])('stops naming the run once %s ends it', async (_case, ending) => {
    const client = newReconnectClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'run_started', threadId: 'thr_1', userMessageId: 'msg_u', runId: 'run_1' });
    FakeWebSocket.last.frame(ending);
    expect((await reconnectUrl(client)).searchParams.has('resume_run_id')).toBe(false);
    client.disconnect();
  });

  it('keeps naming its run when a different run ends', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'run_started', threadId: 'thr_1', userMessageId: 'msg_u', runId: 'run_1' });
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_other', runStatus: 'completed', activeTool: null });
    expect((await reconnectUrl(client)).searchParams.get('resume_run_id')).toBe('run_1');
    client.disconnect();
  });

  it('public connect to a new session does not name the old run', async () => {
    const client = newClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'run_started', threadId: 'thr_old', userMessageId: 'msg_u', runId: 'run_old' });
    const connectPromise = client.connect('agent_b', 'conn_b', 'tok_b', 'thr_new');
    expect(new URL(FakeWebSocket.last.url).searchParams.has('resume_run_id')).toBe(false);
    FakeWebSocket.last.fire('open', {});
    await connectPromise;
  });

  it('run_started persists its thread so a reconnect during the first reply reattaches', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    FakeWebSocket.last.frame({ type: 'run_started', threadId: 'thr_new', userMessageId: 'msg_u', runId: 'run_1' });
    FakeWebSocket.last.frame({ type: 'chunk', runId: 'run_1', messageId: 'msg_a', content: 'x' });
    const url = await reconnectUrl(client);
    expect(url.searchParams.get('thread_id')).toBe('thr_new');
    expect(url.searchParams.get('resume_message_id')).toBe('msg_a');
    client.disconnect();
  });
});

describe('runToCompletion', () => {
  const PROMPT = { role: 'user' as const, content: 'review this' };
  const TOTALS = { inputTokens: 5000, outputTokens: 800, cachedInputTokens: 4000, llmCallCount: 2, models: ['m'] };

  type Outcome = { ok: true; result: RunResult } | { ok: false; error: RunToCompletionError };

  /** Start a run and let the async send reach the socket. Settlement is captured, never thrown. */
  async function start(
    client: RagwallaWebSocket,
    options: { requestId?: string; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<{ outcome: Promise<Outcome> }> {
    const outcome = client
      .runToCompletion(PROMPT, { requestId: 'req-1', ...options })
      .then((result): Outcome => ({ ok: true, result }), (error): Outcome => ({ ok: false, error }));
    await flushMicrotasks();
    return { outcome };
  }

  function started(socket: FakeWebSocket, runId = 'run_1'): void {
    socket.frame({ type: 'message_received', requestId: 'req-1', threadId: 'thr_1', messageId: 'msg_u' });
    socket.frame({ type: 'run_started', requestId: 'req-1', threadId: 'thr_1', userMessageId: 'msg_u', runId });
  }

  function sentTypes(socket: FakeWebSocket): Array<Record<string, unknown>> {
    return socket.sent.map((raw) => JSON.parse(raw));
  }

  it('sends once with the requestId and resolves with the run\'s text and terminal usage', async () => {
    const client = newClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    const socket = FakeWebSocket.last;

    started(socket);
    socket.frame({ type: 'message_created', runId: 'run_1', messageId: 'msg_a' });
    socket.frame({ type: 'chunk', runId: 'run_1', messageId: 'msg_a', content: 'Hello' });
    socket.frame({ type: 'chunk', runId: 'run_other', messageId: 'msg_x', content: 'NOT OURS' });
    socket.frame({ type: 'complete', runId: 'run_other', messageId: 'msg_x' });
    socket.frame({ type: 'chunk', runId: 'run_1', messageId: 'msg_a', content: ', world' });
    socket.frame({ type: 'complete', runId: 'run_1', messageId: 'msg_a', usage: TOTALS });

    expect(await outcome).toEqual({
      ok: true,
      result: {
        runId: 'run_1', threadId: 'thr_1', userMessageId: 'msg_u', status: 'completed',
        text: 'Hello, world', messageIds: ['msg_a'],
        usage: { ...TOTALS, source: 'terminal' }, reconnected: false,
      },
    });
    const sent = sentTypes(socket);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'message', requestId: 'req-1', content: 'review this' });
  });

  it('falls back to the last token_usage totals, and reports no usage rather than zero', async () => {
    const client = newClient();
    await connectOpen(client);
    const first = await start(client);
    started(FakeWebSocket.last);
    FakeWebSocket.last.frame({ type: 'token_usage', runId: 'run_1', call: {}, totals: { ...TOTALS, llmCallCount: 1 } });
    FakeWebSocket.last.frame({ type: 'token_usage', runId: 'run_1', call: {}, totals: TOTALS });
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_1' });
    const withStream = await first.outcome;
    expect(withStream.ok && withStream.result.usage).toEqual({ ...TOTALS, source: 'stream' });

    const second = await start(client, { requestId: 'req-2' });
    FakeWebSocket.last.frame({ type: 'run_started', requestId: 'req-2', threadId: 'thr_1', runId: 'run_2' });
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_2' });
    const without = await second.outcome;
    expect(without.ok && without.result).not.toHaveProperty('usage');
  });

  it('reports failed and cancelled outcomes from complete', async () => {
    const client = newClient();
    await connectOpen(client);
    const failed = await start(client);
    started(FakeWebSocket.last);
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_1', failed: true, reason: 'expired', error: { code: 'expired' } });
    expect(await failed.outcome).toMatchObject({
      ok: true, result: { status: 'failed', reason: 'expired', error: { code: 'expired' } },
    });

    const cancelled = await start(client, { requestId: 'req-2' });
    FakeWebSocket.last.frame({ type: 'run_started', requestId: 'req-2', runId: 'run_2' });
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_2', cancelled: true });
    expect(await cancelled.outcome).toMatchObject({ ok: true, result: { status: 'cancelled' } });
  });

  it('treats a run-scoped error as failed and cancels the run in case it is still executing', async () => {
    const client = newClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);
    FakeWebSocket.last.frame({ type: 'error', runId: 'run_1', error: 'model exploded' });
    expect(await outcome).toMatchObject({ ok: true, result: { status: 'failed', error: 'model exploded' } });
    expect(sentTypes(FakeWebSocket.last)[1]).toEqual({ type: 'cancel_run', runId: 'run_1' });
  });

  it('takes terminal usage from a run-scoped error frame', async () => {
    const client = newClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);
    FakeWebSocket.last.frame({ type: 'token_usage', runId: 'run_1', call: {}, totals: { ...TOTALS, llmCallCount: 1 } });
    FakeWebSocket.last.frame({ type: 'error', runId: 'run_1', error: 'boom', usage: TOTALS });
    const result = await outcome;
    expect(result.ok && result.result.usage).toEqual({ ...TOTALS, source: 'terminal' });
  });

  it('rejects a refusal before any run exists, and cancels nothing', async () => {
    const client = newClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    FakeWebSocket.last.frame({ type: 'error', requestId: 'req-2', error: 'someone else' });
    FakeWebSocket.last.frame({ type: 'error', requestId: 'req-1', error: 'This agent has been disabled.' });
    const result = await outcome;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(RunToCompletionError);
    expect(result.error.code).toBe('request_failed');
    expect(result.error.message).toBe('This agent has been disabled.');
    expect(result.error.details).toEqual({
      requestId: 'req-1', serverError: 'This agent has been disabled.', cancelRequested: false,
    });
    expect(FakeWebSocket.last.sent).toHaveLength(1);
  });

  it('on timeout cancels the named run', async () => {
    const client = newClient();
    await connectOpen(client);
    const { outcome } = await start(client, { timeoutMs: 5 });
    started(FakeWebSocket.last);
    const result = await outcome;
    expect(result).toMatchObject({ ok: false, error: { code: 'timeout', details: { runId: 'run_1', cancelRequested: true } } });
    expect(sentTypes(FakeWebSocket.last)[1]).toEqual({ type: 'cancel_run', runId: 'run_1' });
  });

  it('on timeout before run_started sends no cancel — an unnamed cancel_run targets whatever run is current', async () => {
    const client = newClient();
    await connectOpen(client);
    const { outcome } = await start(client, { timeoutMs: 5 });
    FakeWebSocket.last.frame({ type: 'message_received', requestId: 'req-1', threadId: 'thr_1', messageId: 'msg_u' });
    const result = await outcome;
    expect(result).toMatchObject({
      ok: false, error: { code: 'timeout', details: { userMessageId: 'msg_u', cancelRequested: false } },
    });
    expect(result.ok || result.error.details).not.toHaveProperty('runId');
    expect(FakeWebSocket.last.sent).toHaveLength(1);
  });

  it('abort cancels the run; an already-aborted signal sends nothing', async () => {
    const client = newClient();
    await connectOpen(client);
    const controller = new AbortController();
    const { outcome } = await start(client, { signal: controller.signal });
    started(FakeWebSocket.last);
    controller.abort();
    expect(await outcome).toMatchObject({ ok: false, error: { code: 'aborted', details: { cancelRequested: true } } });
    expect(sentTypes(FakeWebSocket.last)[1]).toEqual({ type: 'cancel_run', runId: 'run_1' });

    const before = FakeWebSocket.last.sent.length;
    const again = await start(client, { requestId: 'req-2', signal: controller.signal });
    expect(await again.outcome).toMatchObject({ ok: false, error: { code: 'aborted' } });
    expect(FakeWebSocket.last.sent).toHaveLength(before);
  });

  it('survives a reconnect: resume replaces the message text and a terminal run_state ends the run', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);
    FakeWebSocket.last.frame({ type: 'chunk', runId: 'run_1', messageId: 'msg_a', content: 'Hel' });

    const url = await reconnectUrl(client);
    expect(url.searchParams.get('thread_id')).toBe('thr_1');
    expect(url.searchParams.get('resume_message_id')).toBe('msg_a');
    // The worker's reconnect batch: run_state, then message_created, then resume.
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'completed', userMessageId: 'msg_u', activeTool: null });
    FakeWebSocket.last.frame({ type: 'message_created', runId: 'run_1', messageId: 'msg_a' });
    FakeWebSocket.last.frame({ type: 'resume', runId: 'run_1', messageId: 'msg_a', content: 'Hello, world' });

    expect(await outcome).toMatchObject({
      ok: true, result: { status: 'completed', text: 'Hello, world', reconnected: true },
    });
    // Never resent: the first socket carried the only message frame, the second none.
    expect(FakeWebSocket.instances.flatMap((s) => s.sent.map((raw) => JSON.parse(raw).type))).toEqual(['message']);
  });

  it('learns the outcome of a run that finished while it was away, before any message arrived', async () => {
    // Dropped after run_started, before message_created: the only name for the run is its id.
    const client = newReconnectClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);
    const url = await reconnectUrl(client);
    expect(url.searchParams.get('resume_run_id')).toBe('run_1');
    expect(url.searchParams.has('resume_message_id')).toBe(false);
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'completed', usage: TOTALS });
    FakeWebSocket.last.frame({ type: 'resume', runId: 'run_1', messageId: 'msg_a', content: 'done' });
    const result = await outcome;
    expect(result).toMatchObject({ ok: true, result: { status: 'completed', text: 'done', reconnected: true } });
    expect(result.ok && result.result.usage).toEqual({ ...TOTALS, source: 'terminal' });
    client.disconnect();
  });

  it('settles on the durable totals a terminal run_state reports after a reconnect', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);
    FakeWebSocket.last.frame({ type: 'token_usage', runId: 'run_1', call: {}, totals: { ...TOTALS, llmCallCount: 1 } });
    await reconnectUrl(client);
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'completed', usage: TOTALS });
    FakeWebSocket.last.frame({ type: 'resume', runId: 'run_1', messageId: 'msg_a', content: 'done' });
    const result = await outcome;
    expect(result.ok && result.result.usage).toEqual({ ...TOTALS, source: 'terminal' });
    client.disconnect();
  });

  it('treats an in-progress run_state\'s totals as the stream so far, not final', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);
    await reconnectUrl(client);
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'in_progress', usage: TOTALS });
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_1' });
    const result = await outcome;
    expect(result.ok && result.result.usage).toEqual({ ...TOTALS, source: 'stream' });
    client.disconnect();
  });

  it('adopts the run from run_state when the drop lost run_started', async () => {
    const client = newReconnectClient();
    await connectOpen(client, { threadId: 'thr_1' });
    const { outcome } = await start(client);
    FakeWebSocket.last.frame({ type: 'message_received', requestId: 'req-1', threadId: 'thr_1', messageId: 'msg_u' });

    await reconnectUrl(client);
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_someone', runStatus: 'in_progress', userMessageId: 'msg_other' });
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'in_progress', userMessageId: 'msg_u' });
    FakeWebSocket.last.frame({ type: 'chunk', runId: 'run_1', messageId: 'msg_a', content: 'done' });
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_1', messageId: 'msg_a' });

    expect(await outcome).toMatchObject({ ok: true, result: { runId: 'run_1', text: 'done', status: 'completed' } });
  });

  it('a completed run_state followed by any other frame for the run settles without waiting', async () => {
    const client = newClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);
    FakeWebSocket.last.frame({ type: 'chunk', runId: 'run_1', messageId: 'msg_a', content: 'partial' });
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'completed' });
    let done = false;
    void outcome.then(() => { done = true; });
    FakeWebSocket.last.frame({ type: 'typing', runId: 'run_1', isTyping: false });
    await flushMicrotasks();
    // Settled by the frame itself, not by the 1s settle-window fallback.
    expect(done).toBe(true);
    expect(await outcome).toMatchObject({ ok: true, result: { status: 'completed', text: 'partial' } });
  });

  it('a completed run_state with no text to follow settles after the settle window', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    try {
      const client = newClient();
      const connecting = client.connect('agent', 'conn', 'tok');
      FakeWebSocket.last.fire('open', {});
      await connecting;
      const { outcome } = await start(client);
      started(FakeWebSocket.last);
      FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'completed' });
      let done = false;
      void outcome.then(() => { done = true; });
      jest.advanceTimersByTime(999);
      await flushMicrotasks();
      expect(done).toBe(false);
      jest.advanceTimersByTime(1);
      expect(await outcome).toMatchObject({ ok: true, result: { status: 'completed', text: '' } });
    } finally {
      jest.useRealTimers();
    }
  });

  it('maps failed and expired run_state to failed at once', async () => {
    const client = newClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'expired' });
    expect(await outcome).toMatchObject({ ok: true, result: { status: 'failed', reason: 'expired' } });
  });

  it('rejects connection_lost when the socket closes and no reconnect is coming', async () => {
    const client = newClient(); // reconnectAttempts: 0
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);
    FakeWebSocket.last.fire('close', { code: 1006, reason: 'gone' });
    expect(await outcome).toMatchObject({
      ok: false, error: { code: 'connection_lost', details: { runId: 'run_1', cancelRequested: false } },
    });
  });

  it('rejects connection_lost when disconnect() is called while waiting', async () => {
    const client = newClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);
    client.disconnect();
    expect(await outcome).toMatchObject({ ok: false, error: { code: 'connection_lost' } });
  });

  it('removes its listeners once settled', async () => {
    const client = newClient();
    await connectOpen(client);
    const listeners = (client as any).listeners as Map<string, Set<unknown>>;
    const sizes = () => ['rawFrame', 'disconnected', 'connected', 'reconnectFailed']
      .map((event) => listeners.get(event)?.size ?? 0);
    const { outcome } = await start(client);
    expect(sizes()).toEqual([1, 1, 1, 1]);
    started(FakeWebSocket.last);
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_1' });
    await outcome;
    expect(sizes()).toEqual([0, 0, 0, 0]);
    expect((client as any).runWaiters.size).toBe(0);
  });

  it('refuses a second concurrent wait on the same socket, and allows one after the first settles', async () => {
    const client = newClient();
    await connectOpen(client);
    const first = await start(client);
    await expect(client.runToCompletion(PROMPT, { requestId: 'req-2' })).rejects.toThrow('one run per socket');
    expect(FakeWebSocket.last.sent).toHaveLength(1);
    started(FakeWebSocket.last);
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_1' });
    expect(await first.outcome).toMatchObject({ ok: true });
    const second = await start(client, { requestId: 'req-2' });
    FakeWebSocket.last.frame({ type: 'run_started', requestId: 'req-2', runId: 'run_2' });
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_2' });
    expect(await second.outcome).toMatchObject({ ok: true, result: { runId: 'run_2' } });
  });

  it('holds the socket: no other chat message can be sent while waiting, by any send path', async () => {
    const client = newClient();
    await connectOpen(client);
    const { outcome } = await start(client);
    started(FakeWebSocket.last);

    expect(() => client.sendMessage(PROMPT)).toThrow('rebind');
    await expect(client.sendMessageAsync(PROMPT)).rejects.toThrow('rebind');
    expect(() => client.send({ type: 'chat_message', content: 'x' })).toThrow('rebind');
    await expect(client.sendAsync({ type: 'message', content: 'x' })).rejects.toThrow('rebind');
    // Frames that do not start a run still pass.
    client.send({ type: 'ping' });
    expect(sentTypes(FakeWebSocket.last).map((f) => f.type)).toEqual(['message', 'ping']);

    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_1' });
    await outcome;
    client.sendMessage(PROMPT);
    expect(sentTypes(FakeWebSocket.last).map((f) => f.type)).toEqual(['message', 'ping', 'message']);
  });

  it('reattaches after a drop between message_received and run_started on a new thread', async () => {
    const client = newReconnectClient();
    await connectOpen(client); // no thread yet: this message creates one
    const { outcome } = await start(client);
    FakeWebSocket.last.frame({ type: 'message_received', requestId: 'req-1', threadId: 'thr_new', messageId: 'msg_u' });

    const url = await reconnectUrl(client);
    expect(url.searchParams.get('thread_id')).toBe('thr_new');
    FakeWebSocket.last.frame({ type: 'run_state', runId: 'run_1', runStatus: 'in_progress', userMessageId: 'msg_u' });
    FakeWebSocket.last.frame({ type: 'complete', runId: 'run_1' });
    expect(await outcome).toMatchObject({ ok: true, result: { runId: 'run_1', threadId: 'thr_new' } });
  });

  it('rejects at once when the socket drops after sending and before any acknowledgement', async () => {
    const client = newReconnectClient();
    await connectOpen(client, { threadId: 'thr_1' });
    const { outcome } = await start(client);
    expect(FakeWebSocket.last.sent).toHaveLength(1);
    FakeWebSocket.last.fire('close', { code: 1006, reason: 'drop' });
    const result = await outcome;
    expect(result).toMatchObject({ ok: false, error: { code: 'connection_lost', details: { cancelRequested: false } } });
    expect(result.ok || result.error.message).toContain('cannot be identified');
    client.disconnect(); // stop the pending auto-reconnect from leaking into the next test
  });

  it('reports a failure to open the socket as connection_lost, not a server refusal', async () => {
    const client = newClient(); // connect() never called: nothing to reconnect to
    const { outcome } = await start(client);
    expect(await outcome).toMatchObject({ ok: false, error: { code: 'connection_lost' } });
  });

  it('sends nothing when aborted while waiting for the socket to reconnect', async () => {
    const client = newReconnectClient();
    await connectOpen(client);
    const before = FakeWebSocket.instances.length;
    FakeWebSocket.last.fire('close', { code: 1006, reason: 'drop' });
    await flushTimers(); // the auto-reconnect socket exists but has not opened
    expect(FakeWebSocket.instances.length).toBe(before + 1);

    const controller = new AbortController();
    const { outcome } = await start(client, { signal: controller.signal });
    controller.abort();
    expect(await outcome).toMatchObject({ ok: false, error: { code: 'aborted' } });

    FakeWebSocket.last.fire('open', {});
    await flushTimers();
    expect(FakeWebSocket.instances.flatMap((s) => s.sent)).toEqual([]);
  });

  it('requires a requestId', async () => {
    const client = newClient();
    await connectOpen(client);
    await expect(client.runToCompletion(PROMPT, { requestId: '' })).rejects.toThrow('requires a requestId');
    expect(FakeWebSocket.last.sent).toHaveLength(0);
  });
});
