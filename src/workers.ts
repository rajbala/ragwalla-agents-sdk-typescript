// Workers-specific export that excludes Node.js dependencies
export * from './types/index.js';
export * from './resources/agents.js';
export * from './resources/assistants.js';
export * from './resources/threads.js';
export * from './resources/vector-stores.js';
export * from './resources/quota.js';
export * from './resources/models.js';
export * from './resources/workspace-files.js';
export * from './resources/memories.js';
export * from './resources/endpoints.js';
export * from './resources/namespace-flags.js';
export { HTTPClient, RagwallaAPIError } from './client/http-client.js';
export { RagwallaWebSocket } from './client/websocket-client.js';
export type { WebSocketRequestOptions } from './client/websocket-client.js';

import { RagwallaConfig } from './types/index.js';
import { HTTPClient } from './client/http-client.js';
import { RagwallaWebSocket } from './client/websocket-client.js';
import type { WebSocketReconnectTokenProvider } from './client/websocket-client.js';
import { AgentsResource } from './resources/agents.js';
import { AssistantsResource } from './resources/assistants.js';
import { ThreadsResource } from './resources/threads.js';
import { VectorStoresResource } from './resources/vector-stores.js';
import { QuotaResource } from './resources/quota.js';
import { ModelsResource } from './resources/models.js';
import { WorkspaceFilesResource } from './resources/workspace-files.js';
import { MemoriesResource } from './resources/memories.js';
import { EndpointsResource } from './resources/endpoints.js';
import { NamespaceFlagsResource } from './resources/namespace-flags.js';

/**
 * Ragwalla SDK optimized for Cloudflare Workers
 *
 * @example
 * ```typescript
 * import { Ragwalla } from '@ragwalla/agents-sdk/workers';
 *
 * const ragwalla = new Ragwalla({
 *   apiKey: env.RAGWALLA_API_KEY // Use environment bindings in Workers
 * });
 * ```
 */
export class Ragwalla {
  public readonly agents: AgentsResource;
  public readonly assistants: AssistantsResource;
  public readonly threads: ThreadsResource;
  public readonly vectorStores: VectorStoresResource;
  public readonly quota: QuotaResource;
  public readonly models: ModelsResource;
  public readonly workspaceFiles: WorkspaceFilesResource;
  public readonly memories: MemoriesResource;
  public readonly endpoints: EndpointsResource;
  public readonly namespaceFlags: NamespaceFlagsResource;

  private config: RagwallaConfig;

  constructor(config: RagwallaConfig) {
    if (!config.apiKey) {
      throw new Error('Ragwalla API key is required');
    }

    this.config = config;
    const client = new HTTPClient(config);
    this.agents = new AgentsResource(client);
    this.assistants = new AssistantsResource(client);
    this.threads = new ThreadsResource(client);
    this.vectorStores = new VectorStoresResource(client);
    this.quota = new QuotaResource(client);
    this.models = new ModelsResource(client);
    this.workspaceFiles = new WorkspaceFilesResource(client);
    this.memories = new MemoriesResource(client);
    this.endpoints = new EndpointsResource(client);
    this.namespaceFlags = new NamespaceFlagsResource(client);
  }

  /**
   * Create a WebSocket connection for real-time communication
   */
  createWebSocket(config?: {
    reconnectAttempts?: number;
    reconnectDelay?: number;
    continuationMode?: 'auto' | 'manual';
    getReconnectToken?: WebSocketReconnectTokenProvider;
  }) {
    return new RagwallaWebSocket({
      baseURL: this.config.baseURL,
      debug: this.config.debug,
      ...config
    });
  }
}

export default Ragwalla;
