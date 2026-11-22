import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import { Model, ModelsListResponse } from '../types/index.js';

/**
 * The models this endpoint serves (`GET /v1/models`): chat, embedding, speech and transcription
 * models, each marked with its `ragwalla.kind`, and the agents the key can run as `agent/<id>`.
 */
export class ModelsResource {
  constructor(private client: HTTPClient) {}

  /** Every model and agent the key can use. */
  async list(): Promise<ModelsListResponse> {
    return this.client.get<ModelsListResponse>('/v1/models');
  }

  /** One model by its id, which may be vendor-qualified (`anthropic/claude-sonnet-5.5`, `@cf/zai-org/glm-5.2`). */
  async retrieve(modelId: string): Promise<Model> {
    // Each part of the id is its own path segment, encoded and checked as any id is.
    const segments = modelId.split('/').map((part) => path`${part}`);
    return this.client.get<Model>(`/v1/models/${segments.join('/')}`);
  }
}
