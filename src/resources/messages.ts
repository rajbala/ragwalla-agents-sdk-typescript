import { HTTPClient, type BinaryResponse } from '../client/http-client.js';
import type { MessageAudio } from '../types/index.js';

export interface MessageContentText {
  type: 'text';
  text: {
    value: string;
    annotations: any[];
  };
}

export interface MessageContentImage {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'high' | 'low';
  };
}

export type MessageContent = MessageContentText | MessageContentImage | any;

export interface Message {
  id: string;
  object?: 'thread.message';
  thread_id?: string;
  role: 'user' | 'assistant' | 'system';
  content: MessageContent[] | string;
  metadata?: Record<string, any>;
  created_at?: number;
  assistant_id?: string | null;
  run_id?: string | null;
  file_ids?: string[];
  status?: 'in_progress' | 'incomplete' | 'completed';
  /**
   * Server-authored row kind: null for a turn's answer; 'plan', 'subagent_report',
   * 'email_sent', or 'thread_event' otherwise.
   */
  row_kind?: string | null;
  /**
   * On a thread event row (row_kind 'thread_event'), which a list returns only with
   * `include_events: true`: the event itself. The row's role is 'system' and its
   * content is the event's summary.
   */
  event?: MessageThreadEvent;
  /** The message's audio (an agent's spoken answer, in parts played in order), on every read of a stored message. */
  audio?: MessageAudio[];
}

/** A client-visible thread event as a message list carries it. */
export interface MessageThreadEvent {
  /** Integrator-defined, for example `deployment.completed`. */
  type: string;
  /** Only client-visible events are listed. */
  visibility: 'client' | 'both';
  /** The event's JSON payload for clients, or null. */
  data: unknown;
}

export interface CreateMessageRequest {
  role: 'user' | 'assistant' | 'system';
  content: any;
  metadata?: Record<string, any>;
  attachments?: Array<{ file_id: string; tools: Array<{ type: string }> }>;
}

export interface ListMessagesParams {
  limit?: number;
  order?: 'asc' | 'desc';
  before?: string;
  after?: string;
  run_id?: string;
  /**
   * List the thread's client-visible events in place among its messages (rows with
   * row_kind 'thread_event' and an `event`), as `includeEvents` does for a socket's
   * thread history. Off by default.
   */
  include_events?: boolean;
}

export interface ListMessagesResponse {
  object: 'list';
  data: Message[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

export class MessagesResource {
  constructor(private client: HTTPClient) {}

  /**
   * Send a message on an existing thread
   */
  async create(threadId: string, request: CreateMessageRequest): Promise<Message> {
    return this.client.post<Message>(`/v1/threads/${threadId}/messages`, request);
  }

  /**
   * Retrieve a single message by ID
   */
  async retrieve(threadId: string, messageId: string): Promise<Message> {
    return this.client.get<Message>(`/v1/threads/${threadId}/messages/${messageId}`);
  }

  /**
   * List messages for a thread
   */
  async list(
    threadId: string,
    params?: ListMessagesParams
  ): Promise<ListMessagesResponse> {
    return this.client.get<ListMessagesResponse>(`/v1/threads/${threadId}/messages`, params);
  }

  /**
   * One part of a message's audio (see `Message.audio`): its bytes and media type.
   */
  async audio(
    threadId: string,
    messageId: string,
    part: number,
    direction: 'input' | 'output' = 'output'
  ): Promise<BinaryResponse> {
    return this.client.getBinary(`/v1/threads/${threadId}/messages/${messageId}/audio/${direction}/${part}`);
  }
}
