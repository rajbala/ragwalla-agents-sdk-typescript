import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MessagesResource, ListMessagesResponse, Message } from '../resources/messages';

// Minimal mock of HTTPClient used by MessagesResource
class MockHTTPClient {
  public get: jest.MockedFunction<(path: string, params?: any) => any> = jest.fn();
  public post: jest.MockedFunction<(path: string, data?: any) => any> = jest.fn();
}

describe('MessagesResource', () => {
  let client: MockHTTPClient;
  let messages: MessagesResource;

  beforeEach(() => {
    client = new MockHTTPClient();
    messages = new MessagesResource(client as any);
  });

  it('creates a message on a thread', async () => {
    const fakeMessage: Message = {
      id: 'msg_1',
      object: 'thread.message',
      thread_id: 'thread_1',
      role: 'user',
      content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
    };
    client.post.mockResolvedValue(fakeMessage);

    const result = await messages.create('thread_1', { role: 'user', content: 'hi' });

    expect(client.post).toHaveBeenCalledWith('/v1/threads/thread_1/messages', {
      role: 'user',
      content: 'hi',
    });
    expect(result).toEqual(fakeMessage);
  });

  it('retrieves a single message', async () => {
    const fakeMessage: Message = {
      id: 'msg_2',
      object: 'thread.message',
      thread_id: 'thread_1',
      role: 'assistant',
      content: [{ type: 'text', text: { value: 'hello', annotations: [] } }],
    };
    client.get.mockResolvedValue(fakeMessage);

    const result = await messages.retrieve('thread_1', 'msg_2');

    expect(client.get).toHaveBeenCalledWith('/v1/threads/thread_1/messages/msg_2');
    expect(result).toEqual(fakeMessage);
  });

  it('lists messages with pagination params and returns typed response', async () => {
    const fakeResponse: ListMessagesResponse = {
      object: 'list',
      data: [
        {
          id: 'msg_3',
          object: 'thread.message',
          thread_id: 'thread_1',
          role: 'assistant',
          content: [{ type: 'text', text: { value: 'hey', annotations: [] } }],
          created_at: 1,
        },
      ],
      first_id: 'msg_3',
      last_id: 'msg_3',
      has_more: true,
    };

    client.get.mockResolvedValue(fakeResponse);

    const result = await messages.list('thread_1', {
      limit: 50,
      order: 'desc',
      before: 'msg_99',
      after: undefined,
      run_id: 'run_1',
    });

    expect(client.get).toHaveBeenCalledWith('/v1/threads/thread_1/messages', {
      limit: 50,
      order: 'desc',
      before: 'msg_99',
      after: undefined,
      run_id: 'run_1',
    });
    expect(result).toEqual(fakeResponse);
    expect(result.has_more).toBe(true);
    expect(result.data[0].role).toBe('assistant');
  });

  it('asks for thread events and returns them in place', async () => {
    const fakeResponse: ListMessagesResponse = {
      object: 'list',
      data: [
        {
          id: 'evt_1',
          object: 'thread.message',
          thread_id: 'thread_1',
          role: 'system',
          content: [{ type: 'text', text: { value: 'Build b1 is live.', annotations: [] } }],
          row_kind: 'thread_event',
          event: { type: 'deployment.completed', visibility: 'both', data: { buildId: 'b1' } },
        },
      ],
      first_id: 'evt_1',
      last_id: 'evt_1',
      has_more: false,
    };
    client.get.mockResolvedValue(fakeResponse);

    const result = await messages.list('thread_1', { order: 'asc', include_events: true });

    expect(client.get).toHaveBeenCalledWith('/v1/threads/thread_1/messages', {
      order: 'asc',
      include_events: true,
    });
    expect(result.data[0].event?.type).toBe('deployment.completed');
  });
});
