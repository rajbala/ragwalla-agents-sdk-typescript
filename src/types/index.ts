export type TruncationStrategy =
  | { type: 'last_messages'; last_messages: number }
  | { type: 'first_messages'; first_messages: number }
  | { type: 'first_and_last'; first_messages: number; last_messages: number }
  | { type: 'token_budget'; budget_chars: number }
  | { type: 'previous_tool_execution'; last_cycles: number };

export interface RagwallaConfig {
  apiKey: string;
  /**
   * An https://.../v1 URL. Defaults to https://api.ragwalla.com/v1, which reaches the endpoint
   * the key names. A key created before keys named their endpoint works only on its endpoint's
   * own URL, so pass that, or create a new key.
   */
  baseURL?: string;
  /**
   * The endpoint a platform key (pk-...) calls, sent as the X-Worker-ID header. A platform key
   * can reach several endpoints; any other key names its own.
   */
  endpointId?: string;
  projectId?: string; // Sent as X-Project-ID header — required for org-level keys that create project-scoped resources
  timeout?: number;
  debug?: boolean; // Enable debug logging
}

export interface SubagentLifecycleConfig {
  autoTeardown?: 'manual' | 'after_delegation' | 'ttl';
  ttlSeconds?: number;
  maxActiveChildren?: number;
  spawnTimeoutSeconds?: number;
}

export interface AgentChild {
  id: string;
  parent_agent_id: string;
  child_agent_id: string;
  ephemeral: boolean;
  status: 'active' | 'torn_down';
  created_at: number;
  torn_down_at: number | null;
  last_activity_at: number | null;
  child_name?: string;
  label?: string;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  model?: string;
  instructions?: string;
  tools?: Tool[];
  systemToolsProvisioned?: boolean;
  systemToolIds?: string[];
  metadata?: Record<string, any>;
  temperature?: number;
  topP?: number;
  isEnabled?: boolean;
  agentType?: 'orchestrator' | 'primary' | 'subagent';
  modelConfig?: {
    model: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
  };
  memoryExtractionEnabled?: boolean | null;
  memoryEmbeddingModel?: string | null;
  memoryUserScopingEnabled?: boolean | null;
  agentMetadata?: {
    agentId: string;
    agentType: string;
    canDelegate: boolean;
    canBeDelegatedTo: boolean;
    maxDelegationDepth: number;
    maxConcurrentDelegations?: number;
    delegationTimeoutSeconds?: number;
    memoryExtractionEnabled?: boolean | null;
    memoryEmbeddingModel?: string | null;
    memoryUserScopingEnabled?: boolean | null;
    createdAt: number;
    updatedAt: number;
  };
  subagentLifecycle?: SubagentLifecycleConfig;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  model?: string;
  instructions?: string;
  tools?: string[];
  /**
   * System skill IDs to provision with the agent. Omit to use platform defaults
   * for orchestrators. Pass an explicit empty array to provision no DB-backed
   * system tools.
   */
  systemSkillIds?: string[];
  /** @deprecated Use systemSkillIds instead. */
  systemToolIds?: string[];
  metadata?: Record<string, any>;
  project_id?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  agentType?: 'orchestrator' | 'primary' | 'subagent';
  executionMode?: 'assistant' | 'execution-only';
  /** Server default: true. */
  canDelegate?: boolean;
  /** Server default: true. */
  canBeDelegatedTo?: boolean;
  /** 0-10. Server default: 1. */
  maxDelegationDepth?: number;
  subagentLifecycle?: SubagentLifecycleConfig;
  memoryExtractionEnabled?: boolean;
  memoryEmbeddingModel?: string;
  memoryUserScopingEnabled?: boolean;
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  instructions?: string;
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  isEnabled?: boolean;
  tools?: AgentTool[];
  /**
   * System skill IDs to provision on the agent. Omit to preserve the current
   * provisioned system skill set.
   */
  systemSkillIds?: string[];
  /** @deprecated Use systemSkillIds instead. */
  systemToolIds?: string[];
  metadata?: Record<string, any>;
  agentType?: 'orchestrator' | 'primary' | 'subagent';
  executionMode?: 'assistant' | 'execution-only';
  canDelegate?: boolean;
  canBeDelegatedTo?: boolean;
  maxDelegationDepth?: number;
  subagentLifecycle?: SubagentLifecycleConfig;
  memoryExtractionEnabled?: boolean;
  memoryEmbeddingModel?: string;
  memoryUserScopingEnabled?: boolean;
}

export type AgentTool = Tool;

// Model types

export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt: string;
    completion: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
  };
}

export interface ModelsListResponse {
  object: 'list';
  data: ModelInfo[];
  curated: string[];
  model_ids: string[];
  providers: string[];
  total_count: number;
}

export type ToolType = 'function' | 'assistant' | 'api' | 'knowledge_base' | 'knowledge_graph' | 'mcp' | 'system';

export interface BaseTool {
  id: string;
  type: ToolType;
  name: string;
  title?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface FunctionTool extends BaseTool {
  type: 'function';
  code: string;
  parameters?: Record<string, any>;
  timeout?: number;
  memoryLimit?: number;
}

export interface AssistantTool extends BaseTool {
  type: 'assistant';
  assistantId: string;
  specialties?: string[];
  whenToUse?: string;
  defaultParameters?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };
}

export interface ApiTool extends BaseTool {
  type: 'api';
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  parameters?: Record<string, any>;
  authentication?: {
    type: 'bearer' | 'api-key' | 'basic';
    credentials: string;
  };
}

export interface KnowledgeBaseTool extends BaseTool {
  type: 'knowledge_base';
  vectorStoreId: string;
  searchParameters?: {
    topK?: number;
    scoreThreshold?: number;
  };
}

export interface KnowledgeGraphToolDef extends BaseTool {
  type: 'knowledge_graph';
  knowledgeBaseId: string;
  searchParameters?: {
    maxHops?: number;
  };
}

export interface MCPTool extends BaseTool {
  type: 'mcp';
  serverId: string;
  serverName?: string;
  serverUrl?: string;
  toolName: string;
  protocolVersion?: string;
  transportType?: 'stdio' | 'http' | 'websocket';
  parameters?: Record<string, any>;
}

/**
 * Who may make an agent run a built-in, fixed by the server:
 * - `conversation`: every turn;
 * - `memory`: turns rooted in the owner, and the senders of a channel with memory of its own;
 * - `shareable`: turns rooted in the owner, and the senders of the channels its grant is open to;
 * - `owner_only`: turns rooted in the owner at `owner_presence_floor` or above, never an outside sender.
 */
export type SystemToolAccessClass = 'conversation' | 'memory' | 'shareable' | 'owner_only';

export interface SystemTool extends BaseTool {
  type: 'system';
  category?: string;
  parameters?: Record<string, any>;
  /** Reported by listSystemSkills(). */
  access_class?: SystemToolAccessClass;
  /** How present the owner must be for this built-in to run, reported by listSystemSkills(). */
  owner_presence_floor?: OwnerPresence;
}

export type Tool = FunctionTool | AssistantTool | ApiTool | KnowledgeBaseTool | KnowledgeGraphToolDef | MCPTool | SystemTool;

/**
 * How present the agent's owner must be for a turn rooted in them to run a tool, in
 * increasing order: `delegated` (owner-rooted work with no person in the loop, such as a
 * spawned child), `unattended` (a task an attended turn scheduled), `attended` (the owner is
 * waiting on the turn).
 */
export type OwnerPresence = 'delegated' | 'unattended' | 'attended';

/** A channel whose outside senders a grant also admits. */
export interface ToolAccessAudience {
  type: 'channel';
  channel_id: string;
}

/** Who may make the agent use a granted tool. Every grant starts `delegated` with no audiences. */
export interface ToolAccess {
  owner_presence: OwnerPresence;
  audiences: ToolAccessAudience[];
}

/**
 * What of a grant's access the owner may decide. A grant that reaches a built-in (`runs_as`)
 * also takes the built-in's rule, so the server may fix its owner presence, its audiences or both.
 */
export interface ToolAccessControls {
  /** Whether `owner_presence` may be changed. */
  owner_presence: boolean;
  /** Whether channels may be added to `audiences`. */
  audiences: boolean;
  /** The built-ins this grant reaches. */
  runs_as: string[];
}

export interface ToolGrantAccess {
  /** The grant's id, which updateSkillAccess() takes. */
  grant_id: string;
  access: ToolAccess;
  access_controls: ToolAccessControls;
}

/** A tool as listSkills() returns it: the tool plus its grant's access. */
export type AgentToolGrant = Tool & ToolGrantAccess & { object: 'agent_skill' };

export interface ToolAccessResponse extends ToolGrantAccess {
  object: 'agent_skill_access';
}

/** What attachSkillWithAccess() returns: the new grant and the access it was granted with. */
export interface AttachSkillWithAccessResponse {
  object: 'agent_skill';
  /** The grant's id, the same as `grant_id`. */
  id: string;
  grant_id: string;
  agentId: string;
  tool: Tool;
  access: ToolAccess;
  grantedBy: string;
  grantedAt: number;
}

export interface BulkAttachCreatedItem {
  index: number;
  skill: Tool;
  /** The access the skill was granted with, when its item asked for one. */
  access?: ToolAccess;
}

export interface BulkAttachSkippedItem {
  index: number;
  name?: string;
  toolName?: string;
  reason: 'already_attached';
  existingSkillId?: string;
}

export interface BulkAttachFailedItem {
  index: number;
  name?: string;
  toolName?: string;
  error: string;
  /**
   * The API error code, for an item refused as its own attach would be:
   * `unknown_channel`, `tool_access_fixed`, `tool_changed`, `skill_already_attached`
   * or `mcp_server_not_found`.
   */
  code?: string;
}

export interface BulkAttachSkillsResponse {
  object: 'bulk_attach_result';
  agentId: string;
  created: BulkAttachCreatedItem[];
  skipped: BulkAttachSkippedItem[];
  failed: BulkAttachFailedItem[];
  total: number;
}

/** An agent skill = system-provided or user-created capability (excludes MCP tools) */
export type AgentSkill = FunctionTool | SystemTool;

/** Alias for SystemTool */
export type SystemSkill = SystemTool;

/** @deprecated Use Tool instead */
export interface ToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
}

// Assistant types (OpenAI Assistants-style resources)

export type AssistantResponseFormat = {
  type: 'text' | 'json_object';
};

export type AssistantChunkingStrategy =
  | { type: 'auto' }
  | {
      type: 'static';
      static: {
        max_chunk_size_tokens: number;
        chunk_overlap_tokens: number;
      };
    };

export interface AssistantFunctionObject {
  name: string;
  description?: string;
  parameters: Record<string, any>;
  strict?: boolean;
}

export interface AssistantCodeInterpreterTool {
  type: 'code_interpreter';
}

export interface AssistantFileSearchTool {
  type: 'file_search';
  file_search?: {
    max_num_results?: number;
    ranking_options?: {
      ranker: 'auto' | 'default_2024_08_21';
      score_threshold: number;
    };
  };
}

export interface AssistantFunctionTool {
  type: 'function';
  function: AssistantFunctionObject;
}

export type AssistantToolDefinition =
  | AssistantCodeInterpreterTool
  | AssistantFileSearchTool
  | AssistantFunctionTool;

export interface AssistantToolResources {
  code_interpreter?: {
    file_ids: string[];
  };
  file_search?: {
    vector_store_ids?: string[];
    vector_stores?: Array<{
      file_ids: string[];
      chunking_strategy?: AssistantChunkingStrategy;
      metadata?: Record<string, string>;
    }>;
  };
}

export interface AssistantEmbeddingSettings {
  model: string;
  dimensions?: number;
  options?: Record<string, any>;
}

export interface AssistantConfig {
  model: string;
  embedding_settings?: AssistantEmbeddingSettings;
  instructions?: string | null;
  tools?: AssistantToolDefinition[];
  tool_resources?: AssistantToolResources | null;
  metadata?: Record<string, string> | null;
  temperature?: number | null;
  top_p?: number | null;
  response_format?: AssistantResponseFormat | null;
}

export interface Assistant {
  id: string;
  object: 'assistant';
  created_at: number;
  updated_at?: number;
  name: string;
  description: string | null;
  model: string;
  embedding_settings?: AssistantEmbeddingSettings;
  instructions: string | null;
  tools: AssistantToolDefinition[];
  tool_resources: AssistantToolResources | null;
  metadata: Record<string, string> | null;
  temperature: number;
  top_p: number;
  response_format: AssistantResponseFormat | null;
  project_id?: string;
}

export interface AssistantList {
  object: 'list';
  data: Assistant[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

export interface AssistantDeleted {
  id: string;
  object: 'assistant.deleted';
  deleted: boolean;
}

export type CreateAssistantParams = AssistantConfig & {
  name?: string;
  description?: string;
  status?: string;
  project_id?: string;
};

export interface AssistantResourceCreateRequest {
  name?: string;
  description?: string;
  resource_type: 'assistant';
  config: AssistantConfig;
  status?: string;
  project_id?: string;
}

export type CreateAssistantRequest = CreateAssistantParams | AssistantResourceCreateRequest;

export type UpdateAssistantParams = Partial<AssistantConfig> & {
  name?: string;
  description?: string | null;
  status?: string;
};

export interface AssistantResourceUpdateRequest {
  name?: string;
  description?: string | null;
  resource_type?: 'assistant';
  config?: Partial<AssistantConfig>;
  status?: string;
}

export type UpdateAssistantRequest = UpdateAssistantParams | AssistantResourceUpdateRequest;

// MCP Server types

export type MCPTransportType = 'stdio' | 'http' | 'websocket';
export type MCPAuthType = 'none' | 'bearer' | 'api_key' | 'oauth2';

export interface MCPOAuthConfig {
  flow?: 'authorization_code' | 'client_credentials' | 'mcp_native';
  authUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scopes?: string[];
  audience?: string;
  resource?: string;
  redirectUri?: string;
  extraAuthParams?: Record<string, string>;
  extraTokenParams?: Record<string, string>;
  provider?: string;
  supportsNative?: boolean;
}

export interface MCPServer {
  id: string;
  name: string;
  description?: string;
  url?: string;
  command?: string;
  transport_type: MCPTransportType;
  protocol_version: string;
  auth_type: MCPAuthType;
  status: string;
  auth_status?: 'pending' | 'connected' | 'error';
  supports_sse?: boolean;
  capabilities?: Record<string, any>;
  created_at: number;
  updated_at: number;
}

export interface CreateMCPServerRequest {
  name: string;
  description?: string;
  url?: string;
  command?: string;
  transport_type: MCPTransportType;
  protocol_version?: string;
  auth_type?: MCPAuthType;
  auth_config?: Record<string, any>;
  supports_sse?: boolean;
  /** Required for org-level API keys. Project-scoped keys resolve this automatically. */
  project_id?: string;
}

export interface UpdateMCPServerRequest {
  name?: string;
  description?: string;
  url?: string;
  command?: string;
  transport_type?: MCPTransportType;
  protocol_version?: string;
  auth_type?: MCPAuthType;
  auth_config?: Record<string, any>;
  supports_sse?: boolean;
  /** Optional: required when using org-level API keys. */
  project_id?: string;
}

export interface TestMCPServerRequest {
  name: string;
  url?: string;
  transport_type: MCPTransportType;
  protocol_version?: string;
  auth_type?: MCPAuthType;
  auth_config?: Record<string, any>;
  supports_sse?: boolean;
  /** Optional: required when using org-level API keys. */
  project_id?: string;
}

export interface MCPDiscoveredTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface MCPDiscoverResponse {
  tools: MCPDiscoveredTool[];
  server_info?: {
    name?: string;
    version?: string;
    protocolVersion?: string;
    capabilities?: Record<string, any>;
  };
}

export interface MCPTestResponse {
  success: boolean;
  message: string;
  tools?: Array<{ name: string; title?: string; description?: string }>;
  serverInfo?: {
    name?: string;
    version?: string;
    protocolVersion?: string;
  };
  validation?: {
    valid: boolean;
    errors: Array<{ toolName: string; field: string; message: string }>;
  };
}

export interface MCPAgentAccess {
  id: string;
  agent_id: string;
  mcp_server_id: string;
  enabled: boolean;
  agent_name?: string;
  agent_description?: string;
  granted_by: string;
  granted_at: number;
}

export interface MCPOAuthStartResponse {
  auth_url: string;
  state: string;
  expires_at: number;
}

export interface MCPOAuthStatusResponse {
  auth_status: 'pending' | 'connected' | 'error';
  access_token_expires_at?: number | null;
}

export interface MCPOAuthRefreshResponse {
  success: boolean;
  access_token_expires_at?: number | null;
}

export interface GrantAgentAccessRequest {
  agent_id: string;
  enabled?: boolean;
  /** Optional: required when using org-level API keys. */
  project_id?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, any>;
  timestamp?: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  metadata?: Record<string, any>;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Response of `POST /v1/agents/auth/websocket`, exactly as the worker sends it.
 * This previously declared `expires_at: string`, a field the server has never
 * returned — so it always read as `undefined`.
 */
export interface ConnectionToken {
  token: string;
  /** Lifetime in seconds. */
  expiresIn: number;
  /** Unix SECONDS, not milliseconds. */
  expiresAt: number;
  tokenType: 'Bearer';
  scope: string;
}

export interface VectorSearchComparisonFilter {
  $eq?: unknown;
  $ne?: unknown;
  $gt?: unknown;
  $gte?: unknown;
  $lt?: unknown;
  $lte?: unknown;
  $in?: unknown[];
  $nin?: unknown[];
}

export interface VectorSearchCompoundFilter {
  $and?: VectorSearchFilter[];
  $or?: VectorSearchFilter[];
  $not?: VectorSearchFilter;
}

export type VectorSearchFilter =
  | VectorSearchComparisonFilter
  | VectorSearchCompoundFilter
  | Record<string, unknown>;

export interface VectorSearchRankingOptions {
  ranker?: 'bm25' | 'cosine' | 'hybrid';
  score_threshold?: number;
  boost_factor?: number;
}

export interface VectorSearchRequest {
  query: string | string[];
  rewrite_query?: boolean;
  max_num_results?: number;
  filters?: VectorSearchFilter;
  ranking_options?: VectorSearchRankingOptions;
}

export interface VectorSearchOptions {
  page_token?: string;
}

export interface VectorSearchResultContent {
  type: 'text';
  text: string;
}

export interface VectorSearchResult {
  file_id: string;
  filename: string;
  score: number;
  attributes: Record<string, unknown>;
  content: VectorSearchResultContent[];
}

export interface VectorSearchResponse {
  object: 'vector_store.search_results.page';
  search_query: string[];
  data: VectorSearchResult[];
  has_more: boolean;
  next_page: string | null;
}

// File types

export type FilePurpose = 'assistants' | 'batch' | 'fine-tune' | 'vision' | 'user_data' | 'evals';

export interface FileObject {
  id: string;
  object: 'file';
  bytes: number;
  created_at: number;
  filename: string;
  purpose: FilePurpose;
  metadata?: Record<string, string | number | boolean>;
}

export interface FileListResponse {
  object: 'list';
  data: FileObject[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

export interface FileDeleted {
  id: string;
  object: 'file';
  deleted: boolean;
}

export interface UploadFileRequest {
  file: Blob | File;
  purpose: FilePurpose;
  metadata?: Record<string, string | number | boolean>;
}

// Vector Store File types

export interface VectorStoreFileChunkingStrategy {
  type: 'auto' | 'static';
  static?: {
    max_chunk_size_tokens: number;
    chunk_overlap_tokens: number;
  };
}

export interface VectorStoreFile {
  id: string;
  object: 'vector_store.file';
  usage_bytes: number;
  created_at: number;
  vector_store_id: string;
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
  last_error: { code: string; message: string } | null;
  chunking_strategy?: VectorStoreFileChunkingStrategy;
}

export interface CreateVectorStoreFileRequest {
  file_id: string;
  chunking_strategy?: VectorStoreFileChunkingStrategy;
}

export interface VectorStoreFileDeleted {
  id: string;
  object: 'vector_store.deleted';
  deleted: boolean;
}

export interface VectorStoreFileListResponse {
  object: 'list';
  data: VectorStoreFile[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

export interface VectorStoreVector {
  object: 'vector';
  id: string;
  values?: number[];
  metadata?: Record<string, any>;
  created_at?: number;
}

export interface VectorStoreFileVectorsResponse {
  object: 'list';
  data: VectorStoreVector[];
  has_more: boolean;
  next_cursor?: string;
}

export interface QuotaEvent {
  action: string;
  metadata?: Record<string, any>;
  timestamp?: string;
}

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  reset_date?: string;
}

/**
 * Canonical run status union — kept verbatim with the worker
 * (ragwalla-hono-worker `src/lib/interfaces/runs.ts`). The nine statuses partition
 * into the terminal set below and the active set (queued, in_progress,
 * requires_action, cancelling). Keep all of these in sync with the worker.
 */
export type RunStatus =
  | 'queued' | 'in_progress' | 'requires_action' | 'cancelling'
  | 'cancelled' | 'failed' | 'completed' | 'incomplete' | 'expired';

/** Statuses after which a run emits no further events. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'cancelled', 'failed', 'completed', 'incomplete', 'expired',
]);

/**
 * True when a run status is terminal. Accepts the raw value off the wire (the
 * `run_state` frame's `runStatus` is a plain string at the boundary); membership in
 * the canonical set is authoritative.
 */
export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return status != null && TERMINAL_RUN_STATUSES.has(status as RunStatus);
}

export type KnownWebSocketMessageType =
  'message' | 'chat_message' | 'chunk' | 'complete' | 'message_created' |
  'thread_info' | 'thread_history' | 'typing' | 'tool_use' | 'token_usage' | 'error' |
  'connection_status' | 'connected' | 'cf_agent_state' |
  'run_paused' | 'run_cancelled' | 'continuation_mode_updated' | 'continue_run_result' |
  'status' | 'tool_executing' | 'tool_complete' | 'resume' | 'run_state' | 'run_started' | 'request_ack' | 'pong' |
  'message_received' | 'thread_event';

export type WebSocketMessageType = KnownWebSocketMessageType | (string & {});

export interface WebSocketMessage {
  type: WebSocketMessageType;
  /** Client-supplied correlation ID echoed on direct native replies and errors. */
  requestId?: string;
  /** Original command type on a request_ack frame. */
  requestType?: string;
  data?: any; // Optional - some message types don't use data wrapper
  content?: string; // For message types - content at top level
  role?: string; // For message types
  timestamp?: string;
  // Additional fields the server may include
  threadId?: string;
  runId?: string;
  /** The user message that initiated this run (run_started/run_state). */
  userMessageId?: string;
  assistantId?: string;
  agentId?: string;
  projectId?: string;
  userId?: string;
  createNewThread?: boolean;
  messageId?: string;
  /** The event on a `thread_event` frame; see ThreadEventFrame. */
  event?: ThreadEventFrame['event'];
  isTyping?: boolean; // For typing messages
  tools?: string[]; // For tool_use messages
  isNewThread?: boolean; // For thread_info messages
  assistantName?: string; // For thread_info messages
  status?: string; // For status messages - e.g., 'tool_executing', 'tool_complete', 'tool_progress', 'generating'
  message?: string; // For status messages - human-readable description
  toolName?: string; // For status messages - the tool function name (stable identifier)
  toolTitle?: string; // For status messages - human-readable display title for the tool
  toolCallId?: string; // For status messages - unique ID for this tool invocation
  toolType?: 'system' | 'mcp' | 'user' | 'unknown'; // For status messages - tool classification
  serverName?: string; // For MCP tool status messages - the MCP server name
  progress?: number; // For tool_progress status - current progress value (from MCP notifications/progress)
  total?: number; // For tool_progress status - total expected value (from MCP notifications/progress)
  // Reconnect/resume fields
  currentThreadId?: string; // Sent in 'connected' message - thread currently active on this connection
  activeRunId?: string; // Sent in 'connected' message - run in progress at reconnect time
  activeRunStatus?: RunStatus; // Sent in 'connected' message; reconnect can report any status (incl. terminal)
  runStatus?: RunStatus; // Sent in 'run_state' - current status of the run on this connection
  activeTool?: { toolName: string; toolTitle?: string; progress?: number } | null; // 'run_state' - best-effort; null in v1
  // Error frames. The worker sends these at the TOP LEVEL, never under `data`: `error` is a
  // string on every path but the generic onMessage catch, which sends { message, code }.
  error?: string | { message: string; code?: string };
  code?: string; // Auth/lifecycle and protocol refusals (e.g. UNKNOWN_TYPE, INVALID_REQUEST_ID).
  // complete frames
  failed?: boolean;
  cancelled?: boolean;
  reason?: string;
  usage?: RunUsageTotals;
  // token_usage frames
  model?: string;
  call?: LlmCallUsage;
  totals?: RunUsageTotals;
  // thread_history payload
  messages?: ThreadHistoryMessage[];
  messageCount?: number;
  /**
   * Three distinct states: the key is ABSENT on servers predating the field (run state unknown),
   * `null` when the server looked and the thread has no runs, or the newest run. Do not collapse
   * absent into null — a staleness watchdog must not read an old server's silence as "no runs".
   */
  latestRun?: ThreadLatestRun | null;
}

/**
 * The thread's newest run, stamped onto `thread_history` so a client can distinguish a run that
 * is still working (keep waiting) from one that died (surface the error) — history alone cannot
 * tell you, because it deliberately excludes the in-flight assistant message.
 */
export interface ThreadLatestRun {
  id: string;
  /** Immutable initiating prompt; absent for runs without native chat provenance. */
  userMessageId?: string;
  status: RunStatus;
  /** Structured `{ code, message }` when the run stored JSON, otherwise the raw string. */
  lastError: unknown;
}

/**
 * One durable message in a `thread_history` frame. Pending user inputs are included;
 * the in-flight assistant message is deliberately excluded and arrives via `resume` instead.
 */
export interface ThreadHistoryMessage {
  id: string;
  /** Processing run ownership. Pending input ownership can be released after failure. */
  runId?: string | null;
  role: string;
  /** Flattened plain text; multi-part content is joined, images are replaced by a placeholder. */
  content: string;
  /**
   * Unix SECONDS — NOT milliseconds, and not the same encoding as `thread_info.createdAt`,
   * which is an ISO-8601 string derived from this very column. Multiply by 1000 for a Date.
   */
  createdAt: number;
  status?: string;
  completedAt?: number;
  metadata?: Record<string, unknown>;
  /** Remote URLs only — base64 `data:` images are stripped server-side to stay under the frame size limit. */
  images?: Array<{ url: string; detail?: string }>;
  toolCalls?: unknown[];
  /**
   * Server-authored row kind: null for a turn's answer; 'plan', 'subagent_report',
   * 'email_sent', or 'thread_event' otherwise.
   */
  rowKind?: string | null;
  /**
   * Present on a thread event row (rowKind 'thread_event'), which history carries only
   * when the socket connected with `includeEvents`. `id` is the `messageId` of the event's
   * live `threadEvent`, and `content` its summary.
   */
  event?: { type: string; visibility: 'client' | 'both'; data: unknown };
}

/** Who a thread event is for. Only `client` and `both` events reach connected clients. */
export type ThreadEventVisibility = 'client' | 'agent' | 'both';

/**
 * An event an integrator's backend recorded on a thread with `threads.events.create`
 * (`POST /v1/threads/:threadId/events`): something that happened outside the
 * conversation, such as a deploy finishing.
 */
export interface ThreadEvent {
  id: string;
  object: 'thread.event';
  thread_id: string;
  type: string;
  visibility: ThreadEventVisibility;
  summary: string | null;
  data: unknown;
  /** Unix seconds. */
  created_at: number;
}

interface CreateThreadEventBase {
  /** Integrator-defined, for example `deployment.completed`. 1–200 characters. */
  type: string;
  /** JSON for clients, at most 16 KiB serialized. Never shown to the agent. */
  data?: unknown;
  /** Makes the request safe to retry: a replay returns the recorded event and writes nothing. */
  idempotency_key?: string;
}

/**
 * Parameters for `threads.events.create`. An event the agent can see (`agent` or `both`)
 * requires a `summary`, which is the only part of it the agent reads; a client-only event
 * (the default) may omit it.
 */
export type CreateThreadEventParams =
  | (CreateThreadEventBase & { visibility?: 'client'; summary?: string })
  | (CreateThreadEventBase & { visibility: 'agent' | 'both'; summary: string });

/**
 * A client-visible thread event, delivered live to the sockets open on its thread
 * (`threadEvent`). `messageId` equals the event's history row id, so a client that
 * renders it live and later reloads history can recognise it; a replayed or held
 * event can arrive more than once.
 */
export interface ThreadEventFrame {
  threadId: string;
  messageId: string;
  event: {
    id: string;
    type: string;
    visibility: 'client' | 'both';
    summary: string | null;
    data: unknown;
    /** Unix seconds. */
    createdAt: number;
  };
}

/** One LLM call's token counts, as reported on a `token_usage` frame. */
export interface LlmCallUsage {
  /** Includes cached input tokens. */
  promptTokens: number;
  completionTokens: number;
  /** Input tokens served from the provider's prompt cache (a subset of promptTokens). */
  cachedTokens: number;
}

/** A run's cumulative token counts across every LLM call it has made so far. */
export interface RunUsageTotals {
  /** Includes cached input tokens. */
  inputTokens: number;
  outputTokens: number;
  /** A subset of inputTokens. */
  cachedInputTokens: number;
  llmCallCount: number;
  models: string[];
}

/** `token_usage`: emitted after each LLM call a run makes. Requires server support. */
export interface TokenUsageEvent {
  runId?: string;
  model?: string;
  call: LlmCallUsage;
  /** Cumulative for the run, so a consumer that misses a frame still converges on the next. */
  totals: RunUsageTotals;
  requestId?: string;
}

/**
 * `complete`: a run's terminal frame. Exactly one of the outcomes holds: `cancelled`,
 * `failed`, or neither (completed). Every field but `messageId` is forwarded only when
 * the server sent it, so an absent field means "not reported", never "false".
 */
export interface CompleteEvent {
  messageId?: string;
  runId?: string;
  failed?: boolean;
  cancelled?: boolean;
  /** e.g. `'expired'` on a failed run. */
  reason?: string;
  /** Structured `{ code, message }` on failed runs that recorded one. */
  error?: unknown;
  /** The run's final totals, when the terminal path had them. Requires server support. */
  usage?: RunUsageTotals;
  requestId?: string;
}

export type RunOutcome = 'completed' | 'failed' | 'cancelled';

/** Result of `RagwallaWebSocket.runToCompletion()`. */
export interface RunResult {
  runId: string;
  threadId?: string;
  userMessageId?: string;
  status: RunOutcome;
  /** The assistant text streamed for this run, message by message in order of appearance. */
  text: string;
  messageIds: string[];
  /** The failure the server reported, when `status` is `'failed'`. */
  error?: unknown;
  reason?: string;
  /**
   * The run's token totals. `source: 'terminal'` means the server stamped them on the terminal
   * frame and they are final. `source: 'stream'` means they come from the last `token_usage`
   * frame seen and may undercount if frames were missed (see `reconnected`). Absent when the
   * server reported no usage at all — treat that as unknown, never as zero.
   */
  usage?: RunUsageTotals & { source: 'terminal' | 'stream' };
  /** True when the socket dropped and reconnected while this run was in flight. */
  reconnected: boolean;
}

export interface RagwallaError {
  type: string;
  code?: string;
  message: string;
  param?: string;
}

// Channel types

export type ChannelType = 'slack' | 'discord' | 'telegram' | 'webhook' | 'whatsapp' | 'teams';
export type WebhookStatus = 'pending' | 'registered' | 'failed' | 'manual';

export interface Channel {
  id: string;
  agent_id: string;
  channel_type: ChannelType;
  config?: Record<string, unknown>;
  enabled: boolean;
  session_scope?: string;
  webhook_status?: WebhookStatus;
  webhook_error?: string;
  webhook_registered_at?: number;
  created_at: number;
  updated_at: number;
}

export interface CreateChannelRequest {
  channel_type: ChannelType;
  config: Record<string, unknown>;
  session_scope?: string;
  hook_token?: string;
}

export interface CreateChannelResponse {
  id: string;
  agent_id: string;
  channel_type: ChannelType;
  webhook_status: WebhookStatus;
  webhook_error?: string;
  setup_instructions?: string;
  created_at: number;
}

export interface ChannelStatus {
  id: string;
  agent_id: string;
  channel_type: ChannelType;
  enabled: boolean;
  webhook_status?: WebhookStatus;
  webhook_error?: string;
  webhook_registered_at?: number;
  live_status?: {
    pending_update_count?: number;
    last_error_message?: string;
    last_error_date?: number;
  };
}

export interface WebhookRetryResponse {
  success: boolean;
  webhook_status: WebhookStatus;
  webhook_error?: string;
}

// Organization types
export interface OrganizationSettings {
  payment?: string;
  credits?: number;
  [key: string]: any;
}

export interface CreateOrganizationRequest {
  name: string;
  settings?: OrganizationSettings;
}

export interface UpdateOrganizationRequest {
  name?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  settings?: OrganizationSettings;
  created_at: number;
  updated_at: number;
  projects?: Project[];
}

export interface OrganizationList {
  object: 'list';
  data: Organization[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

// Project types
export interface Project {
  id: string;
  object: string;
  name: string;
  description?: string;
  organization_id: string;
  created_at: number;
  updated_at: number;
  status: string;
  archived_at?: number | null;
}

export interface ProjectList {
  object: 'list';
  data: Project[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface UpdateProjectRequest {
  name: string;
  description?: string;
}

// Organization webhook types

export interface OrganizationWebhook {
  id: string;
  organizationId: string;
  name: string;
  endpointUrl: string;
  secretPrefix: string | null;
  enabled: boolean;
  eventSubscriptions: string[];
  retryMaxAttempts: number;
  retryBackoffMs: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string | null;
}

export interface CreateOrganizationWebhookRequest {
  name: string;
  endpoint_url: string;
  event_subscriptions: string[];
  secret?: string;
  auto_generate_secret?: boolean;
  retry_max_attempts?: number;
  retry_backoff_ms?: number;
}

export interface UpdateOrganizationWebhookRequest {
  name?: string;
  endpoint_url?: string;
  enabled?: boolean;
  event_subscriptions?: string[];
  secret?: string;
  auto_generate_secret?: boolean;
  retry_max_attempts?: number;
  retry_backoff_ms?: number;
}

export interface OrganizationWebhookCreateResponse extends OrganizationWebhook {
  secret?: string;
}

export interface OrganizationWebhookListResponse {
  webhooks: OrganizationWebhook[];
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  payload: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  maxAttempts: number;
  nextRetryAt: number | null;
  lastAttemptAt: number | null;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface OrganizationWebhookDeliveriesResponse {
  deliveries: WebhookDelivery[];
}

// Memory types

export type MemoryType = 'observation' | 'fact' | 'preference' | 'event' | 'summary' | 'tool_note';

export interface Memory {
  id: string;
  object: 'memory';
  agent_id: string;
  session_id: string | null;
  content: string;
  memory_type: MemoryType;
  importance: number;
  tags: string[];
  vector_id: string | null;
  created_at: number;
  accessed_at: number | null;
  access_count: number;
}

export interface MemorySearchResult extends Memory {
  score: number;
}

export interface CreateMemoryRequest {
  content: string;
  memory_type?: MemoryType;
  importance?: number;
  /** Target a specific memory store (requires agent to be attached to the store). */
  memory_store_id?: string;
  tags?: string[];
  session_id?: string;
  /** Target a specific user's memory graph (requires memory_user_scoping_enabled on the agent). */
  user_id?: string;
}

export interface BatchCreateMemoryRequest {
  memories: CreateMemoryRequest[];
  /** Target a specific user's memory graph (requires memory_user_scoping_enabled on the agent). */
  user_id?: string;
  /** Target a specific memory store (requires agent to be attached to the store). */
  memory_store_id?: string;
}

export interface SearchMemoriesRequest {
  query: string;
  top_k?: number;
  memory_type?: MemoryType;
  /** Target a specific memory store (requires agent to be attached to the store). */
  memory_store_id?: string;
  min_score?: number;
  /** Target a specific user's memory graph (requires memory_user_scoping_enabled on the agent). */
  user_id?: string;
}

export interface ListMemoriesParams {
  limit?: number;
  offset?: number;
  memory_type?: MemoryType;
  /** Target a specific memory store (requires agent to be attached to the store). */
  memory_store_id?: string;
  /** Target a specific user's memory graph (requires memory_user_scoping_enabled on the agent). */
  user_id?: string;
}

export interface RetrieveMemoryParams {
  /** Target a specific user's memory graph (requires memory_user_scoping_enabled on the agent). */
  user_id?: string;
  /** Target a specific memory store (requires agent to be attached to the store). */
  memory_store_id?: string;
}

export interface DeleteMemoryParams {
  /** Target a specific user's memory graph (requires memory_user_scoping_enabled on the agent). */
  user_id?: string;
  /** Target a specific memory store (requires agent to be attached to the store). */
  memory_store_id?: string;
}

export interface ListMemoriesResponse {
  object: 'list';
  data: Memory[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface SearchMemoriesResponse {
  object: 'list';
  data: MemorySearchResult[];
}

export interface BatchCreateMemoryResponse {
  object: 'list';
  data: Memory[];
  total: number;
}

// Memory Store types

export interface MemoryStore {
  id: string;
  object: 'memory_store';
  project_id: string;
  name: string;
  description: string | null;
  embedding_model: string | null;
  user_scoping_enabled: boolean | null;
  created_at: number;
  updated_at: number;
}

export interface CreateMemoryStoreRequest {
  name: string;
  description?: string;
  embedding_model?: string;
  user_scoping_enabled?: boolean;
}

export interface UpdateMemoryStoreRequest {
  name?: string;
  description?: string;
  user_scoping_enabled?: boolean;
}

export interface AttachMemoryStoreRequest {
  memory_store_id: string;
  role: 'read' | 'read_write';
  is_default?: boolean;
}

export interface MemoryStoreAttachment {
  agent_id: string;
  memory_store_id: string;
  store_name: string;
  role: 'read' | 'read_write';
  is_default: boolean;
  embedding_model: string | null;
  user_scoping_enabled: boolean | null;
}

export interface ListMemoryStoresResponse {
  object: 'list';
  data: MemoryStore[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ListMemoryStoreAttachmentsResponse {
  object: 'list';
  data: MemoryStoreAttachment[];
}

// Workspace File types

export type WorkspaceFileType = 'soul' | 'identity' | 'user' | 'tools' | 'bootstrap' | 'boot' | 'heartbeat' | 'custom';

export interface WorkspaceFile {
  id: string;
  agentId: string;
  fileType: WorkspaceFileType;
  fileName: string;
  content: string;
  enabled: boolean;
  priority: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWorkspaceFileRequest {
  file_type: WorkspaceFileType;
  content: string;
  file_name?: string;
}

export interface UpdateWorkspaceFileRequest {
  content?: string;
  file_name?: string;
  enabled?: boolean;
}

export interface WorkspacePreview {
  agentId: string;
  hasWorkspace: boolean;
  composedPrompt: string | null;
}

// --- Endpoint Provisioning (Platform Keys) ---

export interface Endpoint {
  id: string;
  object: 'endpoint';
  status: 'provisioning' | 'active' | 'error';
  baseURL: string;
  error?: string;
  createdAt: number;
}

export interface CreateEndpointRequest {
  name: string;
  customDomain?: string;
  /** Provision memory infrastructure (queues, KV, MemoryGraphDO) upfront. */
  enableMemory?: boolean;
}

export interface EndpointList {
  object: 'list';
  data: Endpoint[];
}

export interface EndpointDeleted {
  id: string;
  object: 'endpoint';
  deleted: boolean;
}

// --- Feature Flags ---

export interface ResolvedFlag {
  flag_name: string;
  enabled: boolean;
  source: 'endpoint' | 'organization' | 'project' | 'agent' | 'namespace' | 'default';
}

export interface ResolveFlagsRequest {
  flags: string[];
  organization_id: string;
  project_id?: string;
  agent_id?: string;
}

export interface ResolveFlagsResponse {
  data: ResolvedFlag[];
}

// --- Namespace Flags (Platform Key holders only) ---

export interface NamespaceFlag {
  flag_name: string;
  enabled: boolean;
  updated_at: number;
}

export interface SetNamespaceFlagRequest {
  flag_name: string;
  enabled: boolean;
}

export interface DeleteNamespaceFlagRequest {
  flag_name: string;
}

export interface NamespaceFlagList {
  data: NamespaceFlag[];
}

// --- Knowledge Graphs ---

export interface KnowledgeGraph {
  id: string;
  object: 'knowledge_graph';
  name: string;
  description?: string;
  project_id: string;
  embedding_model: string;
  extraction_model?: string;
  extraction_schema?: Record<string, unknown> | null;
  /** The document schema the extraction schema was compiled from, when the graph was given one. */
  document_schema?: Record<string, unknown> | null;
  extraction_prompt?: string | null;
  entity_count: number;
  relationship_count: number;
  file_count: number;
  status: string;
  created_at: number;
}

export interface CreateKnowledgeGraphRequest {
  name: string;
  description?: string;
  project_id?: string;
  embedding_settings: {
    model: string;
    dimensions?: number;
    metric?: 'cosine' | 'euclidean' | 'dot-product';
  };
  extraction_model?: string;
  extraction_schema?: Record<string, unknown>;
  /**
   * An object-style JSON Schema describing the documents. The server compiles it into the
   * extraction schema. Send this or `extraction_schema`, not both.
   */
  document_schema?: Record<string, unknown>;
  extraction_prompt?: string;
}

export interface UpdateKnowledgeGraphRequest {
  name?: string;
  description?: string;
  extraction_model?: string;
  extraction_schema?: Record<string, unknown> | null;
  /**
   * Replaces the document schema and recompiles the extraction schema from it; `null` removes
   * it. Send this or `extraction_schema`, not both.
   */
  document_schema?: Record<string, unknown> | null;
  extraction_prompt?: string | null;
}

export interface SuggestKnowledgeGraphSchemaRequest {
  file_ids?: string[];
  model?: string;
  max_files?: number;
  max_chunks_per_file?: number;
  max_chars_per_chunk?: number;
  allow_fallback_schema?: boolean;
  allow_partial_sampling?: boolean;
}

export interface SuggestKnowledgeGraphSchemaResponse {
  object: 'knowledge_graph.schema_suggestion';
  knowledge_base_id: string;
  model: string;
  sampled_files: number;
  sampled_chunks: number;
  source_file_ids: string[];
  extraction_schema: Record<string, unknown>;
  summary?: string | null;
  assumptions?: string[];
  used_fallback_schema?: boolean;
  warning?: string | null;
}

export interface KgFileAssociation {
  knowledge_base_id: string;
  file_id: string;
  filename?: string;
  content_type?: string;
  bytes?: number;
  status: 'pending' | 'extracting' | 'completed' | 'failed';
  entity_count: number;
  relationship_count: number;
  chunks_extracted?: number;
  total_chunks?: number;
  finalization_status?: 'pending' | 'completed' | 'failed';
  finalization_error?: string;
  finalized_at?: number;
  final_extraction?: Record<string, unknown>;
  last_error?: string;
  created_at: number;
  updated_at: number;
}

export interface KgEntity {
  entity_id: string;
  name: string;
  entity_type: string;
  properties: Record<string, unknown>;
  confidence: number;
  source_chunk_ids: string[];
  status: string;
  created_at: number;
  updated_at: number;
}

export interface KgRelationship {
  relationship_id: string;
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: string;
  properties: Record<string, unknown>;
  confidence: number;
  source_chunk_id?: string;
  source_file_id?: string;
  created_at: number;
}

export interface KgSearchRequest {
  query: string;
  top_k?: number;
  entity_type?: string;
}

export interface KgSearchResponse {
  data: KgEntity[];
}

export interface KgQueryRequest {
  query: string;
  include_source_chunks?: boolean;
  max_hops?: number;
}

export interface KgQueryResponse {
  entities: KgEntity[];
  neighbors?: KgEntity[];
  relationships: KgRelationship[];
  source_chunks?: Array<{
    chunk_id: string;
    file_id: string;
    content: string;
    score: number;
  }>;
}

export interface KgInfrastructureStatus {
  object: 'knowledge_graph_status';
  knowledge_base_id: string;
  name: string;
  project_id: string;
  organization_id: string;
  embedding_model: string;
  infrastructure: {
    provisioning_ready: boolean;
    graph_id: string;
    vector_binding_name: string;
    bindings: Record<string, boolean>;
    graph_registry: {
      present: boolean;
      created_at: number | null;
      updated_at: number | null;
    };
  };
  metrics: {
    entities_active: number;
    files_total: number;
  };
}
