import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ThreadsResource } from '../resources/threads';
import type { ThreadEvent } from '../types/index';

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
