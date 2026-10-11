import { HTTPClient } from '../client/http-client.js';
import type { CreateThreadEventParams, ThreadEvent } from '../types/index.js';

export interface Thread {
  id: string;
  object: 'thread';
  created_at: number;
  tool_resources: Record<string, unknown>;
  metadata: Record<string, string>;
}

export interface ThreadDeleted {
  id: string;
  object: 'thread.deleted';
  deleted: boolean;
}

/**
 * Events recorded on a thread by an integrator's backend: something that happened
 * outside the conversation, such as a deploy finishing.
 */
export class ThreadEventsResource {
  constructor(private client: HTTPClient) {}

  /**
   * Record an event on a thread (`POST /v1/threads/:threadId/events`).
   *
   * A `client` or `both` event is delivered live to the sockets open on the thread as
   * `threadEvent`, and appears in `thread_history` for sockets connected with
   * `includeEvents`. An `agent` or `both` event is part of the agent's context from its
   * next turn as `[Event: <type>] <summary>`; recording one does not start a turn.
   * The thread must name an active, enabled agent in its project. Pass an
   * `idempotency_key` to make the call safe to retry.
   */
  async create(threadId: string, params: CreateThreadEventParams): Promise<ThreadEvent> {
    return this.client.post<ThreadEvent>(`/v1/threads/${threadId}/events`, params);
  }
}

export class ThreadsResource {
  public readonly events: ThreadEventsResource;

  constructor(private client: HTTPClient) {
    this.events = new ThreadEventsResource(client);
  }

  /**
   * Create a new thread
   */
  async create(params?: {
    messages?: Array<{
      role: 'user' | 'assistant';
      content: string;
      metadata?: Record<string, string>;
      attachments?: Array<{ file_id: string; tools: Array<{ type: string }> }>;
    }>;
    tool_resources?: Record<string, unknown>;
    metadata?: Record<string, string>;
  }): Promise<Thread> {
    return this.client.post<Thread>('/v1/threads', params || {});
  }

  /**
   * Retrieve a thread by ID
   */
  async retrieve(threadId: string): Promise<Thread> {
    return this.client.get<Thread>(`/v1/threads/${threadId}`);
  }

  /**
   * Modify a thread
   */
  async update(threadId: string, params: {
    tool_resources?: Record<string, unknown>;
    metadata?: Record<string, string>;
  }): Promise<Thread> {
    return this.client.post<Thread>(`/v1/threads/${threadId}`, params);
  }

  /**
   * Delete a thread
   */
  async delete(threadId: string): Promise<ThreadDeleted> {
    return this.client.delete<ThreadDeleted>(`/v1/threads/${threadId}`);
  }
}
