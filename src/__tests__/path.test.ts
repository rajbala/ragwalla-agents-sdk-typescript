import { describe, it, expect, jest } from '@jest/globals';
import { path } from '../client/path';
import { AgentsResource } from '../resources/agents';
import { MemoriesResource } from '../resources/memories';
import { VectorStoresResource } from '../resources/vector-stores';

const BASE = 'https://api.ragwalla.com/v1';

describe('path', () => {
  it('keeps an ordinary id as one segment', () => {
    expect(path`/v1/agents/${'agent_123'}/tools/${7}`).toBe('/v1/agents/agent_123/tools/7');
  });

  it('cannot leave the route it names: slashes, queries and fragments are encoded', () => {
    const built = path`/v1/agents/${'../organizations/org_1'}`;
    expect(built).toBe('/v1/agents/..%2Forganizations%2Forg_1');
    expect(new URL(built, BASE).pathname).toBe('/v1/agents/..%2Forganizations%2Forg_1');
    expect(path`/v1/agents/${'a?x=1#f'}`).toBe('/v1/agents/a%3Fx%3D1%23f');
    expect(path`/v1/agents/${'a\\..\\b'}`).toBe('/v1/agents/a%5C..%5Cb');
  });

  it('refuses a value that would still be read as a dot segment, or is empty', () => {
    expect(() => path`/v1/agents/${'..'}`).toThrow('Invalid path segment: ".."');
    expect(() => path`/v1/agents/${'.'}`).toThrow('Invalid path segment: "."');
    expect(() => path`/v1/agents/${''}/tools`).toThrow('Invalid path segment: ""');
  });
});

describe('resources encode the ids they are given', () => {
  const client = {
    get: jest.fn<(p: string, params?: unknown) => Promise<unknown>>().mockResolvedValue({}),
    post: jest.fn<(p: string, data?: unknown) => Promise<unknown>>().mockResolvedValue({}),
    delete: jest.fn<(p: string) => Promise<unknown>>().mockResolvedValue({}),
  };

  it('agents.delete with a traversal id stays on the agent route', async () => {
    await new AgentsResource(client as any).delete('../organizations/org_1');
    const sent = client.delete.mock.calls.at(-1)![0];
    expect(new URL(sent, BASE).pathname).toBe('/v1/agents/..%2Forganizations%2Forg_1');
  });

  it('memories.delete keeps its own query string after the encoded ids', async () => {
    await new MemoriesResource(client as any).delete('agent_1', 'mem?x', { user_id: 'u 1' });
    expect(client.delete.mock.calls.at(-1)![0]).toBe('/v1/agents/agent_1/memories/mem%3Fx?user_id=u%201');
  });

  it('vectorStores.search keeps its page token after the encoded id', async () => {
    await new VectorStoresResource(client as any).search('vs/1', { query: 'q' } as any, { page_token: 't&1' });
    expect(client.post.mock.calls.at(-1)![0]).toBe('/v1/vector_stores/vs%2F1/search?page_token=t%261');
  });
});
