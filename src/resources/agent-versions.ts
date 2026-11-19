import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import type {
  AgentVersion,
  AgentVersionDeleted,
  AgentVersionDetail,
  AgentVersionEventList,
  AgentVersionList,
  CreateAgentVersionParams,
  ListAgentVersionEventsParams,
  ListAgentVersionsParams,
} from '../types/index.js';

/**
 * An agent's configuration versions: snapshots of its instructions and model settings, one of
 * which is live. Every save that changes them makes one (`agents.update`); a run can be pinned to
 * any other with `runs.create({ version })`, and `promote` makes one live (a rollback or a
 * roll-forward).
 */
export class AgentVersionsResource {
  constructor(private client: HTTPClient) {}

  /** The agent's versions, newest first. */
  async list(agentId: string, params?: ListAgentVersionsParams): Promise<AgentVersionList> {
    return this.client.get<AgentVersionList>(path`/v1/agents/${agentId}/versions`, params);
  }

  /** A version with its configuration. */
  async retrieve(agentId: string, version: number): Promise<AgentVersionDetail> {
    return this.client.get<AgentVersionDetail>(path`/v1/agents/${agentId}/versions/${version}`);
  }

  /** Make a version without making it live, unless `promote` is set. */
  async create(agentId: string, params: CreateAgentVersionParams): Promise<AgentVersionDetail> {
    return this.client.post<AgentVersionDetail>(path`/v1/agents/${agentId}/versions`, params);
  }

  /**
   * Make a version live. Refused (409 `agent_version_runtime_mismatch`) for a version made for
   * another kind of agent; `create` with `based_on` saves it forward instead.
   */
  async promote(agentId: string, version: number): Promise<AgentVersionDetail> {
    return this.client.post<AgentVersionDetail>(path`/v1/agents/${agentId}/versions/${version}/promote`);
  }

  /** Retire a version that is not live: it can no longer be pinned or promoted. */
  async retire(agentId: string, version: number): Promise<AgentVersion> {
    return this.client.post<AgentVersion>(path`/v1/agents/${agentId}/versions/${version}/retire`);
  }

  /** Delete a version that is not live. Its number is never given out again. */
  async delete(agentId: string, version: number): Promise<AgentVersionDeleted> {
    return this.client.delete<AgentVersionDeleted>(path`/v1/agents/${agentId}/versions/${version}`);
  }

  /** Changes of the agent's live version, newest first. */
  async events(agentId: string, params?: ListAgentVersionEventsParams): Promise<AgentVersionEventList> {
    return this.client.get<AgentVersionEventList>(path`/v1/agents/${agentId}/version-events`, params);
  }
}
