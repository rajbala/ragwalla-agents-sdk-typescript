import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import { parseServerSentEvents } from '../client/sse.js';
import type { AgentRun, AgentSessionEvent, CreateAgentRunParams } from '../types/index.js';

/**
 * A streamed run: its session events as server-sent events, read either as parsed events
 * (`for await`) or, by a server that passes the stream on to its own client, as the bytes it
 * arrived as (`toReadableStream()`), heartbeats included. Read it one way, once.
 *
 * The stream ends when the run ends or waits on its client for function results. Leaving it
 * (a `break`, `abort()`) closes the connection; the run carries on, to be read with
 * `runs.retrieve`.
 */
export class AgentRunStream implements AsyncIterable<AgentSessionEvent> {
  private consumed = false;

  constructor(
    /** The HTTP response, headers included; its body is the stream. */
    readonly response: Response,
    private readonly abortRequest: () => void,
  ) {}

  private take(): ReadableStream<Uint8Array> {
    if (this.consumed) throw new Error('This run stream has already been read');
    this.consumed = true;
    return this.response.body!;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentSessionEvent> {
    for await (const event of parseServerSentEvents(this.take())) {
      yield JSON.parse(event.data) as AgentSessionEvent;
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

  /** Close the connection. The run carries on. */
  abort(): void {
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
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentRunStream> {
    const { response, abort } = await this.client.postStream(
      path`/v1/agents/${agentId}/runs`,
      this.body(params, 'stream'),
      { signal: options.signal, headers: this.headers(params) },
    );
    return new AgentRunStream(response, abort);
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
