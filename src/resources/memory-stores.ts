import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import {
  MemoryStore,
  CreateMemoryStoreRequest,
  UpdateMemoryStoreRequest,
  AttachMemoryStoreRequest,
  MemoryStoreAttachment,
  ListMemoryStoresResponse,
  ListMemoryStoreAttachmentsResponse,
} from '../types/index.js';

export class MemoryStoresResource {
  constructor(private client: HTTPClient) {}

  /**
   * Create a new memory store in a project.
   * The project is inferred from the X-Project-ID header (set via config.projectId).
   */
  async create(request: CreateMemoryStoreRequest): Promise<MemoryStore> {
    return this.client.post<MemoryStore>('/v1/memory_stores', request);
  }

  /**
   * Retrieve a memory store by ID.
   */
  async retrieve(storeId: string): Promise<MemoryStore> {
    return this.client.get<MemoryStore>(path`/v1/memory_stores/${storeId}`);
  }

  /**
   * List memory stores in the project (inferred from X-Project-ID header).
   */
  async list(params?: { limit?: number; offset?: number }): Promise<ListMemoryStoresResponse> {
    return this.client.get<ListMemoryStoresResponse>('/v1/memory_stores', params);
  }

  /**
   * Update a memory store.
   */
  async update(storeId: string, request: UpdateMemoryStoreRequest): Promise<MemoryStore> {
    return this.client.put<MemoryStore>(path`/v1/memory_stores/${storeId}`, request);
  }

  /**
   * Delete a memory store. Fails if agents are still attached.
   */
  async delete(storeId: string): Promise<{ deleted: boolean; id: string }> {
    return this.client.delete<{ deleted: boolean; id: string }>(path`/v1/memory_stores/${storeId}`);
  }

  /**
   * Attach a memory store to an agent.
   */
  async attachToAgent(agentId: string, request: AttachMemoryStoreRequest): Promise<MemoryStoreAttachment> {
    return this.client.post<MemoryStoreAttachment>(path`/v1/agents/${agentId}/memory_stores`, request);
  }

  /**
   * List memory stores attached to an agent.
   */
  async listForAgent(agentId: string): Promise<ListMemoryStoreAttachmentsResponse> {
    return this.client.get<ListMemoryStoreAttachmentsResponse>(path`/v1/agents/${agentId}/memory_stores`);
  }

  /**
   * Detach a memory store from an agent.
   */
  async detachFromAgent(agentId: string, storeId: string): Promise<{ agent_id: string; memory_store_id: string; deleted: boolean }> {
    return this.client.delete<{ agent_id: string; memory_store_id: string; deleted: boolean }>(path`/v1/agents/${agentId}/memory_stores/${storeId}`);
  }
}
