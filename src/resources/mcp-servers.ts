import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import {
  MCPServer,
  CreateMCPServerRequest,
  UpdateMCPServerRequest,
  TestMCPServerRequest,
  MCPDiscoverResponse,
  MCPTestResponse,
  MCPAgentAccess,
  GrantAgentAccessRequest,
  MCPOAuthStartRequest,
  MCPOAuthStartResponse,
  MCPOAuthCallbackRequest,
  MCPOAuthStatusResponse,
  MCPOAuthRefreshResponse,
} from '../types/index.js';

export class MCPServersResource {
  constructor(private client: HTTPClient) {}

  /**
   * Create a new MCP server configuration
   */
  async create(request: CreateMCPServerRequest): Promise<MCPServer> {
    return this.client.post<MCPServer>('/v1/mcp-servers', request);
  }

  /**
   * List all MCP servers for the project
   */
  async list(): Promise<{ servers: MCPServer[] }> {
    return this.client.get<{ servers: MCPServer[] }>('/v1/mcp-servers');
  }

  /**
   * Retrieve a specific MCP server by ID
   */
  async retrieve(serverId: string): Promise<MCPServer> {
    return this.client.get<MCPServer>(path`/v1/mcp-servers/${serverId}`);
  }

  /**
   * Update an MCP server configuration
   */
  async update(serverId: string, request: UpdateMCPServerRequest): Promise<{ success: boolean }> {
    return this.client.put<{ success: boolean }>(path`/v1/mcp-servers/${serverId}`, request);
  }

  /**
   * Delete an MCP server
   */
  async delete(serverId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(path`/v1/mcp-servers/${serverId}`);
  }

  /**
   * Discover tools available on an MCP server.
   * Connects to the server, lists tools, and caches the results.
   */
  async discoverTools(serverId: string): Promise<MCPDiscoverResponse> {
    return this.client.post<MCPDiscoverResponse>(path`/v1/mcp-servers/${serverId}/discover`);
  }

  /**
   * Test an MCP server connection without saving it.
   * Useful for validating server configuration before creating.
   */
  async test(request: TestMCPServerRequest): Promise<MCPTestResponse> {
    return this.client.post<MCPTestResponse>('/v1/mcp-servers/test', request);
  }

  /**
   * Start OAuth (authorization code) flow for an MCP server. A server with no
   * client id gets one from its authorization server: the Client ID Metadata
   * Document at `client_id_metadata_url` where the server takes one, else a
   * dynamic registration named `client_name` for `redirect_uri`. A string is
   * taken as `redirect_uri`.
   */
  async startOAuth(serverId: string, request: MCPOAuthStartRequest | string = {}): Promise<MCPOAuthStartResponse> {
    const body = typeof request === 'string' ? { redirect_uri: request } : request;
    return this.client.post<MCPOAuthStartResponse>(path`/v1/mcp-servers/${serverId}/oauth/start`, body);
  }

  /**
   * Finish an OAuth flow from the `code` and `state` the authorization server
   * sent to the redirect URI. The server and project come from the state; the
   * caller must reach that project.
   */
  async completeOAuth(request: MCPOAuthCallbackRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>('/v1/oauth/mcp/callback', request);
  }

  /**
   * Get OAuth connection status for an MCP server.
   */
  async oauthStatus(serverId: string): Promise<MCPOAuthStatusResponse> {
    return this.client.get<MCPOAuthStatusResponse>(path`/v1/mcp-servers/${serverId}/oauth/status`);
  }

  /**
   * Refresh OAuth token for an MCP server.
   */
  async refreshOAuth(serverId: string): Promise<MCPOAuthRefreshResponse> {
    return this.client.post<MCPOAuthRefreshResponse>(path`/v1/mcp-servers/${serverId}/oauth/refresh`);
  }

  /**
   * Revoke OAuth credentials for an MCP server.
   */
  async revokeOAuth(serverId: string): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(path`/v1/mcp-servers/${serverId}/oauth/revoke`);
  }

  /**
   * Grant or revoke an agent's access to an MCP server
   */
  async grantAgentAccess(serverId: string, request: GrantAgentAccessRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(path`/v1/mcp-servers/${serverId}/access`, request);
  }

  /**
   * List agents that have access to an MCP server
   */
  async listAgentAccess(serverId: string): Promise<{ access: MCPAgentAccess[] }> {
    return this.client.get<{ access: MCPAgentAccess[] }>(path`/v1/mcp-servers/${serverId}/access`);
  }
}
