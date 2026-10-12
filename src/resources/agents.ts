import { HTTPClient } from '../client/http-client.js';
import {
  Agent,
  AgentChild,
  CreateAgentRequest,
  UpdateAgentRequest,
  ConnectionToken,
  Tool,
  ToolType,
  SystemTool,
  AgentToolGrant,
  ToolAccess,
  ToolAccessResponse,
  AttachSkillWithAccessResponse,
  type BulkAttachSkillsResponse,
} from '../types/index.js';

export class AgentsResource {
  constructor(private client: HTTPClient) {}

  private normalizeSystemSkillProvisioning<T extends CreateAgentRequest | UpdateAgentRequest>(
    request: T
  ): Omit<T, 'systemSkillIds'> & { systemToolIds?: string[] } {
    const { systemSkillIds, systemToolIds, ...rest } = request;

    if (systemSkillIds !== undefined && systemToolIds !== undefined) {
      const sameIds =
        systemSkillIds.length === systemToolIds.length &&
        systemSkillIds.every((id, index) => id === systemToolIds[index]);

      if (!sameIds) {
        throw new Error('Specify either systemSkillIds or systemToolIds, not both');
      }
    }

    return {
      ...rest,
      ...(systemSkillIds !== undefined
        ? { systemToolIds: systemSkillIds }
        : systemToolIds !== undefined
          ? { systemToolIds }
          : {}),
    } as Omit<T, 'systemSkillIds'> & { systemToolIds?: string[] };
  }

  private unwrapToolResponse(response: any): Tool {
    if (response && typeof response === 'object' && 'tool' in response && response.tool) {
      return response.tool as Tool;
    }
    return response as Tool;
  }

  /**
   * Create a new agent
   */
  async create(request: CreateAgentRequest): Promise<Agent> {
    return this.client.post<Agent>(
      '/v1/agents',
      this.normalizeSystemSkillProvisioning(request)
    );
  }

  /**
   * Retrieve an agent by ID
   */
  async retrieve(agentId: string): Promise<Agent> {
    return this.client.get<Agent>(`/v1/agents/${agentId}`);
  }

  /**
   * List all agents
   */
  async list(params?: {
    limit?: number;
    order?: 'asc' | 'desc';
    after?: string;
    before?: string;
  }): Promise<{ object: 'list'; data: Agent[] }> {
    return this.client.get<{ object: 'list'; data: Agent[] }>('/v1/agents', params);
  }

  /**
   * Update an agent
   */
  async update(agentId: string, request: UpdateAgentRequest): Promise<Agent> {
    return this.client.put<Agent>(
      `/v1/agents/${agentId}`,
      this.normalizeSystemSkillProvisioning(request)
    );
  }

  /**
   * Delete an agent
   */
  async delete(agentId: string): Promise<{ id: string; object: 'agent'; deleted: boolean }> {
    return this.client.delete<{ id: string; object: 'agent'; deleted: boolean }>(`/v1/agents/${agentId}`);
  }

  /**
   * Get connection token for WebSocket access
   * Note: This endpoint generates a token for WebSocket authentication.
   * Use the token with RagwallaWebSocket.connect() to establish a real-time connection.
   */
  async getToken(params?: {
    agent_id?: string;
    expires_in?: number;
  }): Promise<ConnectionToken> {
    return this.client.post<ConnectionToken>('/v1/agents/auth/websocket', params);
  }

  /**
   * List skills attached to an agent
   */
  async listSkills(
    agentId: string,
    params?: { type?: ToolType }
  ): Promise<{ object: 'list'; data: AgentToolGrant[] }> {
    return this.client.get<{ object: 'list'; data: AgentToolGrant[] }>(`/v1/agents/${agentId}/tools`, params);
  }

  /** @deprecated Use listSkills() instead */
  async listTools(
    agentId: string,
    params?: { type?: ToolType }
  ): Promise<{ object: 'list'; data: AgentToolGrant[] }> {
    return this.listSkills(agentId, params);
  }

  /**
   * Attach a skill to an agent
   */
  async attachSkill(agentId: string, skill: Partial<Tool>): Promise<Tool> {
    const response = await this.client.post<any>(`/v1/agents/${agentId}/tools`, skill);
    return this.unwrapToolResponse(response);
  }

  /**
   * Attach a skill to an agent together with who may make the agent use it, in one request:
   * the grant is never live at another decision, as it is between attachSkill() and
   * updateSkillAccess().
   *
   * Refusals are a `RagwallaAPIError` whose `code` says why; nothing is granted:
   * - 400 `unknown_channel`: an audience is not one of this agent's channels;
   * - 409 `skill_already_attached`: the agent already has this skill; set its access with
   *   updateSkillAccess();
   * - 409 `tool_access_fixed`: the skill reaches a built-in whose rule fixes what was asked;
   * - 409 `tool_changed`: a requested channel changed, or the skill was granted, while this
   *   request was in flight; read the agent's skills and channels again.
   *
   * A server that predates this option ignores `access` and grants the skill at the default;
   * this throws then, naming the grant, so its access can be set with updateSkillAccess().
   */
  async attachSkillWithAccess(
    agentId: string,
    skill: Partial<Tool>,
    access: ToolAccess
  ): Promise<AttachSkillWithAccessResponse> {
    const response = await this.client.post<AttachSkillWithAccessResponse>(`/v1/agents/${agentId}/tools`, { ...skill, access });
    if (response.access === undefined) {
      throw new Error(
        `The server granted skill ${response.id} to agent ${agentId} without the requested access: `
        + 'it does not support access on attach. Set it with updateSkillAccess().'
      );
    }
    return response;
  }

  /**
   * Attach multiple skills to an agent in one request. An item may carry `access`, which it is
   * granted with as attachSkillWithAccess() would grant it; such an item is refused as its own
   * attach would be, as a `failed` item with the error's `code`. A skill the agent already has
   * is then a failed item (`skill_already_attached`), never a skipped one.
   */
  async attachSkills(
    agentId: string,
    skills: Array<Partial<Tool> & { access?: ToolAccess }>
  ): Promise<BulkAttachSkillsResponse> {
    const response = await this.client.post<BulkAttachSkillsResponse>(
      `/v1/agents/${agentId}/tools/bulk-attach`,
      { skills }
    );
    // A server that predates access on attach strips it and grants the skill at the default.
    const unapplied = response.created.filter((item) => skills[item.index].access !== undefined && item.access === undefined);
    if (unapplied.length > 0) {
      throw new Error(
        `The server granted ${unapplied.map((item) => item.skill.id).join(', ')} to agent ${agentId} without the requested access: `
        + 'it does not support access on attach. Set it with updateSkillAccess().'
      );
    }
    return response;
  }

  /** @deprecated Use attachSkill() instead */
  async attachTool(agentId: string, tool: Partial<Tool>): Promise<Tool> {
    return this.attachSkill(agentId, tool);
  }

  /**
   * Update an existing skill on an agent
   */
  async updateSkill(agentId: string, skillId: string, updates: Partial<Tool>): Promise<Tool> {
    const response = await this.client.put<any>(`/v1/agents/${agentId}/tools/${skillId}`, updates);
    return this.unwrapToolResponse(response);
  }

  /** @deprecated Use updateSkill() instead */
  async updateTool(agentId: string, toolId: string, updates: Partial<Tool>): Promise<Tool> {
    return this.updateSkill(agentId, toolId, updates);
  }

  /**
   * Set who may make the agent use a granted skill: how present the owner must be for a turn
   * rooted in them (`owner_presence`), and the channels whose outside senders it also admits
   * (`audiences`, replacing the current list). Takes the grant's `grant_id` from listSkills().
   *
   * Refusals are a `RagwallaAPIError` whose `code` says why:
   * - 400 `unknown_channel`: an audience is not one of this agent's channels;
   * - 404 `agent_skill_not_found`: no such grant on this agent;
   * - 409 `tool_access_fixed`: the grant reaches a built-in whose rule fixes what was asked
   *   (see the grant's `access_controls`);
   * - 409 `tool_changed`: the grant changed while this request was in flight; read it again
   *   before deciding again.
   */
  async updateSkillAccess(agentId: string, grantId: string, access: ToolAccess): Promise<ToolAccessResponse> {
    return this.client.put<ToolAccessResponse>(`/v1/agents/${agentId}/tools/${grantId}/access`, access);
  }

  /**
   * Remove a skill from an agent
   */
  async detachSkill(agentId: string, skillId: string): Promise<{ id: string; object: 'tool'; deleted: boolean }> {
    return this.client.delete<{ id: string; object: 'tool'; deleted: boolean }>(`/v1/agents/${agentId}/tools/${skillId}`);
  }

  /** @deprecated Use detachSkill() instead */
  async detachTool(agentId: string, toolId: string): Promise<{ id: string; object: 'tool'; deleted: boolean }> {
    return this.detachSkill(agentId, toolId);
  }

  /**
   * List available system skills that can be enabled for agents
   */
  async listSystemSkills(): Promise<{ object: 'list'; data: SystemTool[] }> {
    return this.client.get<{ object: 'list'; data: SystemTool[] }>('/v1/system-skills');
  }

  /** @deprecated Use listSystemSkills() instead */
  async listSystemTools(): Promise<{ object: 'list'; data: SystemTool[] }> {
    return this.listSystemSkills();
  }

  /**
   * Enable a system skill for an agent
   */
  async enableSystemSkill(agentId: string, skillId: string): Promise<Tool> {
    const response = await this.client.post<any>(`/v1/agents/${agentId}/tools/enable-system`, { toolId: skillId });
    return this.unwrapToolResponse(response);
  }

  /**
   * Bulk-enable system skills for an agent in a single request.
   * Returns the list of newly enabled skill IDs and how many were skipped (already enabled).
   */
  async enableSystemSkillsBulk(agentId: string, skillIds: string[]): Promise<{
    object: 'bulk_enable_result';
    agentId: string;
    enabled: string[];
    skipped: number;
    total: number;
  }> {
    return this.client.post(`/v1/agents/${agentId}/tools/bulk-enable-system`, { toolIds: skillIds });
  }

  /** @deprecated Use enableSystemSkill() instead */
  async enableSystemTool(agentId: string, toolId: string): Promise<Tool> {
    return this.enableSystemSkill(agentId, toolId);
  }

  /**
   * Grant delegation permission: allow this agent to delegate to targetAgentId
   */
  async grantDelegationPermission(
    agentId: string,
    targetAgentId: string,
    targetAgentName?: string
  ): Promise<{ success: boolean; source_agent_id: string; target_agent_id: string; tool_id: string }> {
    return this.client.post(`/v1/agents/${agentId}/delegation-permissions`, {
      targetAgentId,
      targetAgentName,
    });
  }

  /**
   * Revoke delegation permission
   */
  async revokeDelegationPermission(
    agentId: string,
    targetAgentId: string
  ): Promise<{ success: boolean; source_agent_id: string; target_agent_id: string }> {
    return this.client.delete(`/v1/agents/${agentId}/delegation-permissions/${targetAgentId}`);
  }

  /**
   * List active child agents (subagents) for an orchestrator agent
   */
  async listChildren(agentId: string): Promise<{ object: 'list'; data: AgentChild[] }> {
    return this.client.get<{ object: 'list'; data: AgentChild[] }>(`/v1/agents/${agentId}/children`);
  }

  /**
   * Tear down a specific child agent
   */
  async teardownChild(
    agentId: string,
    childAgentId: string
  ): Promise<{ success: boolean; deleted: boolean }> {
    return this.client.delete<{ success: boolean; deleted: boolean }>(
      `/v1/agents/${agentId}/children/${childAgentId}`
    );
  }

  /**
   * Tear down all ephemeral child agents for an orchestrator agent
   */
  async teardownAllChildren(
    agentId: string
  ): Promise<{ success: boolean; torn_down: number }> {
    return this.client.post<{ success: boolean; torn_down: number }>(
      `/v1/agents/${agentId}/children/teardown-all`
    );
  }

  /**
   * Refresh agent tool definitions by syncing MCP tools from their servers
   * and reloading all tools from the database
   */
  async refreshTools(agentId: string): Promise<{
    message: string;
    refreshed: number;
    mcp_synced: number;
    mcp_updated: number;
    cacheCleared: boolean;
    tools: Array<{ type: string; name: string; description?: string }>;
    sync_errors?: string[];
  }> {
    return this.client.post(`/v1/agents/${agentId}/tools/refresh`);
  }

  /**
   * Attach a knowledge graph to an agent
   */
  async attachKnowledgeGraph(
    agentId: string,
    request: { knowledge_base_id: string }
  ): Promise<{ agent_id: string; knowledge_base_id: string; created_at: number }> {
    return this.client.post(`/v1/agents/${agentId}/knowledge_graphs`, request);
  }

  /**
   * List knowledge graphs attached to an agent
   */
  async listKnowledgeGraphs(
    agentId: string
  ): Promise<{ object: 'list'; data: any[] }> {
    return this.client.get(`/v1/agents/${agentId}/knowledge_graphs`);
  }

  /**
   * Detach a knowledge graph from an agent
   */
  async detachKnowledgeGraph(
    agentId: string,
    kgId: string
  ): Promise<{ agent_id: string; knowledge_base_id: string; deleted: boolean }> {
    return this.client.delete(`/v1/agents/${agentId}/knowledge_graphs/${kgId}`);
  }
}
