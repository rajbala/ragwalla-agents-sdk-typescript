import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AgentsResource } from '../resources/agents';
import type { BulkAttachSkillsResponse, Tool } from '../types';

class MockHTTPClient {
  public get: jest.MockedFunction<(path: string, params?: any) => any> = jest.fn();
  public post: jest.MockedFunction<(path: string, data?: any) => any> = jest.fn();
  public put: jest.MockedFunction<(path: string, data?: any) => any> = jest.fn();
  public delete: jest.MockedFunction<(path: string) => any> = jest.fn();
}

describe('AgentsResource', () => {
  let client: MockHTTPClient;
  let agents: AgentsResource;

  beforeEach(() => {
    client = new MockHTTPClient();
    agents = new AgentsResource(client as any);
  });

  it('maps create-time systemSkillIds to backend systemToolIds', async () => {
    const response = {
      id: 'agent_123',
      name: 'Coordinator',
      systemToolIds: ['create_subagent', 'teardown_subagent'],
    };
    client.post.mockResolvedValue(response);

    const result = await agents.create({
      name: 'Coordinator',
      instructions: 'Coordinate work',
      agentType: 'orchestrator',
      systemSkillIds: ['create_subagent', 'teardown_subagent'],
    });

    expect(client.post).toHaveBeenCalledWith('/v1/agents', {
      name: 'Coordinator',
      instructions: 'Coordinate work',
      agentType: 'orchestrator',
      systemToolIds: ['create_subagent', 'teardown_subagent'],
    });
    expect(result).toEqual(response);
  });

  it('maps update-time systemSkillIds to backend systemToolIds', async () => {
    const response = {
      id: 'agent_123',
      name: 'Coordinator',
      systemToolIds: ['create_subagent'],
    };
    client.put.mockResolvedValue(response);

    await agents.update('agent_123', {
      systemSkillIds: ['create_subagent'],
    });

    expect(client.put).toHaveBeenCalledWith('/v1/agents/agent_123', {
      systemToolIds: ['create_subagent'],
    });
  });

  it('rejects conflicting systemSkillIds and deprecated systemToolIds', async () => {
    await expect(agents.create({
      name: 'Coordinator',
      instructions: 'Coordinate work',
      systemSkillIds: ['create_subagent'],
      systemToolIds: ['teardown_subagent'],
    })).rejects.toThrow('Specify either systemSkillIds or systemToolIds, not both');

    expect(client.post).not.toHaveBeenCalled();
  });

  it('bulk-attaches skills with the expected path and body', async () => {
    const skills: Array<Partial<Tool>> = [
      {
        type: 'mcp',
        name: 'app_read_file',
        title: 'Read File',
        description: 'Read a file from the app workspace',
        serverId: 'mcp_server_123',
        serverName: 'perspect-mcp-server',
        serverUrl: 'https://example.com/mcp/site',
        toolName: 'app_read_file',
        transportType: 'http',
        parameters: {},
      },
    ];

    const response: BulkAttachSkillsResponse = {
      object: 'bulk_attach_result',
      agentId: 'agent_123',
      created: [
        {
          index: 0,
          skill: {
            id: 'tool_123',
            type: 'mcp',
            name: 'app_read_file',
            title: 'Read File',
            description: 'Read a file from the app workspace',
            serverId: 'mcp_server_123',
            serverName: 'perspect-mcp-server',
            serverUrl: 'https://example.com/mcp/site',
            toolName: 'app_read_file',
            transportType: 'http',
            parameters: {},
          },
        },
      ],
      skipped: [],
      failed: [],
      total: 1,
    };
    client.post.mockResolvedValue(response);

    const result = await agents.attachSkills('agent_123', skills);

    expect(client.post).toHaveBeenCalledWith('/v1/agents/agent_123/tools/bulk-attach', {
      skills,
    });
    expect(result).toEqual(response);
    expect(result.object).toBe('bulk_attach_result');
    expect(result.created).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.total).toBe(1);
  });

  it('sets a grant\'s access with the wire body the server validates', async () => {
    const response = {
      object: 'agent_skill_access',
      grant_id: 'ata_1',
      access: { owner_presence: 'attended', audiences: [{ type: 'channel', channel_id: 'ach_1' }] },
      access_controls: { owner_presence: true, audiences: true, runs_as: [] },
    };
    client.put.mockResolvedValue(response);

    const result = await agents.updateSkillAccess('agent_123', 'ata_1', {
      owner_presence: 'attended',
      audiences: [{ type: 'channel', channel_id: 'ach_1' }],
    });

    expect(client.put).toHaveBeenCalledWith('/v1/agents/agent_123/tools/ata_1/access', {
      owner_presence: 'attended',
      audiences: [{ type: 'channel', channel_id: 'ach_1' }],
    });
    expect(result).toEqual(response);
  });

  it('attaches a skill with its access in one request', async () => {
    const response = {
      object: 'agent_skill',
      id: 'ata_2',
      grant_id: 'ata_2',
      agentId: 'agent_123',
      tool: { type: 'mcp', name: 'crm_lookup' },
      access: { owner_presence: 'attended', audiences: [] },
      grantedBy: 'user_1',
      grantedAt: 1,
    };
    client.post.mockResolvedValue(response);

    const result = await agents.attachSkillWithAccess(
      'agent_123',
      { type: 'mcp', name: 'crm_lookup' } as Partial<Tool>,
      { owner_presence: 'attended', audiences: [] }
    );

    expect(client.post).toHaveBeenCalledWith('/v1/agents/agent_123/tools', {
      type: 'mcp',
      name: 'crm_lookup',
      access: { owner_presence: 'attended', audiences: [] },
    });
    expect(result).toEqual(response);
  });

  it('throws when the server granted the skill without the requested access', async () => {
    client.post.mockResolvedValue({ object: 'agent_skill', id: 'ata_3', agentId: 'agent_123', tool: {} });

    await expect(agents.attachSkillWithAccess(
      'agent_123',
      { type: 'mcp', name: 'crm_lookup' } as Partial<Tool>,
      { owner_presence: 'attended', audiences: [] }
    )).rejects.toThrow('granted skill ata_3 to agent agent_123 without the requested access');
  });

  it('passes each bulk item\'s access through', async () => {
    client.post.mockResolvedValue({ object: 'bulk_attach_result', agentId: 'agent_123', created: [], skipped: [], failed: [], total: 1 });

    await agents.attachSkills('agent_123', [
      { type: 'mcp', name: 'crm_lookup', access: { owner_presence: 'attended', audiences: [] } } as Partial<Tool> & { access: { owner_presence: 'attended'; audiences: [] } },
    ]);

    expect(client.post).toHaveBeenCalledWith('/v1/agents/agent_123/tools/bulk-attach', {
      skills: [{ type: 'mcp', name: 'crm_lookup', access: { owner_presence: 'attended', audiences: [] } }],
    });
  });

  it('throws when the server granted a bulk item without the access it asked for', async () => {
    client.post.mockResolvedValue({
      object: 'bulk_attach_result', agentId: 'agent_123', skipped: [], failed: [], total: 1,
      created: [{ index: 0, skill: { id: 'ata_4', type: 'mcp', name: 'crm_lookup' } }],
    });

    await expect(agents.attachSkills('agent_123', [
      { type: 'mcp', name: 'crm_lookup', access: { owner_presence: 'attended', audiences: [] } } as Partial<Tool> & { access: { owner_presence: 'attended'; audiences: [] } },
    ])).rejects.toThrow('granted ata_4 to agent agent_123 without the requested access');
  });
});
