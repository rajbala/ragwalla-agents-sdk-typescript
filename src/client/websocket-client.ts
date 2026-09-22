import {
  WebSocketMessage,
  ChatMessage,
  TruncationStrategy,
  isTerminalRunStatus,
  type CompleteEvent,
  type LlmCallUsage,
  type RunOutcome,
  type RunResult,
  type RunUsageTotals,
  type TokenUsageEvent,
} from '../types/index.js';

// Universal WebSocket interface
interface UniversalWebSocket {
  send(data: string): void;
  close(): void;
  readyState: number;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

type UniversalWebSocketListener = (event: any) => void;

interface WorkersWebSocket extends UniversalWebSocket {
  accept(): void;
}

function isWorkersRuntime(): boolean {
  return typeof (globalThis as any).WebSocketPair !== 'undefined';
}

function toWorkersFetchURL(url: string): string {
  return url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createWorkersSocket(url: string): UniversalWebSocket {
  const httpUrl = toWorkersFetchURL(url);
  const listeners: Record<string, Set<UniversalWebSocketListener>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };

  const dispatch = (type: string, event: any): void => {
    for (const listener of listeners[type] ?? []) {
      try {
        listener(event);
      } catch (error) {
        // One listener must not block others (browser EventTarget semantics), but the
        // error is surfaced rather than swallowed — matching emit().
        console.error('Error in WebSocket transport listener:', error);
      }
    }
  };

  let socket: WorkersWebSocket | null = null;
  let closedEarly = false;

  (async () => {
    let response: Response;
    try {
      response = await fetch(httpUrl, { headers: { Upgrade: 'websocket' } });
    } catch (error) {
      dispatch('error', { message: errorMessage(error) });
      dispatch('close', { code: 1006, reason: 'fetch failed', wasClean: false });
      return;
    }

    const upgradedSocket = (response as Response & { webSocket?: WorkersWebSocket }).webSocket;
    if (response.status !== 101 || !upgradedSocket) {
      const status = `HTTP ${response.status}`;
      dispatch('error', {
        message: response.status === 101
          ? 'expected 101 upgrade with webSocket'
          : `expected 101 upgrade, got ${status}`,
      });
      dispatch('close', {
        code: 1006,
        reason: upgradedSocket ? `unexpected status (${status})` : `no webSocket (${status})`,
        wasClean: false,
      });
      return;
    }

    try {
      upgradedSocket.accept();
    } catch (error) {
      dispatch('error', { message: errorMessage(error) });
      dispatch('close', { code: 1006, reason: 'accept failed', wasClean: false });
      return;
    }

    socket = upgradedSocket;
    if (closedEarly) {
      try {
        upgradedSocket.close();
      } catch {
        // Ignore close errors during early shutdown.
      }
      return;
    }

    upgradedSocket.addEventListener('message', (event: any) => dispatch('message', event));
    upgradedSocket.addEventListener('close', (event: any) => dispatch('close', event));
    upgradedSocket.addEventListener('error', (event: any) => dispatch('error', event));

    dispatch('open', {});
  })();

  return {
    send: (data: string) => {
      if (!socket) {
        // Unreachable via the public API — every send path gates on readyState === 1,
        // which this wrapper reports only once `socket` is set. Fail loud if that
        // invariant is ever broken, rather than silently dropping the message.
        throw new Error('Cannot send: the Workers WebSocket upgrade has not completed');
      }
      socket.send(data);
    },
    close: () => {
      closedEarly = true;
      if (socket) {
        try {
          socket.close();
        } catch {
          // Ignore close errors to match browser WebSocket semantics.
        }
      }
    },
    get readyState() {
      if (socket) {
        return socket.readyState;
      }
      return closedEarly ? 3 : 0;
    },
    addEventListener: (type: string, listener: UniversalWebSocketListener) => {
      if (!listeners[type]) {
        listeners[type] = new Set();
      }
      listeners[type].add(listener);
    },
    removeEventListener: (type: string, listener: UniversalWebSocketListener) => {
      listeners[type]?.delete(listener);
    }
  };
}

// WebSocket factory function that works in both Node.js and Workers
function createWebSocket(url: string): UniversalWebSocket {
  if (isWorkersRuntime()) {
    return createWorkersSocket(url);
  }

  // Everywhere else — browsers, Deno, Bun, React Native, and Node >= 22 — exposes the
  // standard global WebSocket (WHATWG: CONNECTING -> 'open' -> OPEN). One path serves them
  // all; no Node-only `ws` dependency, so the browser/worker bundles stay clean.
  if (typeof WebSocket !== 'undefined') {
    return new WebSocket(url) as UniversalWebSocket;
  }

  // No global WebSocket: Node < 22 without a polyfill, or a runtime with no outbound
  // WebSocket. Fail loud rather than hang — there is nothing to connect with.
  throw new Error(
    'No global WebSocket is available in this runtime. The Ragwalla SDK requires a standard ' +
    'WebSocket (browsers, Cloudflare Workers, Deno, Bun, or Node >= 22). On older Node, ' +
    'upgrade to Node 22+ or assign a WebSocket implementation to globalThis.WebSocket.'
  );
}

/** Optional native request correlation. IDs are chosen by the caller, not generated by the SDK. */
export interface WebSocketRequestOptions {
  /** Unique among outstanding requests on this socket. A counter or UUID is sufficient. */
  requestId?: string;
}

export interface RunToCompletionOptions {
  /**
   * Required. Correlates this send with its `message_received`/`run_started` replies, which
   * is how the run's id is learned. Unique among outstanding requests on this socket.
   */
  requestId: string;
  /** Give up after this many milliseconds. The run is cancelled when its id is known. */
  timeoutMs?: number;
  /** Stop waiting. The run is cancelled when its id is known. */
  signal?: AbortSignal;
}

export type RunToCompletionErrorCode =
  /** The server refused the message before a run existed (e.g. a disabled agent). */
  | 'request_failed'
  | 'timeout'
  | 'aborted'
  /** The socket closed and will not reconnect; the run's outcome is unknown. */
  | 'connection_lost';

/**
 * `runToCompletion` could not observe the run's outcome. Distinct from a run that
 * FAILED — that resolves with `status: 'failed'`, because the server reported it.
 */
export class RunToCompletionError extends Error {
  constructor(
    readonly code: RunToCompletionErrorCode,
    message: string,
    readonly details: {
      requestId: string;
      runId?: string;
      threadId?: string;
      userMessageId?: string;
      /** The error frame's payload, for `request_failed`. */
      serverError?: unknown;
      /**
       * True when a `cancel_run` for `runId` was sent. It is a request: the run may
       * already have finished, and a lost socket cannot carry it at all.
       */
      cancelRequested: boolean;
    },
  ) {
    super(message);
    this.name = 'RunToCompletionError';
  }
}

/**
 * After a reconnect, a terminal `run_state` is followed in the same synchronous server batch
 * by the run's `message_created`/`resume` frames, which carry its final text. How long to
 * wait for them before settling with the text already seen.
 */
const RUN_STATE_SETTLE_MS = 1_000;

export interface WebSocketConfig {
  baseURL: string; // Required - must be https://.../v1 or wss://.../v1
  reconnectAttempts?: number;
  reconnectDelay?: number;
  debug?: boolean; // Enable debug logging
  continuationMode?: 'auto' | 'manual';
  /**
   * Optional hook used before SDK-driven reconnects. Durable Object proxies can
   * mint a fresh short-lived Ragwalla WebSocket token here instead of reusing the
   * token from the original connect() call.
   */
  getReconnectToken?: WebSocketReconnectTokenProvider;
  truncationStrategy?: TruncationStrategy;
  /** Max chars per KB search result chunk sent to the LLM */
  maxKbCharsPerChunk?: number;
  /** When true, the agent will embed the current user message and merge semantically relevant past messages before applying truncation */
  semanticAugmentation?: boolean;
}

export type WebSocketReconnectReason = 'auto_reconnect' | 'send';

export interface WebSocketReconnectContext {
  agentId: string;
  connectionId: string;
  threadId?: string;
  resumeMessageId?: string;
  previousToken?: string;
  attempt: number;
  reason: WebSocketReconnectReason;
}

export type WebSocketReconnectTokenProvider = (
  context: WebSocketReconnectContext
) => string | Promise<string>;

export class RagwallaWebSocket {
  private ws: UniversalWebSocket | null = null;
  private baseURL!: string; // Assigned in validateAndSetWebSocketURL
  private reconnectAttempts: number;
  private reconnectDelay: number;
  private currentAttempts = 0;
  private isManuallyDisconnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectInFlight: Promise<void> | null = null;
  private reconnectGeneration = 0;
  private connectAttemptId = 0;
  private activeConnectAttemptId: number | null = null;
  private activeConnectPromise: Promise<void> | null = null;
  private activeConnectReject: ((error: Error) => void) | null = null;
  private listeners: Map<string, Set<Function>> = new Map();
  private eventHandlers: Map<string, (event: any) => void> = new Map();
  private debug: boolean;
  private continuationMode: 'auto' | 'manual';
  private getReconnectToken?: WebSocketReconnectTokenProvider;
  private truncationStrategy?: TruncationStrategy;
  private maxKbCharsPerChunk?: number;
  private semanticAugmentation?: boolean;
  // Reconnect state - persisted across connections for transparent reattach
  private lastConnectAgentId: string | null = null;
  private lastConnectConnectionId: string | null = null;
  private lastConnectToken: string | null = null;
  private activeThreadId: string | null = null;
  // The in-flight assistant message id (the bubble currently streaming). Sent as
  // resume_message_id on reconnect so the worker resumes the right message (§6a).
  private activeMessageId: string | null = null;
  // Pending runToCompletion() waits. disconnect() removes the socket's handlers before
  // closing it, so no 'disconnected' event reaches them — it must end them directly.
  private runWaiters: Set<() => void> = new Set();

  constructor(config: WebSocketConfig) {
    this.validateAndSetWebSocketURL(config.baseURL);
    this.reconnectAttempts = config.reconnectAttempts ?? 3;
    this.reconnectDelay = config.reconnectDelay ?? 1000;
    this.debug = config.debug || false;
    this.continuationMode = config.continuationMode === 'manual' ? 'manual' : 'auto';
    this.getReconnectToken = config.getReconnectToken;
    this.truncationStrategy = config.truncationStrategy;
    this.maxKbCharsPerChunk = config.maxKbCharsPerChunk;
    this.semanticAugmentation = config.semanticAugmentation;
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    if (!this.debug) return;
    
    const timestamp = new Date().toISOString();
    const prefix = `[Ragwalla WebSocket ${timestamp}]`;
    
    if (data) {
      console[level](`${prefix} ${message}`, data);
    } else {
      console[level](`${prefix} ${message}`);
    }
  }

  private validateAndSetWebSocketURL(baseURL: string): void {
    if (!baseURL) {
      throw new Error('WebSocket baseURL is required');
    }

    // Convert https:// to wss:// if needed and validate the resulting URL.
    let wsURL = baseURL;
    if (baseURL.startsWith('https://')) {
      wsURL = baseURL.replace('https://', 'wss://');
    }

    let parsed: URL;
    try {
      parsed = new URL(wsURL);
    } catch {
      throw new Error(
        'WebSocket baseURL must be a valid absolute URL ending in /v1\n' +
        `Received: ${wsURL}`
      );
    }

    if (parsed.protocol !== 'wss:') {
      throw new Error(
        'WebSocket baseURL must use wss or https and end in /v1\n' +
        `Received: ${wsURL}`
      );
    }

    if ((parsed.pathname !== '/v1' && parsed.pathname !== '/v1/') || parsed.search || parsed.hash) {
      throw new Error(
        'WebSocket baseURL must be a valid absolute URL ending in /v1\n' +
        `Received: ${wsURL}`
      );
    }

    // Remove trailing slash if present
    this.baseURL = wsURL.replace(/\/$/, '');
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private invalidatePendingReconnects(): void {
    this.reconnectGeneration++;
    this.reconnectInFlight = null;
    this.clearReconnectTimer();
  }

  private removeSocketEventHandlers(socket: UniversalWebSocket): void {
    this.eventHandlers.forEach((handler, event) => {
      socket.removeEventListener(event, handler);
    });
    this.eventHandlers.clear();
  }

  private closeCurrentSocket(): void {
    if (!this.ws) return;

    const socket = this.ws;
    this.removeSocketEventHandlers(socket);
    try {
      socket.close();
    } catch {
      // Ignore close errors to match browser WebSocket semantics.
    }
    if (this.ws === socket) {
      this.ws = null;
    }
  }

  private cancelActiveConnect(reason: string): void {
    const rejectActiveConnect = this.activeConnectReject;
    if (rejectActiveConnect) {
      rejectActiveConnect(new Error(reason));
    }
  }

  private getActiveConnectPromise(): Promise<void> | null {
    if (this.ws?.readyState === 0 && this.activeConnectPromise) { // 0 = CONNECTING
      return this.activeConnectPromise;
    }
    return null;
  }

  private resetLogicalSession(threadId?: string): void {
    this.activeThreadId = threadId ?? null;
    this.activeMessageId = null;
  }

  private getStoredConnectionParams(): { agentId: string; connectionId: string } {
    if (!this.lastConnectAgentId || !this.lastConnectConnectionId) {
      throw new Error('Cannot reconnect before connect() has been called');
    }
    return {
      agentId: this.lastConnectAgentId,
      connectionId: this.lastConnectConnectionId,
    };
  }

  private async resolveReconnectToken(reason: WebSocketReconnectReason): Promise<string> {
    const { agentId, connectionId } = this.getStoredConnectionParams();
    const previousToken = this.lastConnectToken ?? undefined;

    if (this.getReconnectToken) {
      const token = await this.getReconnectToken({
        agentId,
        connectionId,
        threadId: this.activeThreadId ?? undefined,
        resumeMessageId: this.activeMessageId ?? undefined,
        previousToken,
        attempt: this.currentAttempts,
        reason,
      });
      if (!token) {
        throw new Error('getReconnectToken returned an empty token');
      }
      return token;
    }

    if (!previousToken) {
      throw new Error('Cannot reconnect without a token or getReconnectToken hook');
    }
    return previousToken;
  }

  private reconnectWithLatestToken(reason: WebSocketReconnectReason): Promise<void> {
    if (this.reconnectInFlight) {
      return this.reconnectInFlight;
    }

    const { agentId, connectionId } = this.getStoredConnectionParams();
    const generation = this.reconnectGeneration;
    const reconnectPromise = (async () => {
      const token = await this.resolveReconnectToken(reason);
      if (this.isManuallyDisconnected || generation !== this.reconnectGeneration) {
        throw new Error('Reconnect cancelled');
      }
      this.lastConnectToken = token;
      await this.connectInternal(agentId, connectionId, token);
    })();

    let trackedPromise: Promise<void>;
    trackedPromise = reconnectPromise.finally(() => {
      if (this.reconnectInFlight === trackedPromise) {
        this.reconnectInFlight = null;
      }
    });

    this.reconnectInFlight = trackedPromise;
    return trackedPromise;
  }

  private scheduleReconnect(): void {
    if (
      this.isManuallyDisconnected ||
      this.isConnected() ||
      this.reconnectTimer ||
      this.reconnectInFlight ||
      this.currentAttempts >= this.reconnectAttempts
    ) {
      return;
    }

    // Exponential backoff with a 30s cap + jitter (was linear base*attempts, which made the
    // whole default budget ~10s — routinely exhausted by an ordinary deploy blip). With the
    // same attempt counts the budget now spans meaningfully longer, and jitter avoids
    // thundering-herd reconnects after a server restart.
    const backoff =
      this.currentAttempts === 0
        ? 0
        : Math.min(this.reconnectDelay * 2 ** (this.currentAttempts - 1), 30_000);
    // Jitter only when there IS a backoff: a zero base (tests / explicit no-delay
    // configs) must stay exactly zero.
    const delay = backoff === 0 ? 0 : backoff + Math.floor(Math.random() * 250);
    this.log('info', `Attempting reconnection ${this.currentAttempts + 1}/${this.reconnectAttempts} in ${delay}ms`);
    // Tell the consumer a retry loop is ACTIVE — previously only 'disconnected' and the
    // terminal 'reconnectFailed' were observable, so a relay could not distinguish
    // "SDK is on it" from "SDK went silent".
    this.emit('reconnecting', {
      attempt: this.currentAttempts + 1,
      maxAttempts: this.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isManuallyDisconnected || this.isConnected()) {
        return;
      }

      this.currentAttempts++;
      this.reconnectWithLatestToken('auto_reconnect').catch((error) => {
        if (
          this.isManuallyDisconnected ||
          error?.message === 'Reconnect cancelled' ||
          error?.message === 'WebSocket connection superseded'
        ) {
          return;
        }
        this.log('error', 'Reconnection attempt failed', { error });
        if (this.currentAttempts >= this.reconnectAttempts) {
          this.log('error', 'All reconnection attempts failed', { attempts: this.currentAttempts });
          this.emit('reconnectFailed', { attempts: this.currentAttempts });
        } else {
          this.scheduleReconnect();
        }
      });
    }, delay);
  }

  private emitRawFrame(messageText: string): void {
    const frame = JSON.parse(messageText);
    this.emit('rawFrame', frame);
    this.emit('frame', frame);
  }

  private buildMessagePayload(message: ChatMessage, options?: WebSocketRequestOptions): Record<string, any> {
    return {
      type: 'message',
      ...(options?.requestId !== undefined && { requestId: options.requestId }),
      content: message.content,
      role: message.role,
      timestamp: new Date().toISOString(),
      ...(message.metadata && { metadata: message.metadata }),
      ...(this.truncationStrategy && { truncationStrategy: this.truncationStrategy }),
      ...(this.maxKbCharsPerChunk !== undefined && { maxKbCharsPerChunk: this.maxKbCharsPerChunk }),
      ...(this.semanticAugmentation !== undefined && { semanticAugmentation: this.semanticAugmentation }),
    };
  }

  private sendPayload(payload: any, context: any): void {
    if (!this.ws || this.ws.readyState !== 1) { // 1 = OPEN
      this.log('error', 'Cannot send data - WebSocket not connected', {
        readyState: this.ws?.readyState,
        data: context
      });
      throw new Error('WebSocket is not connected');
    }

    this.ws.send(JSON.stringify(payload));
  }

  private async ensureConnectedForSend(): Promise<void> {
    if (this.isConnected()) {
      return;
    }
    const activeConnect = this.getActiveConnectPromise();
    if (activeConnect) {
      await activeConnect;
      if (this.isConnected()) {
        return;
      }
    }
    if (this.isManuallyDisconnected) {
      throw new Error('WebSocket is manually disconnected');
    }

    this.clearReconnectTimer();
    await this.reconnectWithLatestToken('send');

    if (!this.isConnected()) {
      throw new Error('WebSocket is not connected after reconnect');
    }
  }

  /**
   * Connect to an agent's WebSocket endpoint
   * @param agentId - The agent to connect to
   * @param connectionId - Connection identifier (used for DO routing)
   * @param token - Authentication token
   * @param threadId - Optional Ragwalla thread ID. If provided, resumes that thread. If omitted, a new thread is created on first message.
   */
  async connect(agentId: string, connectionId: string, token: string, threadId?: string, resumeMessageId?: string): Promise<void> {
    this.invalidatePendingReconnects();
    this.cancelActiveConnect('WebSocket connection superseded');
    this.closeCurrentSocket();
    this.resetLogicalSession(threadId);
    // Optional resume seed for callers REBUILDING a connection around an in-flight message
    // (e.g. a relay whose previous socket exhausted its retries mid-stream). Must be applied
    // AFTER resetLogicalSession — which clears activeMessageId — so the first connect URL
    // carries resume_message_id and the server resumes instead of truncating the turn.
    if (resumeMessageId && threadId) {
      this.activeMessageId = resumeMessageId;
    }
    this.isManuallyDisconnected = false;
    return this.connectInternal(agentId, connectionId, token, threadId);
  }

  private async connectInternal(agentId: string, connectionId: string, token: string, threadId?: string): Promise<void> {
    this.clearReconnectTimer();
    this.lastConnectAgentId = agentId;
    this.lastConnectConnectionId = connectionId;
    this.lastConnectToken = token;
    // Persist an explicitly-provided thread id immediately. Public connect() has
    // already reset the logical session, while internal reconnect calls preserve
    // activeThreadId/activeMessageId so resume can be scoped to the current thread.
    // If the socket drops after `open` and before connected/thread_info arrive, this
    // keeps reconnect attached to the caller-provided thread.
    if (threadId) {
      this.activeThreadId = threadId;
    }
    // Prefer explicit threadId arg; fall back to activeThreadId from prior connected message
    const effectiveThreadId = threadId ?? this.activeThreadId ?? undefined;

    const params = new URLSearchParams({
      token,
      continuation_mode: this.continuationMode
    });
    if (effectiveThreadId) {
      params.set('thread_id', effectiveThreadId);
    }
    // Resume the in-flight message after a drop (§6a item 3). Gate on effectiveThreadId:
    // the worker's resume read is thread-scoped (§3), so resume_message_id is meaningless
    // without thread_id. Gating makes that invariant hold BY CONSTRUCTION — the SDK can
    // never emit an unscoped resume id — and an (unexpected) unknown-thread state degrades
    // to an ordinary reconnect (fresh history reconciles) instead of throwing inside
    // connect(), which on the auto-reconnect path would strand the client with no retry.
    if (this.activeMessageId && effectiveThreadId) {
      params.set('resume_message_id', this.activeMessageId);
    }
    const url = `${this.baseURL}/agents/${agentId}/${connectionId}?${params.toString()}`;
    
    this.log('info', 'Attempting to connect to WebSocket', { 
      url, 
      agentId, 
      connectionId,
      tokenLength: token.length,
      continuationMode: this.continuationMode
    });
    
    const attemptId = ++this.connectAttemptId;
    const socket = createWebSocket(url);
    this.ws = socket;
    let opened = false;
    let settled = false;
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const connectPromise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const clearActiveConnect = () => {
      if (this.activeConnectAttemptId === attemptId) {
        this.activeConnectAttemptId = null;
        this.activeConnectPromise = null;
        this.activeConnectReject = null;
      }
    };

    const resolveConnect = () => {
      if (settled) return;
      settled = true;
      clearActiveConnect();
      resolvePromise();
    };

    const rejectConnect = (error: Error) => {
      if (settled) return;
      settled = true;
      clearActiveConnect();
      rejectPromise(error);
    };

    this.activeConnectAttemptId = attemptId;
    this.activeConnectPromise = connectPromise;
    this.activeConnectReject = rejectConnect;

    const isCurrentSocket = () => this.ws === socket;

    // Create event handlers that we can later remove
    const openHandler = () => {
      if (!isCurrentSocket()) return;
      opened = true;
      this.log('info', 'WebSocket connection opened successfully');
      this.currentAttempts = 0;
      this.isManuallyDisconnected = false;
      this.emit('connected', {});
      resolveConnect();
    };

    const messageHandler = (event: any) => {
      if (!isCurrentSocket()) return;
      try {
        const data = event.data || event;
        const messageText = typeof data === 'string' ? data : data.toString();
        this.log('info', 'Received WebSocket message', { messageText });
        
        this.emitRawFrame(messageText);
        const message: WebSocketMessage = JSON.parse(messageText);
        this.log('info', 'Parsed WebSocket message', { type: message.type, dataKeys: Object.keys(message.data || {}) });
        this.handleMessage(message);
      } catch (error) {
        this.log('error', 'Failed to parse WebSocket message', { error, rawData: event.data });
        this.emit('error', { error: 'Failed to parse message', data: event.data });
      }
    };

    const closeHandler = (event: any) => {
      if (!isCurrentSocket()) return;
      const code = event.code || 1000;
      const reason = event.reason || 'Connection closed';
      this.log('warn', 'WebSocket connection closed', { code, reason });
      this.emit('disconnected', { code, reason });
      if (!opened) {
        rejectConnect(new Error(`WebSocket closed before open: ${reason}`));
      }
      this.scheduleReconnect();
    };

    const errorHandler = (error: any) => {
      if (!isCurrentSocket()) return;
      const errorMessage = error.message || error.toString() || 'WebSocket error';
      this.log('error', 'WebSocket error occurred', { error: errorMessage, fullError: error });
      this.emit('error', { error: errorMessage });
      rejectConnect(new Error(errorMessage));
    };

    // Store handlers for cleanup
    this.eventHandlers.set('open', openHandler);
    this.eventHandlers.set('message', messageHandler);
    this.eventHandlers.set('close', closeHandler);
    this.eventHandlers.set('error', errorHandler);

    // Add event listeners
    socket.addEventListener('open', openHandler);
    socket.addEventListener('message', messageHandler);
    socket.addEventListener('close', closeHandler);
    socket.addEventListener('error', errorHandler);

    return connectPromise;
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect(): void {
    this.isManuallyDisconnected = true;
    this.invalidatePendingReconnects();
    this.cancelActiveConnect('WebSocket connection cancelled');
    this.closeCurrentSocket();
    for (const end of [...this.runWaiters]) end();
  }

  /**
   * Send a chat message to the agent
   * 
   * Note: The server expects content at the top level, not nested in a data object.
   * Format: { type: 'message', content: '...', role: '...', timestamp: '...' }
   */
  sendMessage(message: ChatMessage, options?: WebSocketRequestOptions): void {
    const payload = this.buildMessagePayload(message, options);
    this.log('info', 'Sending WebSocket message', { payload });
    this.sendPayload(payload, message);
  }

  /**
   * Reconnect if needed, then send a chat message. Use this from proxies that must
   * fail before accepting a browser message when the upstream socket cannot be restored.
   */
  async sendMessageAsync(message: ChatMessage, options?: WebSocketRequestOptions): Promise<void> {
    const payload = this.buildMessagePayload(message, options);
    await this.ensureConnectedForSend();
    this.log('info', 'Sending WebSocket message', { payload });
    this.sendPayload(payload, message);
  }

  /**
   * Send raw data to the WebSocket
   */
  send(data: any): void {
    this.log('info', 'Sending raw WebSocket data', { data });
    this.sendPayload(data, data);
  }

  /**
   * Reconnect if needed, then send a raw Ragwalla frame.
   */
  async sendAsync(data: any): Promise<void> {
    await this.ensureConnectedForSend();
    this.log('info', 'Sending raw WebSocket data', { data });
    this.sendPayload(data, data);
  }

  private requireConnectedForRequest(options?: WebSocketRequestOptions): void {
    if (options?.requestId !== undefined && !this.isConnected()) {
      throw new Error('WebSocket must be connected to send a correlated setting update');
    }
  }

  /**
   * Update the continuation mode used for this connection.
   * When connected, this will notify the agent immediately.
   */
  setContinuationMode(mode: 'auto' | 'manual', options?: WebSocketRequestOptions): void {
    this.requireConnectedForRequest(options);
    const normalized = mode === 'manual' ? 'manual' : 'auto';
    this.continuationMode = normalized;

    if (this.isConnected()) {
      this.log('info', 'Sending continuation mode update', { mode: normalized });
      this.send({
        type: 'set_continuation_mode',
        ...(options?.requestId !== undefined && { requestId: options.requestId }),
        mode: normalized
      });
    } else {
      this.log('info', 'Continuation mode updated (will apply on next connect)', { mode: normalized });
    }
  }

  setTruncationStrategy(strategy: TruncationStrategy | undefined, options?: WebSocketRequestOptions): void {
    this.requireConnectedForRequest(options);
    this.truncationStrategy = strategy;

    if (this.isConnected()) {
      this.log('info', 'Sending truncation strategy update', { strategy });
      this.send({
        type: 'set_truncation_strategy',
        ...(options?.requestId !== undefined && { requestId: options.requestId }),
        truncationStrategy: strategy ?? null,
      });
    }
  }

  setMaxKbCharsPerChunk(maxChars: number | undefined, options?: WebSocketRequestOptions): void {
    this.requireConnectedForRequest(options);
    this.maxKbCharsPerChunk = maxChars;

    if (this.isConnected()) {
      this.log('info', 'Sending maxKbCharsPerChunk update', { maxChars });
      this.send({
        type: 'set_max_kb_chars_per_chunk',
        ...(options?.requestId !== undefined && { requestId: options.requestId }),
        maxKbCharsPerChunk: maxChars ?? null,
      });
    }
  }

  setSemanticAugmentation(enabled: boolean, options?: WebSocketRequestOptions): void {
    this.requireConnectedForRequest(options);
    this.semanticAugmentation = enabled;

    if (this.isConnected()) {
      this.log('info', 'Sending semantic augmentation update', { enabled });
      this.send({
        type: 'set_semantic_augmentation',
        ...(options?.requestId !== undefined && { requestId: options.requestId }),
        enabled,
      });
    }
  }

  /**
   * Request the agent to resume a paused run (manual continuation mode).
   */
  continueRun(runId: string, options?: WebSocketRequestOptions): void {
    if (!runId) {
      throw new Error('runId is required to continue a run');
    }

    this.log('info', 'Sending continue run request', { runId });
    this.send({
      type: 'continue_run',
      ...(options?.requestId !== undefined && { requestId: options.requestId }),
      runId
    });
  }

  /**
   * Cancel the current active run, or a specific run by ID.
   * Signals the agent to abort tool execution and mark the run as cancelled.
   */
  cancelRun(runId?: string, options?: WebSocketRequestOptions): void {
    this.log('info', 'Sending cancel run request', { runId });
    this.send({
      type: 'cancel_run',
      ...(options?.requestId !== undefined && { requestId: options.requestId }),
      ...(runId ? { runId } : {}),
    });
  }

  /**
   * Send one message and wait for the run it starts to end.
   *
   * Correlation is the worker's own prompt/run correlation, not a scheme of this helper's:
   * the send carries `requestId`, which `message_received` and `run_started` echo, and
   * `run_started` names the run. Every later frame for that run carries its `runId`, so
   * frames from other runs sharing this socket are ignored.
   *
   * Resolves when the server reports an outcome:
   *  - `complete` → completed, failed, or cancelled, from its flags;
   *  - a run-scoped `error` → failed (the execution-only path ends a failed run this way,
   *    with no `complete`);
   *  - `run_cancelled` → cancelled;
   *  - after a reconnect, a terminal `run_state` → its status, once the run's final text
   *    (`resume`) has arrived.
   *
   * Rejects with {@link RunToCompletionError} when it cannot observe an outcome: a refusal
   * before any run existed, a timeout, an abort, or a socket that will not reconnect. On a
   * timeout, an abort, or a run-scoped `error`, a `cancel_run` naming the run is sent when
   * its id is known, so abandoning the wait does not leave the run executing. A wait that
   * ends before `run_started` cannot cancel anything: without the id, the only cancel the
   * protocol offers is "this connection's current run", which may be someone else's.
   *
   * Never resends. After a drop the SDK reconnects to the thread and the worker resumes the
   * in-flight message on the new socket; sending again would start a second run.
   */
  runToCompletion(message: ChatMessage, options: RunToCompletionOptions): Promise<RunResult> {
    const { requestId, timeoutMs, signal } = options;
    if (!requestId) {
      return Promise.reject(new Error('runToCompletion requires a requestId'));
    }
    // The worker delivers a run's frames to the sockets bound to that run, and a socket is
    // bound to ONE run: sending a second message rebinds it. A second concurrent wait would
    // silently starve the first of its terminal frame until it timed out and cancelled a
    // run that was fine. Refuse instead; use one socket per concurrent run.
    if (this.runWaiters.size > 0) {
      return Promise.reject(new Error(
        'runToCompletion is already waiting on this socket; the server streams one run per ' +
        'socket, so use a separate connection for each concurrent run'
      ));
    }

    return new Promise<RunResult>((resolve, reject) => {
      let runId: string | undefined;
      let threadId: string | undefined;
      let userMessageId: string | undefined;
      // messageId -> text. A Map keeps first-appearance order when a resume replaces a value.
      const texts = new Map<string, string>();
      let streamTotals: RunUsageTotals | undefined;
      let dropped = false;
      let reconnected = false;
      let settled = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      let completedByRunState = false;

      const cleanup = (): void => {
        settled = true;
        this.off('rawFrame', onFrame);
        this.off('disconnected', onDisconnected);
        this.off('connected', onConnected);
        this.off('reconnectFailed', onReconnectFailed);
        this.runWaiters.delete(onManualDisconnect);
        signal?.removeEventListener('abort', onAbort);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (settleTimer) clearTimeout(settleTimer);
      };

      const requestCancel = (): boolean => {
        if (!runId) return false;
        try {
          this.cancelRun(runId);
          return true;
        } catch {
          return false; // not connected: there is no socket to carry it
        }
      };

      const fail = (
        code: RunToCompletionErrorCode,
        reason: string,
        extra: { cancelRequested: boolean; serverError?: unknown },
      ): void => {
        if (settled) return;
        cleanup();
        reject(new RunToCompletionError(code, reason, {
          requestId,
          ...(runId !== undefined && { runId }),
          ...(threadId !== undefined && { threadId }),
          ...(userMessageId !== undefined && { userMessageId }),
          ...(extra.serverError !== undefined && { serverError: extra.serverError }),
          cancelRequested: extra.cancelRequested,
        }));
      };

      const finish = (
        status: RunOutcome,
        extra: { error?: unknown; reason?: string; usage?: RunUsageTotals } = {},
      ): void => {
        if (settled || !runId) return;
        cleanup();
        const usage = extra.usage
          ? { ...extra.usage, source: 'terminal' as const }
          : streamTotals
            ? { ...streamTotals, source: 'stream' as const }
            : undefined;
        resolve({
          runId,
          ...(threadId !== undefined && { threadId }),
          ...(userMessageId !== undefined && { userMessageId }),
          status,
          text: [...texts.values()].join(''),
          messageIds: [...texts.keys()].filter((id) => id !== ''),
          ...(extra.error !== undefined && { error: extra.error }),
          ...(extra.reason !== undefined && { reason: extra.reason }),
          ...(usage && { usage }),
          reconnected,
        });
      };

      const onFrame = (frame: WebSocketMessage): void => {
        if (settled) return;

        if (frame.requestId === requestId && !runId) {
          if (frame.type === 'message_received') {
            userMessageId = frame.messageId ?? userMessageId;
            threadId = frame.threadId ?? threadId;
            return;
          }
          if (frame.type === 'run_started') {
            runId = frame.runId;
            threadId = frame.threadId ?? threadId;
            userMessageId = frame.userMessageId ?? userMessageId;
            return;
          }
          if (frame.type === 'error') {
            const raw = frame.error;
            const text = typeof raw === 'string' ? raw : raw?.message ?? 'Request failed';
            fail('request_failed', text, { cancelRequested: false, serverError: raw });
            return;
          }
        }

        // A drop can lose run_started, which was addressed to the old socket. The reconnect's
        // run_state names the run's initiating prompt, so adopt the run that is ours.
        if (
          !runId && frame.type === 'run_state' && frame.runId &&
          userMessageId !== undefined && frame.userMessageId === userMessageId
        ) {
          runId = frame.runId;
        }

        if (!runId || frame.runId !== runId) return;

        // A terminal run_state is followed, in the same server batch, by the run's final
        // message_created/resume. Anything else means that text is not coming.
        if (completedByRunState && frame.type !== 'message_created' && frame.type !== 'resume') {
          finish('completed');
          return;
        }

        switch (frame.type) {
          case 'message_created':
            if (frame.messageId && !texts.has(frame.messageId)) texts.set(frame.messageId, '');
            break;
          case 'chunk': {
            const key = frame.messageId ?? '';
            texts.set(key, (texts.get(key) ?? '') + (frame.content ?? ''));
            break;
          }
          case 'resume':
            // The message's full visible text so far; live chunks continue from it.
            if (frame.messageId) texts.set(frame.messageId, frame.content ?? '');
            if (completedByRunState) finish('completed');
            break;
          case 'token_usage':
            if (frame.totals) streamTotals = frame.totals;
            break;
          case 'complete':
            finish(frame.cancelled ? 'cancelled' : frame.failed ? 'failed' : 'completed', {
              error: frame.error,
              reason: frame.reason,
              usage: frame.usage,
            });
            break;
          case 'run_cancelled':
            finish('cancelled');
            break;
          case 'error':
            // Not every run-scoped error is terminal (assistant mode sends one when its stream
            // ends early and the run may still be executing), so make sure it stops.
            requestCancel();
            finish('failed', { error: frame.error });
            break;
          case 'run_state':
            if (frame.runStatus === 'completed') {
              completedByRunState = true;
              settleTimer = setTimeout(() => finish('completed'), RUN_STATE_SETTLE_MS);
            } else if (frame.runStatus === 'cancelled') {
              finish('cancelled');
            } else if (isTerminalRunStatus(frame.runStatus)) {
              finish('failed', { reason: frame.runStatus });
            }
            break;
        }
      };

      const onDisconnected = (): void => {
        dropped = true;
        // The close handler schedules the reconnect synchronously after emitting this event.
        // If none was scheduled, none is coming and the outcome cannot be observed here.
        queueMicrotask(() => {
          if (!settled && !this.isConnected() && !this.reconnectTimer && !this.reconnectInFlight) {
            fail('connection_lost', 'The socket closed and will not reconnect', { cancelRequested: false });
          }
        });
      };
      const onConnected = (): void => {
        if (dropped) reconnected = true;
      };
      const onReconnectFailed = (): void => {
        fail('connection_lost', 'The socket closed and reconnection failed', { cancelRequested: false });
      };
      const onManualDisconnect = (): void => {
        fail('connection_lost', 'disconnect() was called while waiting', { cancelRequested: false });
      };
      const onAbort = (): void => {
        const cancelRequested = requestCancel();
        fail('aborted', 'runToCompletion was aborted', { cancelRequested });
      };

      if (signal?.aborted) {
        reject(new RunToCompletionError('aborted', 'runToCompletion was aborted before sending', {
          requestId,
          cancelRequested: false,
        }));
        return;
      }

      this.on('rawFrame', onFrame);
      this.on('disconnected', onDisconnected);
      this.on('connected', onConnected);
      this.on('reconnectFailed', onReconnectFailed);
      this.runWaiters.add(onManualDisconnect);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (timeoutMs !== undefined) {
        timeoutTimer = setTimeout(() => {
          const cancelRequested = requestCancel();
          fail('timeout', `The run did not finish within ${timeoutMs}ms`, { cancelRequested });
        }, timeoutMs);
      }

      this.sendMessageAsync(message, { requestId }).catch((error) => {
        fail('request_failed', `Send failed: ${errorMessage(error)}`, { cancelRequested: false });
      });
    });
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === 1; // 1 = OPEN
  }

  /**
   * Add event listener
   */
  on(event: string, listener: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off(event: string, listener: Function): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
    }
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  private emit(event: string, data: any): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      });
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    // Normalized convenience events must retain the same correlation as rawFrame.
    // Do not add an undefined property to legacy payloads or mutate the raw frame.
    const emit = (event: string, payload: any): void => {
      this.emit(event, message.requestId === undefined
        ? payload
        : { ...payload, requestId: message.requestId });
    };
    switch (message.type) {
      case 'message':
      case 'chat_message':
        // Server sends content at top level, not in data wrapper
        const messageData = message.data || {
          content: message.content,
          role: message.role,
          threadId: message.threadId,
          messageId: message.messageId
        };
        emit('message', messageData);
        break;
      case 'chunk':
        // Streaming message chunk from server. Track the in-flight message id as a
        // fallback in case message_created was missed (e.g. socket dropped before it),
        // so a reconnect can still resume this message (§6a item 2).
        if ((message as any).messageId) {
          this.activeMessageId = (message as any).messageId;
        }
        emit('chunk', {
          content: (message as any).content,
          messageId: (message as any).messageId
        });
        break;
      case 'complete': {
        // Message completion event — the in-flight message is done.
        this.activeMessageId = null;
        // The worker sends the outcome on this frame: `failed`/`cancelled` (neither means
        // completed), `reason`, `error`, and the stamped `runId`. Only `messageId` used to be
        // forwarded, so a failed or cancelled run was indistinguishable from a successful one.
        // Each field is forwarded only when present: absent means "not reported", not false.
        const event: CompleteEvent = {
          messageId: message.messageId,
          ...(message.runId !== undefined && { runId: message.runId }),
          ...(message.failed !== undefined && { failed: message.failed }),
          ...(message.cancelled !== undefined && { cancelled: message.cancelled }),
          ...(message.reason !== undefined && { reason: message.reason }),
          ...(message.error !== undefined && { error: message.error }),
          ...(message.usage !== undefined && { usage: message.usage }),
        };
        emit('complete', event);
        break;
      }
      case 'message_created':
        // New message created event — this is now the in-flight message to resume.
        this.activeMessageId = (message as any).messageId;
        emit('messageCreated', {
          messageId: (message as any).messageId,
          role: (message as any).role
        });
        break;
      case 'thread_info': {
        // Thread information. Persist the thread id so a reconnect during the FIRST
        // streamed reply (before any 'connected' carried currentThreadId) still sends
        // thread_id — required to scope the resume read (§6a item 2.5).
        const info = (message.data || message) as { threadId?: string };
        if (info.threadId) {
          this.activeThreadId = info.threadId;
        }
        emit('threadInfo', message.data || message);
        break;
      }
      case 'thread_history':
        // Historical messages for the current thread. `threadId` is always populated by the
        // worker (single emitter, non-optional parameter), so this frame is self-identifying
        // and needs no ordering-based correlation.
        // `latestRun` is the thread's authoritative run status, stamped so a client can tell a
        // live-but-silent run from a dead one instead of inferring failure from silence.
        // It has THREE states and they are not interchangeable:
        //   key absent -> the server predates the field; run state is UNKNOWN
        //   null       -> the server looked and the thread has no runs
        //   object     -> the thread's newest run
        // So the key is omitted rather than defaulted: `?? null` would report an old server's
        // silence as a confirmed "no runs", which is the opposite of what a staleness watchdog
        // should conclude. Same absence-is-meaningful convention the worker uses for
        // `connected.currentThreadId`.
        emit('threadHistory', {
          threadId: message.threadId,
          messages: message.messages || [],
          messageCount: message.messageCount || 0,
          ...('latestRun' in message ? { latestRun: message.latestRun } : {})
        });
        break;
      case 'typing':
        // Typing indicator
        emit('typing', {
          isTyping: (message as any).isTyping
        });
        break;
      case 'tool_use':
        // Tool usage information
        emit('toolUse', {
          tools: (message as any).tools
        });
        break;
      case 'tool_executing':
        emit('toolExecuting', {
          toolName: (message as any).toolName,
          toolTitle: (message as any).toolTitle,
          toolCallId: (message as any).toolCallId,
          toolType: (message as any).toolType,
          serverName: (message as any).serverName
        });
        break;
      case 'tool_complete':
        emit('toolComplete', {
          toolName: (message as any).toolName,
          toolTitle: (message as any).toolTitle,
          toolCallId: (message as any).toolCallId,
          toolType: (message as any).toolType
        });
        break;
      case 'status':
        // Transient status update (e.g., tool executing, generating response, MCP progress)
        emit('status', {
          status: (message as any).status,
          message: (message as any).message,
          toolName: (message as any).toolName,
          toolTitle: (message as any).toolTitle,
          toolCallId: (message as any).toolCallId,
          toolType: (message as any).toolType,
          serverName: (message as any).serverName,
          progress: (message as any).progress,
          total: (message as any).total
        });
        break;
      case 'token_usage': {
        // Top-level fields, like every other worker frame. This used to emit `message.data`,
        // a wrapper the worker never sends — so the event always carried `undefined`.
        const event: Omit<TokenUsageEvent, 'requestId'> = {
          ...(message.runId !== undefined && { runId: message.runId }),
          ...(message.model !== undefined && { model: message.model }),
          call: message.call as LlmCallUsage,
          totals: message.totals as RunUsageTotals,
        };
        emit('tokenUsage', event);
        break;
      }
      case 'run_paused':
        emit('runPaused', message.data || message);
        break;
      case 'request_ack':
        emit('requestAck', message);
        emit('rawMessage', message);
        break;
      case 'pong':
        emit('pong', message);
        emit('rawMessage', message);
        break;
      case 'continuation_mode_updated':
        emit('continuationModeUpdated', message.data || message);
        break;
      case 'continue_run_result':
        emit('continueRunResult', message.data || message);
        break;
      case 'run_cancelled':
        // Turn ended without a 'complete' — drop the in-flight id so the next reconnect
        // does not try to resume a finished message (§6a item 2).
        this.activeMessageId = null;
        emit('runCancelled', message.data || message);
        break;
      case 'resume': {
        // Reconnect resume (§6a item 4): the worker's snapshot of the in-flight bubble's
        // current visible text. The consumer replaces the bubble body with `content`.
        const resumeData = (message.data || message) as { messageId?: string; content?: string };
        emit('resume', {
          messageId: resumeData.messageId,
          content: resumeData.content
        });
        break;
      }
      case 'run_started': {
        // The thread the run actually executes on. Persisted for the same reason as
        // thread_info: a drop before any `connected`/`thread_info` named the thread (the
        // first message on a new thread) would otherwise reconnect without thread_id, and
        // the worker could not reattach this socket to the run it just started.
        if (message.threadId) {
          this.activeThreadId = message.threadId;
        }
        emit('runStarted', {
          threadId: message.threadId,
          userMessageId: message.userMessageId,
          runId: message.runId
        });
        break;
      }
      case 'run_state': {
        // Reconnect run status (§6a item 4): the run's current status on this connection.
        const stateData = (message.data || message) as {
          runId?: string;
          runStatus?: string;
          userMessageId?: string;
          activeTool?: unknown;
        };
        // A terminal run has no in-flight message to resume; clear the id so a later
        // reconnect does not resume a finished message (§6a item 2). Uses the shared
        // terminal set so it cannot drift from the worker.
        if (isTerminalRunStatus(stateData.runStatus)) {
          this.activeMessageId = null;
        }
        emit('runState', {
          runId: stateData.runId,
          runStatus: stateData.runStatus,
          ...(stateData.userMessageId !== undefined ? { userMessageId: stateData.userMessageId } : {}),
          activeTool: stateData.activeTool ?? null
        });
        break;
      }
      case 'error': {
        // The worker puts the whole payload at the TOP LEVEL of an error frame — there is
        // no `data` wrapper and no `content` field, so the previous `message.data ||
        // { error: message.content }` always fell through to the second branch and emitted
        // `{ error: undefined }`, dropping every error message on the floor.
        // `error` is a string on all but one path; the generic onMessage catch sends
        // `{ message, code }` instead. Auth/lifecycle and protocol refusals carry codes.
        // requestId correlates direct command errors;
        // threadId/messageId retain their existing resource scope.
        const raw = (message as any).error;
        const nested = raw !== null && typeof raw === 'object' ? raw : undefined;
        emit('error', {
          error: nested ? nested.message : raw,
          code: nested ? nested.code : (message as any).code,
          threadId: (message as any).threadId,
          messageId: (message as any).messageId
        });
        break;
      }
      case 'connection_status':
      case 'connected': {
        const connMsg = message.data || message;
        // Update active thread so reconnects reattach to the same thread
        if (connMsg.currentThreadId) {
          this.activeThreadId = connMsg.currentThreadId;
        }
        emit('connectionStatus', connMsg);
        break;
      }
      case 'cf_agent_state':
        // Cloudflare agent state updates - emit as raw message
        emit('agentState', message.data || message);
        break;
      default:
        emit('rawMessage', message);
    }
  }
}
