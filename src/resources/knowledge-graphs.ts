import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import {
  KnowledgeGraph,
  CreateKnowledgeGraphRequest,
  UpdateKnowledgeGraphRequest,
  SuggestKnowledgeGraphSchemaRequest,
  SuggestKnowledgeGraphSchemaResponse,
  KgFileAssociation,
  KgEntity,
  KgRelationship,
  KgSearchRequest,
  KgSearchResponse,
  KgQueryRequest,
  KgQueryResponse,
  KgInfrastructureStatus,
} from '../types/index.js';

export class KnowledgeGraphsResource {
  constructor(private client: HTTPClient) {}

  /**
   * Create a new knowledge graph
   */
  async create(request: CreateKnowledgeGraphRequest): Promise<KnowledgeGraph> {
    return this.client.post<KnowledgeGraph>('/v1/knowledge_graphs', request);
  }

  /**
   * List all knowledge graphs
   */
  async list(params?: {
    limit?: number;
    offset?: number;
  }): Promise<{ object: 'list'; data: KnowledgeGraph[] }> {
    return this.client.get<{ object: 'list'; data: KnowledgeGraph[] }>('/v1/knowledge_graphs', params);
  }

  /**
   * Retrieve a knowledge graph by ID
   */
  async retrieve(kgId: string): Promise<KnowledgeGraph> {
    return this.client.get<KnowledgeGraph>(path`/v1/knowledge_graphs/${kgId}`);
  }

  /**
   * Update a knowledge graph
   */
  async update(kgId: string, request: UpdateKnowledgeGraphRequest): Promise<KnowledgeGraph> {
    return this.client.post<KnowledgeGraph>(path`/v1/knowledge_graphs/${kgId}`, request);
  }

  /**
   * Suggest an extraction schema from sampled knowledge graph data
   */
  async suggestSchema(
    kgId: string,
    request: SuggestKnowledgeGraphSchemaRequest = {}
  ): Promise<SuggestKnowledgeGraphSchemaResponse> {
    return this.client.post<SuggestKnowledgeGraphSchemaResponse>(
      path`/v1/knowledge_graphs/${kgId}/schema/suggest`,
      request
    );
  }

  /**
   * Delete a knowledge graph
   */
  async delete(kgId: string): Promise<{ id: string; deleted: boolean }> {
    return this.client.delete<{ id: string; deleted: boolean }>(path`/v1/knowledge_graphs/${kgId}`);
  }

  /**
   * Get infrastructure provisioning status for a knowledge graph
   */
  async getStatus(kgId: string): Promise<KgInfrastructureStatus> {
    return this.client.get<KgInfrastructureStatus>(path`/v1/knowledge_graphs/${kgId}/status`);
  }

  // ── File management ───────────────────────────────────────────────────

  /**
   * Add a file to a knowledge graph (triggers extraction)
   */
  async addFile(kgId: string, request: { file_id: string }): Promise<KgFileAssociation> {
    return this.client.post<KgFileAssociation>(path`/v1/knowledge_graphs/${kgId}/files`, request);
  }

  /**
   * List files in a knowledge graph
   */
  async listFiles(kgId: string, params?: {
    limit?: number;
    offset?: number;
  }): Promise<{ object: 'list'; data: KgFileAssociation[]; total: number; limit: number; offset: number }> {
    return this.client.get<{ object: 'list'; data: KgFileAssociation[]; total: number; limit: number; offset: number }>(path`/v1/knowledge_graphs/${kgId}/files`, params);
  }

  /**
   * Get a file's extraction status and optionally its materialized extraction results
   */
  async getFile(kgId: string, fileId: string, params?: {
    include_materialized?: boolean;
  }): Promise<KgFileAssociation> {
    return this.client.get<KgFileAssociation>(path`/v1/knowledge_graphs/${kgId}/files/${fileId}`, params);
  }

  /**
   * Remove a file from a knowledge graph
   */
  async removeFile(kgId: string, fileId: string): Promise<{ deleted: boolean }> {
    return this.client.delete<{ deleted: boolean }>(path`/v1/knowledge_graphs/${kgId}/files/${fileId}`);
  }

  // ── Entity & relationship browsing ────────────────────────────────────

  /**
   * List entities in a knowledge graph
   */
  async listEntities(kgId: string, params?: {
    entity_type?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: KgEntity[]; total: number; limit: number; offset: number }> {
    return this.client.get<{ data: KgEntity[]; total: number; limit: number; offset: number }>(
      path`/v1/knowledge_graphs/${kgId}/entities`, params
    );
  }

  /**
   * Get an entity by ID
   */
  async getEntity(kgId: string, entityId: string): Promise<KgEntity> {
    return this.client.get<KgEntity>(path`/v1/knowledge_graphs/${kgId}/entities/${entityId}`);
  }

  /**
   * Delete an entity
   */
  async deleteEntity(kgId: string, entityId: string): Promise<{ deleted: boolean }> {
    return this.client.delete<{ deleted: boolean }>(path`/v1/knowledge_graphs/${kgId}/entities/${entityId}`);
  }

  /**
   * List relationships in a knowledge graph
   */
  async listRelationships(kgId: string, params?: {
    entity_id?: string;
    relationship_type?: string;
    source_file_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: KgRelationship[]; total: number; limit: number; offset: number }> {
    return this.client.get<{ data: KgRelationship[]; total: number; limit: number; offset: number }>(
      path`/v1/knowledge_graphs/${kgId}/relationships`, params
    );
  }

  // ── Search & query ────────────────────────────────────────────────────

  /**
   * Semantic search for entities
   */
  async search(kgId: string, request: KgSearchRequest): Promise<KgSearchResponse> {
    return this.client.post<KgSearchResponse>(path`/v1/knowledge_graphs/${kgId}/search`, request);
  }

  /**
   * Graph-aware query (decompose → traverse → context)
   */
  async query(kgId: string, request: KgQueryRequest): Promise<KgQueryResponse> {
    return this.client.post<KgQueryResponse>(path`/v1/knowledge_graphs/${kgId}/query`, request);
  }
}
