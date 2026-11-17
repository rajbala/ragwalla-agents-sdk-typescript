import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import {
  Memory,
  CreateMemoryRequest,
  BatchCreateMemoryRequest,
  SearchMemoriesRequest,
  ListMemoriesParams,
  ListMemoriesResponse,
  SearchMemoriesResponse,
  BatchCreateMemoryResponse,
  RetrieveMemoryParams,
  DeleteMemoryParams,
} from '../types/index.js';

export class MemoriesResource {
  constructor(private client: HTTPClient) {}

  /**
   * List memories for an agent with optional filtering and pagination.
   * Pass `user_id` to target a specific user's memory graph.
   * Pass `memory_store_id` to target a specific memory store.
   */
  async list(agentId: string, params?: ListMemoriesParams): Promise<ListMemoriesResponse> {
    return this.client.get<ListMemoriesResponse>(path`/v1/agents/${agentId}/memories`, params);
  }

  /**
   * Retrieve a single memory by ID.
   * Pass `user_id` in params to target a specific user's memory graph.
   */
  async retrieve(agentId: string, memoryId: string, params?: RetrieveMemoryParams): Promise<Memory> {
    return this.client.get<Memory>(path`/v1/agents/${agentId}/memories/${memoryId}`, params);
  }

  /**
   * Create a single memory for an agent.
   * Include `user_id` in the request to target a specific user's memory graph.
   */
  async create(agentId: string, request: CreateMemoryRequest): Promise<Memory> {
    return this.client.post<Memory>(path`/v1/agents/${agentId}/memories`, request);
  }

  /**
   * Create multiple memories in a single batch (max 20).
   * Include `user_id` in the request to target a specific user's memory graph.
   */
  async createBatch(agentId: string, request: BatchCreateMemoryRequest): Promise<BatchCreateMemoryResponse> {
    return this.client.post<BatchCreateMemoryResponse>(path`/v1/agents/${agentId}/memories`, request);
  }

  /**
   * Delete a memory by ID.
   * Pass `user_id` in params to target a specific user's memory graph.
   * Pass `memory_store_id` to target a specific memory store.
   */
  async delete(agentId: string, memoryId: string, params?: DeleteMemoryParams): Promise<{ deleted: boolean; id: string }> {
    const queryParts: string[] = [];
    if (params?.user_id) queryParts.push(`user_id=${encodeURIComponent(params.user_id)}`);
    if (params?.memory_store_id) queryParts.push(`memory_store_id=${encodeURIComponent(params.memory_store_id)}`);
    const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    return this.client.delete<{ deleted: boolean; id: string }>(path`/v1/agents/${agentId}/memories/${memoryId}` + queryString);
  }

  /**
   * Semantic search over an agent's memories.
   * Include `user_id` in the request to target a specific user's memory graph.
   */
  async search(agentId: string, request: SearchMemoriesRequest): Promise<SearchMemoriesResponse> {
    return this.client.post<SearchMemoriesResponse>(path`/v1/agents/${agentId}/memories/search`, request);
  }
}
