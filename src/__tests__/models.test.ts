import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ModelsResource } from '../resources/models';
import type { Model } from '../types';

class MockHTTPClient {
  public get: jest.MockedFunction<(path: string, params?: any) => any> = jest.fn();
}

describe('ModelsResource', () => {
  let client: MockHTTPClient;
  let models: ModelsResource;

  beforeEach(() => {
    client = new MockHTTPClient();
    models = new ModelsResource(client as any);
  });

  it('lists the models', async () => {
    const chat: Model = {
      id: 'gpt-5.5', object: 'model', created: 0, owned_by: 'openai',
      pricing: { prompt: '0.000002', completion: '0.00001' },
      ragwalla: { type: 'model', kind: 'chat', provider: 'openai', surface: 'chat_completions', capabilities: { tools: true } },
    };
    client.get.mockResolvedValue({ object: 'list', data: [chat] });
    const result = await models.list();
    expect(client.get).toHaveBeenCalledWith('/v1/models');
    expect(result.data).toEqual([chat]);
  });

  it('retrieves a vendor-qualified model, each part of its id one encoded segment', async () => {
    client.get.mockResolvedValue({});
    await models.retrieve('@cf/zai-org/glm-5.2');
    expect(client.get).toHaveBeenCalledWith('/v1/models/%40cf/zai-org/glm-5.2');
    await models.retrieve('gpt-5.5');
    expect(client.get).toHaveBeenLastCalledWith('/v1/models/gpt-5.5');
  });

  it('refuses an id that would leave the models route', async () => {
    await expect(models.retrieve('../agents')).rejects.toThrow('Invalid path segment');
    await expect(models.retrieve('openai/')).rejects.toThrow('Invalid path segment');
    expect(client.get).not.toHaveBeenCalled();
  });
});
