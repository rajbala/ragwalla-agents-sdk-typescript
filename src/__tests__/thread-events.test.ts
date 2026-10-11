import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ThreadsResource } from '../resources/threads';
import type { CreateThreadEventParams, ThreadEvent } from '../types/index';

class MockHTTPClient {
  public post: jest.MockedFunction<(path: string, data?: any) => any> = jest.fn();
}

describe('threads.events', () => {
  let client: MockHTTPClient;
  let threads: ThreadsResource;

  beforeEach(() => {
    client = new MockHTTPClient();
    threads = new ThreadsResource(client as any);
  });

  it('records an event on a thread', async () => {
    const recorded: ThreadEvent = {
      id: 'evt_1',
      object: 'thread.event',
      thread_id: 'thread_1',
      type: 'deployment.completed',
      visibility: 'both',
      summary: 'Build 14 is live',
      data: { url: 'https://app.example' },
      created_at: 1791741347,
    };
    client.post.mockResolvedValue(recorded);

    const result = await threads.events.create('thread_1', {
      type: 'deployment.completed',
      summary: 'Build 14 is live',
      visibility: 'both',
      data: { url: 'https://app.example' },
      idempotency_key: 'build_14:completed',
    });

    expect(client.post).toHaveBeenCalledWith('/v1/threads/thread_1/events', {
      type: 'deployment.completed',
      summary: 'Build 14 is live',
      visibility: 'both',
      data: { url: 'https://app.example' },
      idempotency_key: 'build_14:completed',
    });
    expect(result).toEqual(recorded);
  });
});

describe('CreateThreadEventParams', () => {
  // Checked by the type checker (ts-jest compiles this file): an event the agent can see
  // must carry the summary the agent reads.
  it('requires a summary when the agent can see the event', () => {
    const clientOnly: CreateThreadEventParams = { type: 'tick' };
    const forAgent: CreateThreadEventParams = { type: 'note', visibility: 'agent', summary: 'read me' };
    // @ts-expect-error -- an agent-visible event without a summary is rejected at compile time
    const missingSummary: CreateThreadEventParams = { type: 'note', visibility: 'both' };
    expect([clientOnly, forAgent, missingSummary]).toHaveLength(3);
  });
});
