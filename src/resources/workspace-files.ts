import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import {
  WorkspaceFile,
  WorkspaceFileType,
  CreateWorkspaceFileRequest,
  UpdateWorkspaceFileRequest,
  WorkspacePreview,
} from '../types/index.js';

export class WorkspaceFilesResource {
  constructor(private client: HTTPClient) {}

  /**
   * Create or upsert a workspace file for an agent
   */
  async create(agentId: string, request: CreateWorkspaceFileRequest): Promise<WorkspaceFile> {
    return this.client.post<WorkspaceFile>(path`/v1/agents/${agentId}/workspace/files`, request);
  }

  /**
   * List all workspace files for an agent
   */
  async list(agentId: string): Promise<{ files: WorkspaceFile[] }> {
    return this.client.get<{ files: WorkspaceFile[] }>(path`/v1/agents/${agentId}/workspace/files`);
  }

  /**
   * Retrieve a specific workspace file by type
   */
  async retrieve(agentId: string, fileType: WorkspaceFileType): Promise<WorkspaceFile> {
    return this.client.get<WorkspaceFile>(path`/v1/agents/${agentId}/workspace/files/${fileType}`);
  }

  /**
   * Update a workspace file's content or enabled state
   */
  async update(agentId: string, fileType: WorkspaceFileType, request: UpdateWorkspaceFileRequest): Promise<WorkspaceFile> {
    return this.client.put<WorkspaceFile>(path`/v1/agents/${agentId}/workspace/files/${fileType}`, request);
  }

  /**
   * Delete a workspace file
   */
  async delete(agentId: string, fileType: WorkspaceFileType): Promise<{ deleted: boolean }> {
    return this.client.delete<{ deleted: boolean }>(path`/v1/agents/${agentId}/workspace/files/${fileType}`);
  }

  /**
   * Preview the composed system prompt from all enabled workspace files
   */
  async preview(agentId: string): Promise<WorkspacePreview> {
    return this.client.get<WorkspacePreview>(path`/v1/agents/${agentId}/workspace/preview`);
  }
}
