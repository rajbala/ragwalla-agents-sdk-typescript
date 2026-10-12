import { HTTPClient } from './client/http-client.js';
import { RagwallaWebSocket } from './client/websocket-client.js';
import type { WebSocketConfig } from './client/websocket-client.js';
import { AgentsResource } from './resources/agents.js';
import { AssistantsResource } from './resources/assistants.js';
import { ThreadsResource } from './resources/threads.js';
import { MessagesResource } from './resources/messages.js';
import { VectorStoresResource } from './resources/vector-stores.js';
import { QuotaResource } from './resources/quota.js';
import { MCPServersResource } from './resources/mcp-servers.js';
import { ChannelsResource } from './resources/channels.js';
import { OrganizationsResource } from './resources/organizations.js';
import { ModelsResource } from './resources/models.js';
import { WorkspaceFilesResource } from './resources/workspace-files.js';
import { MemoriesResource } from './resources/memories.js';
import { FeatureFlagsResource } from './resources/feature-flags.js';
import { EndpointsResource } from './resources/endpoints.js';
import { NamespaceFlagsResource } from './resources/namespace-flags.js';
import { KnowledgeGraphsResource } from './resources/knowledge-graphs.js';
import { MemoryStoresResource } from './resources/memory-stores.js';
import { FilesResource } from './resources/files.js';
import { RagwallaConfig } from './types/index.js';

export class Ragwalla {
  public readonly agents: AgentsResource;
  public readonly assistants: AssistantsResource;
  public readonly threads: ThreadsResource;
  public readonly messages: MessagesResource;
  public readonly vectorStores: VectorStoresResource;
  public readonly quota: QuotaResource;
  public readonly mcpServers: MCPServersResource;
  public readonly channels: ChannelsResource;
  public readonly organizations: OrganizationsResource;
  public readonly models: ModelsResource;
  public readonly workspaceFiles: WorkspaceFilesResource;
  public readonly memories: MemoriesResource;
  public readonly featureFlags: FeatureFlagsResource;
  public readonly endpoints: EndpointsResource;
  public readonly namespaceFlags: NamespaceFlagsResource;
  public readonly knowledgeGraphs: KnowledgeGraphsResource;
  public readonly memoryStores: MemoryStoresResource;
  public readonly files: FilesResource;

  private httpClient: HTTPClient;
  private config: RagwallaConfig;

  constructor(config: RagwallaConfig) {
    if (!config.apiKey) {
      throw new Error('Ragwalla API key is required');
    }

    this.config = config;
    this.httpClient = new HTTPClient(config);
    this.agents = new AgentsResource(this.httpClient);
    this.assistants = new AssistantsResource(this.httpClient);
    this.threads = new ThreadsResource(this.httpClient);
    this.messages = new MessagesResource(this.httpClient);
    this.vectorStores = new VectorStoresResource(this.httpClient);
    this.quota = new QuotaResource(this.httpClient);
    this.mcpServers = new MCPServersResource(this.httpClient);
    this.channels = new ChannelsResource(this.httpClient);
    this.organizations = new OrganizationsResource(this.httpClient);
    this.models = new ModelsResource(this.httpClient);
    this.workspaceFiles = new WorkspaceFilesResource(this.httpClient);
    this.memories = new MemoriesResource(this.httpClient);
    this.featureFlags = new FeatureFlagsResource(this.httpClient);
    this.endpoints = new EndpointsResource(this.httpClient);
    this.namespaceFlags = new NamespaceFlagsResource(this.httpClient);
    this.knowledgeGraphs = new KnowledgeGraphsResource(this.httpClient);
    this.memoryStores = new MemoryStoresResource(this.httpClient);
    this.files = new FilesResource(this.httpClient);
  }

  /**
   * Create a WebSocket connection for real-time communication
   */
  // Every WebSocketConfig option except the two this client supplies, so a new socket
  // option (includeEvents, truncationStrategy, ...) is reachable here without a cast.
  createWebSocket(config?: Omit<WebSocketConfig, 'baseURL' | 'debug'>): RagwallaWebSocket {
    return new RagwallaWebSocket({
      baseURL: this.config.baseURL,
      debug: this.config.debug,
      ...config
    });
  }

  /**
   * Static method to create a Ragwalla client
   */
  static create(config: RagwallaConfig): Ragwalla {
    return new Ragwalla(config);
  }
}

// Export all types and classes
export * from './types/index.js';
export * from './client/http-client.js';
export * from './client/websocket-client.js';
export * from './resources/agents.js';
export * from './resources/assistants.js';
export * from './resources/threads.js';
export * from './resources/messages.js';
export * from './resources/vector-stores.js';
export * from './resources/quota.js';
export * from './resources/mcp-servers.js';
export * from './resources/channels.js';
export * from './resources/organizations.js';
export * from './resources/models.js';
export * from './resources/workspace-files.js';
export * from './resources/memories.js';
export * from './resources/feature-flags.js';
export * from './resources/endpoints.js';
export * from './resources/namespace-flags.js';
export * from './resources/knowledge-graphs.js';
export * from './resources/memory-stores.js';
export * from './resources/files.js';

// Default export
export default Ragwalla;
