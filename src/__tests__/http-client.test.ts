import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HTTPClient } from '../client/http-client';

describe('where a request goes, and the endpoint it names', () => {
  let originalFetch: unknown;
  let fetchMock: jest.Mock<(url: string, init: RequestInit) => Promise<Response>>;

  beforeEach(() => {
    originalFetch = (globalThis as any).fetch;
    fetchMock = jest.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  function lastRequest(): { url: string; headers: Record<string, string> } {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return { url, headers: init.headers as Record<string, string> };
  }

  it('goes to api.ragwalla.com when no baseURL is given, where the key names its endpoint', async () => {
    await new HTTPClient({ apiKey: 'sk-test' }).get('/v1/agents');

    expect(lastRequest().url).toBe('https://api.ragwalla.com/v1/agents');
  });

  it('goes to the baseURL it is given', async () => {
    await new HTTPClient({ apiKey: 'sk-test', baseURL: 'https://acme.ragwalla.ai.ragwalla.com/v1' }).get('/v1/agents');

    expect(lastRequest().url).toBe('https://acme.ragwalla.ai.ragwalla.com/v1/agents');
  });

  it("names a platform key's endpoint in X-Worker-ID", async () => {
    const client = new HTTPClient({ apiKey: 'pk-test', endpointId: 'acme' });

    await client.get('/v1/agents');
    expect(lastRequest().headers['X-Worker-ID']).toBe('acme');

    await client.postFormData('/v1/files', new FormData());
    expect(lastRequest().headers['X-Worker-ID']).toBe('acme');
  });

  it('names no endpoint without an endpointId', async () => {
    await new HTTPClient({ apiKey: 'sk-test' }).get('/v1/agents');

    expect(lastRequest().headers).not.toHaveProperty('X-Worker-ID');
  });
});
