# Ragwalla Agents SDK - TypeScript

The official TypeScript SDK for the Ragwalla Agents API. Build powerful AI applications with agents, real-time chat, vector search, and more.

## Installation

```bash
npm install @ragwalla/agents-sdk
```

**Requirements:** a runtime with a standard global `WebSocket` — browsers, Cloudflare Workers, Deno, Bun, or **Node.js ≥ 22**. (Older Node works only if you assign a `WebSocket` implementation to `globalThis.WebSocket`.) The SDK no longer depends on the `ws` package.

## Quick Start

```typescript
import { Ragwalla } from '@ragwalla/agents-sdk';

const ragwalla = new Ragwalla({
  apiKey: process.env.RAGWALLA_API_KEY!,
  baseURL: 'https://example.ai.ragwalla.com/v1' // Required
});

// Create an agent
const agent = await ragwalla.agents.create({
  name: 'My Assistant',
  instructions: 'You are a helpful AI assistant.'
});

// Get WebSocket token for real-time chat
const tokenResponse = await ragwalla.agents.getToken({
  agent_id: agent.id,
  expires_in: 3600
});

// Create WebSocket connection (optional continuation mode defaults to 'auto')
const ws = ragwalla.createWebSocket({
  continuationMode: 'auto' // or 'manual' to require explicit resume events
});

ws.on('connected', () => {
  ws.sendMessage({ role: 'user', content: 'Hello!' });
});

ws.on('message', (message) => {
  console.log('Agent:', message.content);
});

await ws.connect(agent.id, 'main', tokenResponse.token);
```

## Features

- ✅ **Agent Management** - Create, update, manage skills/tools, delegation, and child agents
- ✅ **Assistant Management** - Create, update, and manage assistants
- ✅ **Threads & Messages** - Create conversation threads and manage messages via REST
- ✅ **Real-time WebSocket Chat** - Live streaming chat with automatic reconnection and run cancellation
- ✅ **Organizations & Projects** - Manage orgs, projects, and webhooks
- ✅ **Endpoints** - Provision and manage WfP dispatch endpoints
- ✅ **MCP Servers** - Register MCP servers, discover tools, manage agent access, OAuth
- ✅ **Files** - Upload and manage files
- ✅ **Vector Stores** - Semantic search, file management, and vector inspection
- ✅ **Knowledge Graphs** - Create graphs, manage entities/relationships, semantic search and query
- ✅ **Memories & Memory Stores** - Agent memory CRUD, semantic search, shared memory stores
- ✅ **Workspace Files** - Agent identity/configuration files (IDENTITY.md, SOUL.md, etc.)
- ✅ **Channels** - Configure messaging channels (Telegram, Slack, WhatsApp)
- ✅ **Models** - List available AI models
- ✅ **Quota Management** - Track usage and limits
- ✅ **Feature Flags** - Resolve flags at agent/project/org/namespace scope
- ✅ **TypeScript Native** - Full type safety and IntelliSense
- ✅ **Error Handling** - Comprehensive error types
- ✅ **Automatic Retries** - Built-in retry logic for failed requests
- ✅ **Cloudflare Workers** - Optimized build for serverless environments

## Configuration

```typescript
const ragwalla = new Ragwalla({
  apiKey: 'your-api-key',                        // Required
  baseURL: 'https://example.ai.ragwalla.com/v1', // Required - your custom domain
  timeout: 30000,                                // Optional, request timeout in ms
  debug: false                                   // Optional, enable debug logging
});
```

**Important:** The `baseURL` must follow the pattern `https://[subdomain].ai.ragwalla.com/v1` where `[subdomain]` is your organization's unique identifier.

### Debug Logging

Enable debug logging to troubleshoot connection issues and monitor SDK behavior:

```typescript
const ragwalla = new Ragwalla({
  apiKey: process.env.RAGWALLA_API_KEY!,
  baseURL: 'https://example.ai.ragwalla.com/v1',
  debug: true // Enables detailed logging for HTTP and WebSocket
});

// Debug logs will show:
// - HTTP request/response details
// - WebSocket connection events
// - Message sending/receiving
// - Error details and stack traces
// - Timeout and retry information
```

## Agent Management

### Create an Agent

```typescript
const agent = await ragwalla.agents.create({
  name: 'Customer Support Agent',
  description: 'Handles customer inquiries',
  model: 'gpt-4',
  instructions: 'You are a helpful customer support representative.',
  tools: ['tool_id_1', 'tool_id_2'],
  systemSkillIds: ['memory_search', 'fetch_url'],
  metadata: {
    department: 'support',
    version: '1.0'
  }
});
```

### List Agents

```typescript
const agents = await ragwalla.agents.list({
  limit: 10,
  order: 'desc'
});

console.log(agents.data); // Array of agents
```

### Update an Agent

```typescript
const updatedAgent = await ragwalla.agents.update(agent.id, {
  instructions: 'Updated instructions for the agent'
});
```

### Delete an Agent

```typescript
await ragwalla.agents.delete(agent.id);
```

### Skills (Tools)

```typescript
// Attach a skill
const skill = await ragwalla.agents.attachSkill(agent.id, {
  type: 'http',
  name: 'docs-lookup',
  description: 'Fetch documentation'
});

// Attach many skills in one request
const bulkAttach = await ragwalla.agents.attachSkills(agent.id, [
  {
    type: 'mcp',
    name: 'app_read_file',
    description: 'Read a file from the app workspace',
    serverId: 'mcp_server_123',
    serverName: 'perspect-mcp-server',
    serverUrl: 'https://example.com/mcp/site',
    toolName: 'app_read_file',
    transportType: 'http',
    parameters: {}
  }
]);
// bulkAttach: { created: [...], skipped: [...], failed: [...], total: 1 }

// List skills
const skills = await ragwalla.agents.listSkills(agent.id);

// Update a skill
await ragwalla.agents.updateSkill(agent.id, skill.id, { description: 'Updated' });

// Detach a skill
await ragwalla.agents.detachSkill(agent.id, skill.id);

// List available system skills
const systemSkills = await ragwalla.agents.listSystemSkills();

// Enable a system skill
await ragwalla.agents.enableSystemSkill(agent.id, 'memory_search');

// Bulk-enable system skills
const result = await ragwalla.agents.enableSystemSkillsBulk(agent.id, [
  'memory_search', 'memory_write', 'fetch_url'
]);
// result: { enabled: [...], skipped: 0, total: 3 }

// Or provision system skills while creating the agent.
// For orchestrators, omit systemSkillIds to use platform defaults.
// Pass [] to opt out of default DB-backed system skills.
const orchestrator = await ragwalla.agents.create({
  name: 'Coordinator',
  instructions: 'Coordinate work across child agents.',
  agentType: 'orchestrator',
  executionMode: 'execution-only',
  systemSkillIds: ['create_subagent', 'teardown_subagent']
});

// Refresh all tool definitions (syncs MCP tools + reloads from DB)
await ragwalla.agents.refreshTools(agent.id);
```

### Delegation & Child Agents

Agents can delegate and be delegated to by default. Opt out at creation time:

```typescript
const isolated = await ragwalla.agents.create({
  name: 'Isolated Reviewer',
  instructions: 'Review the text you are given.',
  executionMode: 'execution-only',
  canDelegate: false,
  canBeDelegatedTo: false,
});
```

```typescript
// Grant delegation: allow agent to delegate to an orchestrator
await ragwalla.agents.grantDelegationPermission(agent.id, orchestratorId, 'Orchestrator');

// Revoke delegation
await ragwalla.agents.revokeDelegationPermission(agent.id, orchestratorId);

// List child agents (subagents of an orchestrator)
const children = await ragwalla.agents.listChildren(orchestratorId);

// Tear down a specific child
await ragwalla.agents.teardownChild(orchestratorId, childId);

// Tear down all children
await ragwalla.agents.teardownAllChildren(orchestratorId);
```

### Knowledge Graph Attachments

```typescript
// Attach a knowledge graph to an agent
await ragwalla.agents.attachKnowledgeGraph(agent.id, { knowledge_base_id: kgId });

// List attached knowledge graphs
const kgs = await ragwalla.agents.listKnowledgeGraphs(agent.id);

// Detach
await ragwalla.agents.detachKnowledgeGraph(agent.id, kgId);
```

## Assistant Management

### Create an Assistant

```typescript
const assistant = await ragwalla.assistants.create({
  name: 'Math Tutor',
  description: 'Helps users solve math problems',
  model: 'gpt-4o',
  instructions: 'You are a concise math tutor.',
  tools: [
    { type: 'code_interpreter' },
    { type: 'file_search' }
  ],
  tool_resources: {
    file_search: {
      vector_store_ids: ['vs_123']
    }
  },
  metadata: {
    domain: 'education'
  }
});
```

### List Assistants

```typescript
const assistants = await ragwalla.assistants.list({
  limit: 20,
  order: 'desc'
});

console.log(assistants.data); // Array of assistants
```

### Update an Assistant

```typescript
const updatedAssistant = await ragwalla.assistants.update(assistant.id, {
  instructions: 'Updated instructions for the assistant',
  metadata: {
    version: '2.0'
  }
});
```

### Delete an Assistant

```typescript
await ragwalla.assistants.delete(assistant.id);
```

## Real-time WebSocket Chat

> **Note:** All agent chat happens via WebSocket, not HTTP. HTTP endpoints are for CRUD operations only (agents, threads, messages, etc.). Use `createWebSocket()` for real-time conversations.

### Basic WebSocket Usage

```typescript
// Get connection token
const tokenResponse = await ragwalla.agents.getToken({
  agent_id: agent.id,
  expires_in: 3600
});

// Create WebSocket connection
const ws = ragwalla.createWebSocket();

// Set up event listeners
ws.on('connected', () => {
  console.log('Connected to agent');
});

ws.on('message', (message) => {
  console.log('Agent:', message.content);
});

ws.on('error', (error) => {
  console.error('Error:', error);
});

// Connect and send message
await ws.connect(agent.id, 'main', tokenResponse.token);
ws.sendMessage({
  role: 'user',
  content: 'Hello via WebSocket!'
});
```

### Optional request correlation

Supply a string `requestId` to correlate native commands with their direct replies
and errors. Choose an ID unique among outstanding requests on that socket: a counter
or UUID works. The SDK does not generate IDs, deduplicate requests, or wait for a
server acknowledgment when a send method returns.

```typescript
// Register listeners before sending; replies can arrive in any order.
ws.on('requestAck', ({ requestId, requestType }) => {
  console.log('Setting applied:', requestId, requestType);
});
ws.on('error', ({ requestId, error }) => {
  console.error('Request failed:', requestId, error);
});
ws.on('runStarted', ({ requestId, threadId, userMessageId, runId }) => {
  // Save this pairing. Later chunks/completion use runId, not requestId.
  console.log('Run created:', requestId, threadId, userMessageId, runId);
});
ws.on('rawFrame', (frame) => {
  if (frame.type === 'message_received' && frame.requestId === 'chat-1') {
    console.log('Chat stored:', frame.messageId);
  }
});

ws.sendMessage({ role: 'user', content: 'Hello' }, { requestId: 'chat-1' });
ws.setSemanticAugmentation(true, { requestId: 'settings-1' });
ws.send({ type: 'load_thread_history', threadId: 'thread_123', requestId: 'history-1' });
```

The optional second argument is supported by `sendMessage`, `sendMessageAsync`,
`setContinuationMode`, `setTruncationStrategy`, `setMaxKbCharsPerChunk`,
`setSemanticAugmentation`, `continueRun`, and `cancelRun`. For example,
`cancelRun(undefined, { requestId: 'cancel-1' })` targets the current run.
Raw `send`/`sendAsync` take `requestId` directly on the frame.

Normalized events preserve an echoed `requestId`, as do `rawFrame`/`frame`.
The three truncation/KB/semantic setters reply with `requestAck`;
continuation-mode changes use the existing `continuationModeUpdated` event.
Setters with an ID require an open connection and throw before changing local settings
when disconnected. Calls without an ID retain their existing behavior.

For chat, `message_received` confirms the user message was stored. `runStarted`
(the native `run_started` frame) then supplies its `userMessageId` and the persisted
`runId` before execution. It also works without a `requestId`. This acknowledges run
creation, not completion or successful model execution.

On reconnect, `runState.userMessageId` and `threadHistory.latestRun.userMessageId`
identify the initiating prompt for the recovered run. These optional fields require
a server with prompt/run correlation support and are absent for older runs or other
run creation paths. History messages also expose `runId`; for pending user inputs
that is processing ownership and can be cleared on failure or reassigned on retry.
Use the run's `userMessageId` for immutable origin, and `runId` to match subsequent
run events. Request IDs remain socket-local correlation, not durable identifiers.

A request can produce multiple replies. Shared run events continue to use their
run/message identifiers, and unsolicited events need not have a request ID.
This requires a server with native request correlation support; older servers will
not echo the ID. Unknown commands and native `auth` requests receive correlated
errors on supported servers; authentication still happens during connection setup.

Use `ws.send({ type: 'ping', requestId: 'ping-1' })` and the `pong` event for a
correlated ping. This wakes the Durable Object. Keep sending the exact ID-free
`{"type":"ping"}` frame for hibernation-friendly keepalives.

### WebSocket Events

The WebSocket client emits the following events:

#### Connection Events
- `connected` - Successfully connected to agent
- `disconnected` - Connection closed (`{ code, reason }`)
- `reconnectFailed` - Reconnection attempts failed (`{ attempts }`)
- `connectionStatus` - Connection status updates

#### Message Events
- `message` - Generic message event (receives all message types)
- `chunk` - Streaming content chunk (`{ content, messageId }`)
- `complete` - A run's terminal frame (`{ messageId, runId?, failed?, cancelled?, reason?, error?, usage? }`). `failed` or `cancelled` set means the run did NOT succeed; neither means completed. Fields are present only when the server sent them — absent is "not reported", not `false`.
- `messageCreated` - New message started (`{ messageId, role }`)
- `resume` - On reconnect, the current visible text of the in-flight message bubble (`{ messageId, content }`). Replace the bubble body with `content`, then continue appending live `chunk`s.

#### Agent Events
- `agentState` - Agent state updates (Cloudflare-specific)
- `threadInfo` - Thread information (`{ threadId, assistantId, isNewThread }`)
- `typing` - Typing indicator (`{ isTyping }`)
- `toolUse` - Tool usage information (`{ tools }`)
- `runState` - On reconnect, the current run status for this connection (`{ runId, runStatus, activeTool }`). `runStatus` is a `RunStatus` (may be terminal if the run finished while disconnected); `activeTool` is `null` in v1. This is the single reconnect-status event (the former `runResumed` has been removed).
- `runPaused` - Invocation paused awaiting manual resume (`{ runId, threadId, reason, stats })`
- `runCancelled` - Run was cancelled (`{ runId }`)
- `continuationModeUpdated` - Server acknowledged continuation mode change
- `continueRunResult` - Response to a `continue_run` request (`{ status, runId, error? }`)

#### Other Events
- `runStarted` - Persisted prompt/run pairing (`{ threadId, userMessageId, runId, requestId? }`)
- `requestAck` - Acknowledgment of a correlated setting update (`{ type, requestId, requestType }`)
- `pong` - Keepalive reply with optional `requestId` and `timestamp`
- `rawFrame` / `frame` - Every inbound Ragwalla frame before SDK normalization. Durable Object proxies can relay this object directly to browsers to preserve upstream frame shapes, including future frame types.
- `status` - Transient status/progress updates (e.g., tool execution progress)
- `threadHistory` - Thread message history (`{ threadId, messages, messageCount, latestRun }`). `threadId` is always populated by the server, so this frame identifies its own thread. `latestRun` has three states — **absent** (server predates the field; run state unknown), `null` (server confirms the thread has no runs), or `{id, status, lastError}` — for telling a live-but-silent run from a dead one. Check with `'latestRun' in payload` before reading it; do not treat absent as null. Note `messages[].createdAt` is unix **seconds**, unlike `thread_info.createdAt` which is ISO-8601.
- `tokenUsage` - Emitted after each LLM call a run makes (`{ runId, model, call, totals }`). `call` is that call's `{ promptTokens, completionTokens, cachedTokens }`; `totals` is the run's cumulative `{ inputTokens, outputTokens, cachedInputTokens, llmCallCount, models }`, so a missed frame is recovered by the next. Requires a server that emits `token_usage`.
- `error` - Error occurred
- `rawMessage` - Unhandled message types (for debugging)

### Reconnection & Resume

The client automatically reconnects after a dropped socket and recovers an in-flight
streamed reply — you get a `resume` frame with the message's current text, then live
`chunk`s continue. **`resume` is a full snapshot: replace the bubble text with it, then
append subsequent chunks.** See **[docs/reconnect-resume.md](docs/reconnect-resume.md)** for
the full guide, including how to implement the same protocol without the SDK (raw WebSocket,
for non-TypeScript clients).

Durable Object proxies should use `rawFrame`/`frame` as the browser data plane and avoid
reconstructing SDK typed events. If reconnects need fresh short-lived tokens, provide a
`getReconnectToken` hook and use `sendAsync()` / `sendMessageAsync()` for upstream writes
that should reconnect before sending or fail before accepting the browser message:

```typescript
const ws = ragwalla.createWebSocket({
  getReconnectToken: async ({ agentId }) => {
    const { token } = await ragwalla.agents.getToken({ agent_id: agentId, expires_in: 300 });
    return token;
  }
});

let browserRelayOpen = true;
ws.on('rawFrame', (frame) => {
  if (!browserRelayOpen) return;
  try {
    browserSocket.send(JSON.stringify(frame));
  } catch (error) {
    browserRelayOpen = false;
    ws.disconnect();
    console.error('Browser relay failed', error);
  }
});

await ws.connect(agent.id, connectionId, initialToken, threadId);
await ws.sendAsync(clientFrame);
```

SDK event listener exceptions are caught and logged, so relay failures must be handled
inside the `rawFrame` listener instead of relying on thrown errors for proxy control flow.
For complete copy/paste proxy examples, see **[docs/proxy-support.md](docs/proxy-support.md)**.

### Streaming Response Example

```typescript
const ws = ragwalla.createWebSocket();

let fullResponse = '';

// Listen for streaming chunks (recommended)
ws.on('chunk', (chunk) => {
  process.stdout.write(chunk.content);
  fullResponse += chunk.content;
});

// Listen for completion
ws.on('complete', (info) => {
  console.log('\nMessage completed:', info.messageId);
  console.log('Full response:', fullResponse);
});

// Or use generic 'message' event (also receives chunks)
ws.on('message', (message) => {
  console.log('Received:', message.content);
});

await ws.connect(agent.id, 'session-id', token);
ws.sendMessage({ role: 'user', content: 'Hello!' });
```

### Run to Completion

For server-side callers that need one answer rather than a stream, `runToCompletion`
sends a message and resolves when the run it starts has ended:

```typescript
import { RunToCompletionError } from '@ragwalla/agents-sdk';

try {
  const result = await ws.runToCompletion(
    { role: 'user', content: 'Summarize this document.' },
    { requestId: crypto.randomUUID(), timeoutMs: 120_000 },
  );
  if (result.status === 'completed') {
    console.log(result.text);
  } else {
    console.error('Run', result.runId, result.status, result.error);
  }
  // Present only when the server reported usage. 'terminal' totals are final;
  // 'stream' totals may undercount if frames were missed across a reconnect.
  console.log(result.usage);
} catch (error) {
  if (error instanceof RunToCompletionError) {
    // request_failed | timeout | aborted | connection_lost
    console.error(error.code, error.details);
  }
}
```

It correlates through the native prompt/run correlation above — `requestId` →
`run_started` → `runId` — so it ignores frames from other runs on the same socket.
The server streams one run per socket (a new message rebinds the socket), so while
`runToCompletion` waits it holds the connection: a second `runToCompletion` rejects, and
`sendMessage`/`sendMessageAsync`/`send`/`sendAsync` refuse any chat message until it settles.
Other frames (`cancelRun`, settings, ping) still pass. Use a separate connection per
concurrent run.
It resolves with `status: 'completed' | 'failed' | 'cancelled'` whenever the server
reports an outcome, and rejects with `RunToCompletionError` only when it cannot observe
one. On a timeout, an abort (`signal`), or a run-scoped `error`, it sends a `cancel_run`
naming the run so an abandoned wait does not leave the run executing. It never resends
the message: after a dropped socket the client reconnects to the thread and the server
resumes the in-flight message.

### Manual Continuation Workflow

Agents can pause execution when they hit invocation limits. Switch to manual mode to let users decide when to resume:

```typescript
const ws = ragwalla.createWebSocket({ continuationMode: 'manual' });

ws.on('runPaused', ({ runId, reason }) => {
  console.log('Run paused', runId, reason);
  // Trigger your UI to show a Continue button, then call continueRun when ready
  ws.continueRun(runId);
});

await ws.connect(agent.id, 'session-id', token);
```

You can toggle modes at runtime:

```typescript
ws.setContinuationMode('manual'); // switch to manual
ws.setContinuationMode('auto');   // revert to auto scheduling
```

### Cancelling a Run

Cancel the active run (or a specific run by ID). The server responds with a `runCancelled` event.

```typescript
ws.on('runCancelled', ({ runId }) => {
  console.log('Run cancelled:', runId);
});

// Cancel the current active run
ws.cancelRun();

// Cancel a specific run by ID
ws.cancelRun('run_abc123');
```

## Vector Search

### Simple Search

```typescript
const results = await ragwalla.vectorStores.search('vector_store_id', {
  query: 'How to use the API?',
  max_num_results: 5
});

results.data.forEach(result => {
  console.log(`Score: ${result.score}`);
  console.log(`File: ${result.filename}`);
  console.log(`Content: ${result.content.map(item => item.text).join('\n')}`);
});
```

### Advanced Search with Filters

```typescript
const results = await ragwalla.vectorStores.search('vector_store_id', {
  query: 'JavaScript examples',
  max_num_results: 3,
  filters: {
    language: 'javascript',
    category: 'tutorial'
  },
  rewrite_query: true,
  ranking_options: {
    ranker: 'hybrid',
    score_threshold: 0.8
  }
});
```

### File Management in Vector Stores

```typescript
// Add a file to a vector store (triggers embedding)
const vsFile = await ragwalla.vectorStores.addFile('vs_id', { file_id: 'file_abc' });

// List files
const files = await ragwalla.vectorStores.listFiles('vs_id', { limit: 20 });

// Check file status
const fileStatus = await ragwalla.vectorStores.retrieveFile('vs_id', 'file_abc');

// Remove a file
await ragwalla.vectorStores.removeFile('vs_id', 'file_abc');

// Inspect vectors for a file (useful for debugging embeddings)
const vectors = await ragwalla.vectorStores.getVectorsForFile('vs_id', 'file_abc', {
  limit: 100,
  include_values: true
});
```

## Threads

```typescript
// Create a thread (optionally seed with messages)
const thread = await ragwalla.threads.create({
  messages: [{ role: 'user', content: 'Hello!' }],
  metadata: { source: 'web' }
});

// Retrieve
const t = await ragwalla.threads.retrieve(thread.id);

// Update metadata
await ragwalla.threads.update(thread.id, { metadata: { stage: 'trial' } });

// Delete
await ragwalla.threads.delete(thread.id);
```

## Messages

```typescript
// Send a message on a thread
const message = await ragwalla.messages.create(thread.id, {
  role: 'user',
  content: 'What can you do?',
  metadata: { source: 'web' }
});

// Retrieve a single message
const msg = await ragwalla.messages.retrieve(thread.id, message.id);

// List messages with pagination
let page = await ragwalla.messages.list(thread.id, { limit: 50, order: 'desc' });
while (page.has_more && page.last_id) {
  page = await ragwalla.messages.list(thread.id, {
    limit: 50,
    order: 'desc',
    before: page.last_id
  });
}
```

## Organizations & Projects

```typescript
// List orgs
const orgs = await ragwalla.organizations.list();

// Create an org
const org = await ragwalla.organizations.create({ name: 'Acme Corp' });
const sameOrg = await ragwalla.organizations.retrieve(org.id);
await ragwalla.organizations.update(org.id, { name: 'Acme Corp, Inc.' });

// Create a project under an org
const project = await ragwalla.organizations.projects.create(org.id, { name: 'Demo' });

// List / retrieve / update / archive projects
const projects = await ragwalla.organizations.projects.list(org.id);
await ragwalla.organizations.projects.update(org.id, project.id, { description: 'Updated' });
await ragwalla.organizations.projects.archive(org.id, project.id);
// Delete the org only after cleaning up projects, API keys, and other org-scoped resources.
await ragwalla.organizations.delete(org.id);
```

### Webhooks

```typescript
// Create an outbound webhook
const webhook = await ragwalla.organizations.webhooks.create(org.id, {
  url: 'https://example.com/webhook',
  events: ['agent.message'],
});

// List / retrieve / update / delete
const webhooks = await ragwalla.organizations.webhooks.list(org.id);
await ragwalla.organizations.webhooks.update(org.id, webhook.id, { url: 'https://new.example.com' });
await ragwalla.organizations.webhooks.delete(org.id, webhook.id);

// List delivery attempts
const deliveries = await ragwalla.organizations.webhooks.listDeliveries(org.id, webhook.id);
```

## Endpoints (WfP)

Manage dispatch endpoints with platform keys (`pk-*`). Creation is async — poll until `status: 'active'`.

```typescript
const ep = await ragwalla.endpoints.create({ name: 'my-endpoint', variant: 'default' });

// Poll until active
const ready = await ragwalla.endpoints.retrieve(ep.id);

// List all endpoints
const endpoints = await ragwalla.endpoints.list();

// Delete
await ragwalla.endpoints.delete(ep.id);
```

## MCP Servers

Register MCP (Model Context Protocol) servers so agents can invoke their tools.

```typescript
// Create an MCP server
const server = await ragwalla.mcpServers.create({
  name: 'CRM Tools',
  url: 'https://crm.example.com/mcp',
  transport_type: 'http',
  auth_type: 'bearer',
  auth_config: { token: process.env.CRM_MCP_TOKEN! }
});

// List / retrieve / update / delete
const servers = await ragwalla.mcpServers.list();
await ragwalla.mcpServers.update(server.id, { description: 'Updated' });
await ragwalla.mcpServers.delete(server.id);

// Test connectivity without saving
const test = await ragwalla.mcpServers.test({
  name: 'CRM Tools',
  url: 'https://crm.example.com/mcp',
  transport_type: 'http'
});

// Discover tools (cached for 1 hour)
const { tools, server_info } = await ragwalla.mcpServers.discoverTools(server.id);

// Grant/revoke agent access
await ragwalla.mcpServers.grantAgentAccess(server.id, { agent_id: agent.id, enabled: true });
const access = await ragwalla.mcpServers.listAgentAccess(server.id);
await ragwalla.mcpServers.grantAgentAccess(server.id, { agent_id: agent.id, enabled: false });
```

### MCP OAuth

```typescript
// Start OAuth flow
const { auth_url } = await ragwalla.mcpServers.startOAuth(server.id, 'https://app.com/callback');

// Check status
const { auth_status } = await ragwalla.mcpServers.oauthStatus(server.id);

// Refresh / revoke
await ragwalla.mcpServers.refreshOAuth(server.id);
await ragwalla.mcpServers.revokeOAuth(server.id);
```

## Files

```typescript
// Upload a file
const file = await ragwalla.files.upload({
  file: myBlob,          // Blob or File
  purpose: 'assistants',
  metadata: { source: 'upload' }
});

// Retrieve / list / delete
const f = await ragwalla.files.retrieve(file.id);
const fileList = await ragwalla.files.list({ purpose: 'assistants', limit: 20 });
await ragwalla.files.delete(file.id);
```

## Workspace Files

Agent identity and configuration files (e.g., IDENTITY.md, SOUL.md, USER.md, TOOLS.md) that are loaded into the agent's context automatically.

```typescript
// Create or upsert
await ragwalla.workspaceFiles.create(agent.id, {
  file_type: 'IDENTITY',
  content: '# Agent Identity\nYou are a support agent.'
});

// List all workspace files
const wsFiles = await ragwalla.workspaceFiles.list(agent.id);

// Retrieve / update / delete by type
const identity = await ragwalla.workspaceFiles.retrieve(agent.id, 'IDENTITY');
await ragwalla.workspaceFiles.update(agent.id, 'IDENTITY', { content: 'Updated content' });
await ragwalla.workspaceFiles.delete(agent.id, 'IDENTITY');

// Preview composed system prompt
const preview = await ragwalla.workspaceFiles.preview(agent.id);
```

## Memories

Agent memory — facts, preferences, and observations learned during conversations.

```typescript
// Create a memory
const memory = await ragwalla.memories.create(agent.id, {
  content: 'User prefers dark mode',
  metadata: { category: 'preference' }
});

// Batch create (max 20)
await ragwalla.memories.createBatch(agent.id, {
  memories: [
    { content: 'User works at Acme Corp' },
    { content: 'User timezone is EST' }
  ]
});

// Semantic search
const results = await ragwalla.memories.search(agent.id, {
  query: 'user preferences',
  top_k: 5
});

// List / retrieve / delete
const mems = await ragwalla.memories.list(agent.id, { limit: 50 });
const mem = await ragwalla.memories.retrieve(agent.id, memory.id);
await ragwalla.memories.delete(agent.id, memory.id);

// User-scoped memories (pass user_id)
await ragwalla.memories.search(agent.id, { query: 'preferences', user_id: 'user_123' });
```

## Memory Stores

Shared memory stores that can be attached to multiple agents.

```typescript
// Create a memory store
const store = await ragwalla.memoryStores.create({ name: 'Shared Knowledge' });

// List / retrieve / update / delete
const stores = await ragwalla.memoryStores.list();
await ragwalla.memoryStores.update(store.id, { name: 'Updated Name' });
await ragwalla.memoryStores.delete(store.id);

// Attach to / detach from an agent
await ragwalla.memoryStores.attachToAgent(agent.id, { memory_store_id: store.id });
const attached = await ragwalla.memoryStores.listForAgent(agent.id);
await ragwalla.memoryStores.detachFromAgent(agent.id, store.id);
```

## Knowledge Graphs

```typescript
// Create a knowledge graph
const kg = await ragwalla.knowledgeGraphs.create({ name: 'Product KB' });

// List / retrieve / update / delete
const kgs = await ragwalla.knowledgeGraphs.list();
await ragwalla.knowledgeGraphs.update(kg.id, { name: 'Updated' });
await ragwalla.knowledgeGraphs.delete(kg.id);

// Check provisioning status
const status = await ragwalla.knowledgeGraphs.getStatus(kg.id);

// Suggest an extraction schema from sampled data
const schema = await ragwalla.knowledgeGraphs.suggestSchema(kg.id);

// File management (add triggers entity extraction)
await ragwalla.knowledgeGraphs.addFile(kg.id, { file_id: 'file_abc' });
const kgFiles = await ragwalla.knowledgeGraphs.listFiles(kg.id);
const kgFile = await ragwalla.knowledgeGraphs.getFile(kg.id, 'file_abc', { include_materialized: true });
await ragwalla.knowledgeGraphs.removeFile(kg.id, 'file_abc');

// Browse entities and relationships
const entities = await ragwalla.knowledgeGraphs.listEntities(kg.id, { entity_type: 'Person' });
const entity = await ragwalla.knowledgeGraphs.getEntity(kg.id, 'entity_id');
const rels = await ragwalla.knowledgeGraphs.listRelationships(kg.id, { entity_id: 'entity_id' });

// Semantic search
const searchResults = await ragwalla.knowledgeGraphs.search(kg.id, { query: 'CEO' });

// Graph-aware query (decompose → traverse → context)
const queryResult = await ragwalla.knowledgeGraphs.query(kg.id, { query: 'Who reports to the CEO?' });
```

## Channels

Configure messaging channels (Telegram, Slack, WhatsApp) for an agent.

```typescript
// Create/update a channel
const channel = await ragwalla.channels.create(agent.id, {
  type: 'telegram',
  config: { bot_token: process.env.TG_BOT_TOKEN! }
});

// List / delete
const channels = await ragwalla.channels.list(agent.id);
await ragwalla.channels.delete(agent.id, channel.id);

// Check status (includes live webhook status for Telegram)
const chStatus = await ragwalla.channels.getStatus(agent.id, channel.id);

// Retry webhook registration
await ragwalla.channels.retryWebhook(agent.id, channel.id);
```

## Models

```typescript
const models = await ragwalla.models.list();
// models.data: available models
// models.curated: curated model IDs
```

## Feature Flags

```typescript
// Resolve flags (scope hierarchy: agent → project → org → global)
const flags = await ragwalla.featureFlags.resolve({
  flags: ['knowledge_graphs', 'mcp_oauth'],
  agent_id: agent.id
});
```

### Namespace Flags (platform keys only)

```typescript
// Set a namespace-level flag
await ragwalla.namespaceFlags.set({ flag: 'beta_feature', enabled: true });

// List all namespace flags
const nsFlags = await ragwalla.namespaceFlags.list();

// Delete
await ragwalla.namespaceFlags.delete({ flag: 'beta_feature' });
```

## Quota Management

### Check Quota

```typescript
const quotaCheck = await ragwalla.quota.check({
  userId: 'user_123',
  action: 'chat_completion'
});

if (quotaCheck.allowed) {
  // Proceed with action
} else {
  console.log('Quota exceeded');
}
```

### Send Quota Event

```typescript
await ragwalla.quota.sendEvent('worker_id', {
  action: 'message_sent',
  metadata: {
    tokens_used: 150,
    model: 'gpt-4'
  }
});
```

## Error Handling

The SDK throws `RagwallaAPIError` for API-related errors:

```typescript
import { RagwallaAPIError } from '@ragwalla/agents-sdk';

try {
  const agent = await ragwalla.agents.retrieve('invalid_id');
} catch (error) {
  if (error instanceof RagwallaAPIError) {
    console.log('API Error:', error.message);
    console.log('Status:', error.status);
    console.log('Type:', error.type);
    console.log('Code:', error.code);
  }
}
```

## Cloudflare Workers Support

The SDK is fully compatible with Cloudflare Workers! Use the Workers-optimized build:

```typescript
import { Ragwalla } from '@ragwalla/agents-sdk/workers';

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const ragwalla = new Ragwalla({
      apiKey: env.RAGWALLA_API_KEY,
      baseURL: env.RAGWALLA_BASE_URL // e.g., 'https://myorg.ai.ragwalla.com/v1'
    });

    const agent = await ragwalla.agents.create({
      name: 'Worker Agent',
      instructions: 'You are an AI assistant running in Cloudflare Workers.'
    });

    // Get WebSocket token for chat
    const tokenResponse = await ragwalla.agents.getToken({
      agent_id: agent.id,
      expires_in: 3600
    });

    return new Response(JSON.stringify({ 
      agent,
      token: tokenResponse.token,
      message: 'Use WebSocket to chat with this agent'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

### WebSocket in Workers

```typescript
import { RagwallaWebSocket } from '@ragwalla/agents-sdk/workers';

// In your Workers WebSocket handler
const ws = new RagwallaWebSocket({
  baseURL: 'wss://myorg.ai.ragwalla.com/v1'
});

await ws.connect(agentId, 'main', token);
```

### Key Differences for Workers

- Import from `@ragwalla/agents-sdk/workers` instead of the main package
- Use `env` bindings for environment variables instead of `process.env`
- Outbound WebSocket uses Workers `fetch()` with an Upgrade request instead of the Node.js `ws` package
- Optimized build excludes Node.js-specific dependencies

## Examples

The `examples/` directory contains both basic and production-ready examples to help you integrate the SDK into your applications.

### Getting Started Examples

Perfect for learning the basics:

- **`basic-usage.ts`** - Agent CRUD operations and token generation
- **`streaming-chat.ts`** - Streaming responses via WebSocket
- **`websocket-chat.ts`** - Real-time WebSocket communication
- **`advanced-websocket.ts`** - All event types and advanced patterns
- **`vector-search.ts`** - Vector store search with filters
- **`debug-websocket.ts`** - WebSocket debugging with detailed logging

### Production-Ready Examples

Battle-tested patterns for real-world applications:

- **`error-handling.ts`** - Comprehensive error handling with retry logic, exponential backoff, user-friendly messages, and monitoring integration
- **`conversation-management.ts`** - Multi-turn conversations with thread persistence, message history, and context management
- **`tool-calling.ts`** - Function/tool execution with parallel execution, error handling, and security best practices
- **`connection-resilience.ts`** - Advanced connection management with circuit breaker, message queueing, heartbeat monitoring, and network change detection
- **`manual-continuation.ts`** - Manual continuation mode with budget management, approval workflows, and dynamic mode switching
- **`react-integration.tsx`** - Complete React integration with custom hooks, optimistic updates, and TypeScript types

### Platform-Specific Examples

- **[docs/proxy-support.md](docs/proxy-support.md)** - Copy/paste WebSocket proxy examples for Cloudflare Workers and browser clients

### Running Examples

```bash
# Install dependencies
npm install

# Set your API key
export RAGWALLA_API_KEY=your_api_key_here
export RAGWALLA_BASE_URL=https://example.ai.ragwalla.com/v1

# Run any example
npx ts-node examples/basic-usage.ts
npx ts-node examples/error-handling.ts
npx ts-node examples/conversation-management.ts
```

## Environment Variables

Set your API key as an environment variable:

```bash
export RAGWALLA_API_KEY=your_api_key_here
```

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions. All API responses and request parameters are fully typed for the best development experience.

## Support

For issues and questions:
- GitHub Issues: [ragwalla-agents-sdk issues](https://github.com/ragwalla/agents-sdk/issues)
- Documentation: [Ragwalla Docs](https://docs.ragwalla.com)

## License

MIT License
