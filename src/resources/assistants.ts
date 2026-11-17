import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import {
  Assistant,
  AssistantConfig,
  AssistantDeleted,
  AssistantList,
  CreateAssistantRequest,
  UpdateAssistantRequest
} from '../types/index.js';

const ASSISTANT_CONFIG_KEYS = [
  'model',
  'embedding_settings',
  'instructions',
  'tools',
  'tool_resources',
  'metadata',
  'temperature',
  'top_p',
  'response_format',
] as const;

type AssistantConfigKey = typeof ASSISTANT_CONFIG_KEYS[number];

const hasOwn = (obj: Record<string, any>, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

const extractConfig = (request: Record<string, any>): Partial<AssistantConfig> | undefined => {
  const config: Partial<AssistantConfig> = {};
  let hasAny = false;

  for (const key of ASSISTANT_CONFIG_KEYS) {
    if (hasOwn(request, key) && request[key] !== undefined) {
      (config as Record<AssistantConfigKey, any>)[key] = request[key];
      hasAny = true;
    }
  }

  return hasAny ? config : undefined;
};

const normalizeCreateRequest = (request: CreateAssistantRequest) => {
  const raw = request as Record<string, any>;
  const name = raw.name;
  const description = raw.description;
  const status = raw.status;
  const resourceType = raw.resource_type || 'assistant';

  const explicitConfig = raw.config;
  const flatConfig = extractConfig(raw);
  const config = explicitConfig ? { ...explicitConfig, ...(flatConfig || {}) } : (flatConfig || {});

  const body: Record<string, any> = {
    name,
    description,
    resource_type: resourceType,
    config,
    status
  };

  if (raw.project_id) {
    body.project_id = raw.project_id;
  }

  return body;
};

const normalizeUpdateRequest = (request: UpdateAssistantRequest) => {
  const raw = request as Record<string, any>;
  const name = raw.name;
  const description = raw.description;
  const status = raw.status;
  const resourceType = raw.resource_type;

  const explicitConfig = raw.config;
  const flatConfig = extractConfig(raw);
  const config = explicitConfig ? { ...explicitConfig, ...(flatConfig || {}) } : flatConfig;

  const body: Record<string, any> = {};
  if (name !== undefined) body.name = name;
  if (description !== undefined) body.description = description;
  if (status !== undefined) body.status = status;
  if (resourceType !== undefined) body.resource_type = resourceType;
  if (config !== undefined) body.config = config;

  return body;
};

/** @deprecated Legacy OpenAI Assistants API compatibility. Use agents. */
export class AssistantsResource {
  constructor(private client: HTTPClient) {}

  /**
   * Create a new assistant
   */
  async create(request: CreateAssistantRequest): Promise<Assistant> {
    const body = normalizeCreateRequest(request);
    const response = await this.client.post<any>('/v1/assistants', body);

    // OpenAI-compatible format: { object: 'assistant', id: '...' }
    if (response && response.object === 'assistant' && response.id) {
      return response as Assistant;
    }

    // Ragwalla format: { success: true, data: { id: '...', ... } }
    if (response?.success && response?.data?.id) {
      return response.data as Assistant;
    }

    // Fallback: extract ID from wherever it lives
    const assistantId = response?.id ?? response?.data?.id;
    if (!assistantId) {
      throw new Error('Assistant creation succeeded but no assistant id was returned.');
    }

    return this.retrieve(assistantId);
  }

  /**
   * Retrieve an assistant by ID
   */
  async retrieve(assistantId: string): Promise<Assistant> {
    return this.client.get<Assistant>(path`/v1/assistants/${assistantId}`);
  }

  /**
   * List assistants
   */
  async list(params?: {
    limit?: number;
    order?: 'asc' | 'desc';
    after?: string;
    before?: string;
  }): Promise<AssistantList> {
    return this.client.get<AssistantList>('/v1/assistants', params);
  }

  /**
   * Update an assistant
   */
  async update(assistantId: string, request: UpdateAssistantRequest): Promise<Assistant> {
    const body = normalizeUpdateRequest(request);
    const response = await this.client.post<any>(path`/v1/assistants/${assistantId}`, body);

    // OpenAI-compatible format
    if (response && response.object === 'assistant' && response.id) {
      return response as Assistant;
    }

    // Ragwalla format: { success: true, data: { ... } }
    if (response?.success && response?.data) {
      return response.data as Assistant;
    }

    return this.retrieve(assistantId);
  }

  /**
   * Delete an assistant
   */
  async delete(assistantId: string): Promise<AssistantDeleted> {
    return this.client.delete<AssistantDeleted>(path`/v1/assistants/${assistantId}`);
  }
}
