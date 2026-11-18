import { HTTPClient, RagwallaAPIError } from '../client/http-client.js';
import { path } from '../client/path.js';
import { parseServerSentEvents } from '../client/sse.js';
import type { AgentRun, AgentSessionEvent, CreateAgentRunParams } from '../types/index.js';

/** The events after which a run's stream ends: the turn ended, or waits on its client. */
const STREAM_ENDING_EVENTS = new Set([
  'agent.session.turn.completed',
  'agent.session.turn.failed',
  'agent.session.turn.cancelled',
  'agent.session.requires_action',
]);

/** How long to wait before reconnecting until the stream says (`retry:`). */
const DEFAULT_RECONNECT_MS = 1_000;

/** Reconnects in a row that may bring nothing new before the stream gives up. */
const DEFAULT_MAX_RECONNECTS = 5;

type OpenStream = { response: Response; abort: () => void };

/** Reopen a run's stream after the last event id the client saw. */
type ResumeRun = (runId: string, lastEventId: string, signal: AbortSignal) => Promise<OpenStream>;

export interface AgentRunStreamOptions {
  signal?: AbortSignal;
  /**
   * Reconnects in a row that bring no new event before the stream gives up with the error that
   * dropped it (default 5). 0 never reconnects.
   */
  maxReconnects?: number;
}

/**
 * A streamed run: its session events as server-sent events, read either as parsed events
 * (`for await`) or, by a server that passes the stream on to its own client, as the bytes it
 * arrived as (`toReadableStream()`), heartbeats included. Read it one way, once.
 *
 * The stream ends when the run ends or waits on its client for function results. Leaving it
 * (a `break`, `abort()`) closes the connection; the run carries on, to be read with
 * `runs.retrieve`.
 *
 * Read with `for await`, a connection that drops before the run's stream ends is reopened on its
 * own, as the server-sent events standard describes: after the stream's `retry:` delay, from the
 * last event id it saw (`runs.events`), so no event is missed or repeated. Where Ragwalla can no
 * longer replay the run (more than 15 minutes after it ended), the reconnect's error is thrown
 * (`stream_resume_unavailable`, 409): read the run with `runs.retrieve` instead.
 * `toReadableStream()` passes the bytes on once and never reconnects: the browser it feeds keeps
 * the last `id:` it saw and reconnects to its server, which forwards it to `runs.events`.
 */
export class AgentRunStream implements AsyncIterable<AgentSessionEvent> {
  private consumed = false;
  private closed = false;
  private abortRequest: () => void;
  private readonly controller = new AbortController();

  constructor(
    /** The HTTP response, headers included; its body is the stream. */
    readonly response: Response,
    abortRequest: () => void,
    private readonly resumeRun: ResumeRun,
    private readonly options: AgentRunStreamOptions = {},
  ) {
    this.abortRequest = abortRequest;
    if (options.signal?.aborted) this.abort();
    options.signal?.addEventListener('abort', () => this.abort(), { once: true });
  }

  private take(): ReadableStream<Uint8Array> {
    if (this.consumed) throw new Error('This run stream has already been read');
    this.consumed = true;
    return this.response.body!;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentSessionEvent> {
    const maxReconnects = this.options.maxReconnects ?? DEFAULT_MAX_RECONNECTS;
    let body = this.take();
    let lastEventId = '';
    let reconnectMs = DEFAULT_RECONNECT_MS;
    let runId: string | null = null;
    let fruitless = 0;
    for (;;) {
      let ended = false;
      let dropped: unknown = null;
      try {
        for await (const sse of parseServerSentEvents(body)) {
          if (sse.retry !== null) reconnectMs = sse.retry;
          const event = JSON.parse(sse.data) as AgentSessionEvent;
          if (sse.lastEventId !== lastEventId) {
            lastEventId = sse.lastEventId;
            fruitless = 0;
          }
          if (typeof event.turn_id === 'string') runId = event.turn_id;
          if (STREAM_ENDING_EVENTS.has(event.type)) ended = true;
          yield event;
        }
      } catch (error) {
        if (this.closed) return;
        dropped = error;
      }
      if (ended || this.closed) return;
      // A stream with no ids (or no run yet) cannot be resumed: it ends as it ended.
      if (runId === null || lastEventId === '' || fruitless >= maxReconnects) {
        if (dropped !== null) throw dropped;
        return;
      }
      for (;;) {
        fruitless += 1;
        await new Promise((resolve) => setTimeout(resolve, reconnectMs));
        if (this.closed) return;
        try {
          const reopened = await this.resumeRun(runId, lastEventId, this.controller.signal);
          this.abortRequest = reopened.abort;
          body = reopened.response.body!;
          break;
        } catch (error) {
          if (this.closed) return;
          // Ragwalla answered: it cannot replay the run (409), or refuses the request. Only a
          // connection that failed is worth trying again.
          if (error instanceof RagwallaAPIError || fruitless >= maxReconnects) throw error;
        }
      }
    }
  }

  /**
   * The stream's bytes as they arrive, server-sent events and heartbeat comments as Ragwalla sent
   * them, to answer a browser with unchanged:
   *
   * ```ts
   * return new Response(stream.toReadableStream(), {
   *   headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
   * });
   * ```
   */
  toReadableStream(): ReadableStream<Uint8Array> {
    return this.take();
  }

  /** Close the connection, and reconnect no more. The run carries on. */
  abort(): void {
    this.closed = true;
    this.controller.abort();
    this.abortRequest();
  }
}

/**
 * Running an agent over plain HTTPS (`/v1/agents/:agentId/runs`), for networks where WebSockets
 * are blocked. A run is a turn of the agent on a session's thread, acting for the API key's
 * creator.
 */
export class AgentRunsResource {
  constructor(private client: HTTPClient) {}

  private body(params: CreateAgentRunParams, mode: 'wait' | 'stream' | 'background') {
    const { idempotencyKey: _key, ...rest } = params;
    return { ...rest, mode };
  }

  private headers(params: CreateAgentRunParams): Record<string, string> {
    return params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {};
  }

  /**
   * Run the agent and answer when the run ends (or waits on its client) with its output, or,
   * with `background: true`, as soon as the run is admitted.
   */
  async create(agentId: string, params: CreateAgentRunParams & { background?: boolean }): Promise<AgentRun> {
    const { background, ...run } = params;
    return this.client.post<AgentRun>(
      path`/v1/agents/${agentId}/runs`,
      this.body(run, background ? 'background' : 'wait'),
      { headers: this.headers(run) },
    );
  }

  /**
   * Run the agent and stream its session events as it works (server-sent events over HTTPS).
   *
   * ```ts
   * const stream = await client.agents.runs.stream(agentId, { input: 'Hello' });
   * for await (const event of stream) {
   *   if (event.type === 'agent.session.turn.output_text.delta') process.stdout.write(event.delta as string);
   * }
   * ```
   */
  async stream(
    agentId: string,
    params: CreateAgentRunParams,
    options: AgentRunStreamOptions = {},
  ): Promise<AgentRunStream> {
    const { response, abort } = await this.client.postStream(
      path`/v1/agents/${agentId}/runs`,
      this.body(params, 'stream'),
      { signal: options.signal, headers: this.headers(params) },
    );
    return new AgentRunStream(response, abort, this.resumer(agentId), options);
  }

  /**
   * A run's session events: from its first, or after `lastEventId` (an `id:` its stream sent),
   * live while it runs. A server whose browser reconnects with `Last-Event-ID` forwards it here.
   * Ragwalla can replay a run until 15 minutes after it ends; after that this is refused with
   * `stream_resume_unavailable` (409).
   */
  async events(
    agentId: string,
    runId: string,
    options: AgentRunStreamOptions & { lastEventId?: string } = {},
  ): Promise<AgentRunStream> {
    const { response, abort } = await this.openEvents(agentId, runId, options.lastEventId, options.signal);
    return new AgentRunStream(response, abort, this.resumer(agentId), options);
  }

  private openEvents(agentId: string, runId: string, lastEventId: string | undefined, signal: AbortSignal | undefined) {
    return this.client.getStream(path`/v1/agents/${agentId}/runs/${runId}/events`, {
      signal,
      headers: lastEventId === undefined ? {} : { 'Last-Event-ID': lastEventId },
    });
  }

  private resumer(agentId: string): ResumeRun {
    return (runId, lastEventId, signal) => this.openEvents(agentId, runId, lastEventId, signal);
  }

  /** A run, with its output so far. */
  async retrieve(agentId: string, runId: string): Promise<AgentRun> {
    return this.client.get<AgentRun>(path`/v1/agents/${agentId}/runs/${runId}`);
  }

  /** Cancel a run while it is active; one that has ended is refused (`invalid_run_status`). */
  async cancel(agentId: string, runId: string): Promise<AgentRun> {
    return this.client.post<AgentRun>(path`/v1/agents/${agentId}/runs/${runId}/cancel`);
  }
}
