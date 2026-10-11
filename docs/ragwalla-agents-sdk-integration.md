---
title: Ragwalla Agents SDK Integration Guide
description: End-to-end guide for integrating endpoints, organizations, projects, agents, threads, messages, and WebSocket chat.
---

## Overview
Use `ragwalla-agents-sdk-typescript` to manage orgs/projects, provision agents, create threads/messages, and chat over WebSockets via your server-side proxy.

## Install & Configure
```bash
npm i ragwalla-agents-sdk-typescript
```
```ts
import { Ragwalla } from 'ragwalla-agents-sdk-typescript';

const client = new Ragwalla({
  apiKey: process.env.RAGWALLA_API_KEY!,
  baseURL: 'https://<tenant>.ai.ragwalla.com/v1',
  timeout: 30_000,
  debug: false,
});
```
- REST base URL must match `https://*.ai.ragwalla.com/v1`.

## Platform endpoints (WfP)
Manage dispatch endpoints with platform keys (`pk-*`). Provisioning is async: returns `status: "provisioning"`; poll until `status: "active"`.
```ts
const ep = await client.endpoints.create({ name: 'my-endpoint', variant: 'default' });
const epReady = await client.endpoints.retrieve(ep.id);
const list = await client.endpoints.list();
await client.endpoints.delete(ep.id);
```

## Organizations & Projects
List orgs available to the key, then create/manage projects under an org.
```ts
const orgs = await client.organizations.list();
const project = await client.organizations.projects.create(orgId, { name: 'Demo' });
await client.organizations.projects.update(orgId, project.id, { description: 'Docs demo' });
await client.organizations.projects.archive(orgId, project.id);
```

## Agents
Create, update, delete, list, and manage skills (tools), delegation, and children.
```ts
const agent = await client.agents.create({ name: 'Support Bot', model: 'gpt-4o', instructions: 'Be concise.' });
const fetched = await client.agents.retrieve(agent.id);
const agents = await client.agents.list({ limit: 20 });
await client.agents.update(agent.id, { instructions: 'Be concise and friendly.' });
await client.agents.delete(agent.id);
```
### Skills / tools
```ts
await client.agents.attachSkill(agent.id, { type: 'http', name: 'docs', description: 'Fetch docs' });
const skills = await client.agents.listSkills(agent.id);
await client.agents.updateSkill(agent.id, skillId, { description: 'Updated' });
await client.agents.detachSkill(agent.id, skillId);
// System skills
await client.agents.enableSystemSkill(agent.id, systemSkillId);
await client.agents.enableSystemSkillsBulk(agent.id, [systemSkillId]);
await client.agents.refreshTools(agent.id);
```
### Delegation & child agents
```ts
await client.agents.grantDelegationPermission(agent.id, targetAgentId, 'Researcher');
await client.agents.revokeDelegationPermission(agent.id, targetAgentId);
const children = await client.agents.listChildren(agent.id);
await client.agents.teardownChild(agent.id, childId);
await client.agents.teardownAllChildren(agent.id);
```

## Threads
Create/retrieve/update/delete conversation threads. When using org-level keys, pass `project_id`.
```ts
const thread = await client.threads.create({
  messages: [{ role: 'user', content: 'Hello!' }],
  tool_resources: {},
  metadata: { source: 'web' },
});
const t = await client.threads.retrieve(thread.id);
await client.threads.update(thread.id, { metadata: { stage: 'trial' } });
await client.threads.delete(thread.id);
```

## Messages (REST)
Use the built-in `messages` resource for thread messages.
```ts
// Send a message on an existing thread
const message = await client.messages.create(thread.id, {
  role: 'user',
  content: 'What can you do?',
  metadata: { source: 'web' },
});

// Retrieve a single message
const one = await client.messages.retrieve(thread.id, message.id);

// List messages
const msgs = await client.messages.list(thread.id, {
  limit: 50,
  order: 'desc',
  before: undefined, // paginate older
  after: undefined,  // paginate newer
  run_id: undefined, // optional filter by run
});

// msgs shape
// {
//   object: 'list',
//   data: Message[],
//   first_id: string | null,
//   last_id: string | null,
//   has_more: boolean
// }

// Paginate using has_more + cursors
let page = await client.messages.list(thread.id, { limit: 50, order: 'desc' });
while (page.has_more && page.last_id) {
  page = await client.messages.list(thread.id, {
    limit: 50,
    order: 'desc',
    before: page.last_id, // fetch older messages
  });
}
```

## WebSocket chat (proxied via Durable Object)
The UI should not connect to Ragwalla WebSockets directly. Instead, proxy WebSocket traffic through your Cloudflare Worker + Durable Object (DO) so you can:

- enforce auth/plan/policy on every frame
- keep platform keys and Ragwalla WS tokens server-side
- inject trusted metadata
- centrally log/meter usage

### Architecture
```
┌──────────┐       WS        ┌──────────────────┐       WS        ┌───────────┐
│  UI      │ ◄──────────────► │  ChatProxyDO     │ ◄──────────────► │  Ragwalla │
│ (browser)│  /.../chat/ws    │  (your worker)   │  wss://tenant   │  agent    │
└──────────┘                  └──────────────────┘  .ai.ragwalla   └───────────┘
                                     │                .com/v1
                              ┌──────┴──────┐
                              │ Policy layer│
                              │ • auth      │
                              │ • plan caps │
                              │ • rate limit│
                              │ • metadata  │
                              │   injection │
                              └─────────────┘
```

### Public endpoint contract (UI → your Worker)
Expose a single WebSocket endpoint that the browser connects to, for example:

- `GET /admin/api/chat/ws?agentType=platform|site&siteName=<optional>&threadLocalId=<optional>`

Constraints:

- `agentType` + `siteName` must be validated/authorized for the current user/site.
- `threadLocalId` is optional and should be treated as a hint only (the DO should still verify that the local thread belongs to the authenticated user).
- Authentication should be cookie/session based (or a short-lived first-party JWT). Do not accept Ragwalla API keys or Ragwalla WS tokens from the client.

In `perspect-react-admin`, the client builds this URL as:

- `wss://<host>/admin/api/chat/ws?agentType=<platform|site>&siteName=<optional>&threadLocalId=<optional>`

### Durable Object routing (stickiness)
Route each incoming client connection to a deterministic DO instance so state is sticky:

- DO id key: `${userId}:${agentId}` (or `${orgId}:${userId}:${agentId}` if multi-tenant)

Rationale:

- preserves upstream connection and thread context per user+agent
- enables per-user rate limiting and plan enforcement

### DO lifecycle (authoritative flow)
1. Worker receives the upgrade request and forwards it to the DO instance for `${userId}:${agentId}`.
2. DO accepts the client WebSocket.
3. DO resolves the Ragwalla thread:
   - look up existing mapping `user_id + agent_id → thread_id`
   - if missing, create a thread via REST and persist the mapping
4. DO mints a short-lived Ragwalla WS token server-side via `client.agents.getToken`.
5. DO opens the upstream WebSocket to Ragwalla using the minted token and the resolved `thread_id`.
6. DO relays frames bidirectionally and maintains:
   - per-connection state (open/closed, last activity)
   - per-user usage counters (messages/tokens)
   - correlation identifiers for logging

### Client → DO message schema
Use newline-delimited JSON frames (one JSON object per WS message). Suggested minimal contract:

- `{"type":"message","role":"user","content":"...","metadata":{...}}`
- `{"type":"set_continuation_mode","mode":"auto"|"manual"}`
- `{"type":"continue_run","runId":"..."}`
- `{"type":"cancel_run","runId":"..."}` — abort the active run (or a specific run by ID); server responds with a `run_cancelled` frame
- `{"type":"ping"}` (optional; you can also rely on WS ping/pong where available)

Rules:

- Reject frames without a valid `type`.
- Enforce maximum payload size.
- Treat `metadata` as untrusted; only allow a small allowlist of client-provided keys (or drop it entirely).

### DO → client message schema
The DO should forward upstream Ragwalla messages as-is (JSON objects with `type`) to minimize UI coupling.

Additionally, reserve a DO-local error shape for policy/auth failures:

- `{"type":"error","code":"policy_violation"|"unauthorized"|"rate_limited"|"upstream_error","error":"human readable"}`

The upstream `run_cancelled` frame (`{"type":"run_cancelled","runId":"..."}`) should also be forwarded to the client so the UI can confirm cancellation.

If you forward upstream `error` frames too, keep them distinct from DO-local errors via `code` naming.

### Upstream connection (DO → Ragwalla)
The DO is responsible for:

- choosing the correct Ragwalla base URL `https://<tenant>.ai.ragwalla.com/v1` (upstream WS will be `wss://.../v1/...`)
- minting the Ragwalla WS token server-side (`agents.getToken`)
- opening the upstream WS with `thread_id` and continuation mode

Notes:

- Keep Ragwalla token TTL short (for example 5–15 minutes) and re-mint on reconnect.
- If you support reconnect, reconnect upstream first, then resume relaying.

### Per-message enforcement (DO relay responsibilities)
Before forwarding any client frame upstream:

- **Authentication**: ensure the client session is still valid.
- **Rate limiting**: per-user message rate and/or concurrent connections.
- **Plan caps**: enforce plan-based allowances (message count, token budget, tool-call allowance).
- **Tool/skill allowlist**: if client is allowed to send frames that influence tool execution, block disallowed requests.
- **Metadata injection**: overwrite/add trusted metadata on outbound frames, for example:
  - `userId`
  - `orgId` / `projectId`
  - `siteId` / `siteName`
  - `origin` / `surface`

### Thread persistence
Persist the thread mapping so the same user+agent resumes context across sessions.

Minimal table shape:
```sql
CREATE TABLE chat_threads (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  thread_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(user_id, agent_id)
);
```

### perspect-react-admin thread behavior (local thread vs Ragwalla thread)
`perspect-react-admin` maintains a local thread record (in your DB) and links it to a Ragwalla `thread_id` when the agent/DO creates one.

Key concepts:

- **Local thread id**: numeric id used in routes like `/admin/chat/:threadId`.
- **Ragwalla thread id**: string id (`thread_id`) emitted by the agent WS and used for history and context.
- **WS connection is per agent context**: the UI keeps one WS connection open per `(agentType, siteName)` and switches threads by sending control frames.

Local thread lifecycle:

1) **Thread list**
- UI fetches threads via `GET /chat/threads?agentType=...&siteName=...`.

2) **Create thread (local)**
- Clicking “New Thread” (or landing on `/admin/chat` with no thread id) calls `POST /chat/threads`.
- Server creates a local thread record with:
  - `title: null`
  - `thread_id: null` (not yet linked)
  - `agent_type` + optional `site_name`
- UI navigates to `/admin/chat/<localId>`.

3) **On connect, hydrate the selected thread**
- When the WS connects, the UI:
  - re-fetches local thread list
  - finds the selected local thread
  - if `thread.thread_id` exists, sends `{"type":"load_thread_history","threadId":"<ragwallaThreadId>"}`
  - otherwise sends `{"type":"create_new_thread"}`

4) **Link local thread to Ragwalla thread**
- When the upstream/DO emits `thread_info` (or `threadInfo`) containing `threadId`/`thread_id`, the UI persists the link:
  - `POST /chat/threads/:localId` with action `link_ragwalla` and `ragwalla_thread_id`
- The sidebar is updated optimistically via a browser event.

5) **Title naming rule (first user message wins)**
- The UI assigns a title on the first user message sent in a thread:
  - `title = firstMessageText` truncated to ~60 chars
  - persisted with `POST /chat/threads/:localId` action `rename`

6) **History hydration**
- For thread history, the UI primarily relies on the WS response:
  - client sends `load_thread_history`
  - DO forwards to upstream
  - upstream responds with `thread_history`/`threadHistory` including an array of messages
- The UI converts message `content` (string or content parts) into display text and replaces the current message list.

Implementation implication for the DO:

- Support the control frames `load_thread_history` and `create_new_thread`.
- Ensure `thread_info` is emitted after creating a new Ragwalla thread so the UI can link and persist `thread_id`.
- Forward `thread_history` frames so the UI can hydrate without needing a separate REST call.

### Disconnects, close codes, and cleanup
- If the client WS closes:
  - close upstream
  - flush any pending logs/metering
  - clear in-memory state for that connection
- If upstream closes unexpectedly:
  - optionally attempt reconnect with a fresh token
  - if reconnect fails, send a DO-local `error` frame and close the client with an appropriate code
- Use `1008` (policy violation) when rejecting due to plan/policy.

### Observability and billing hooks
On each relayed message/event, log:

- user id
- agent id
- thread id
- connection id
- message id / run id when present
- bytes in/out
- token usage frames (if provided upstream)

This enables audits and accurate plan metering even when the UI is untrusted.

## Agent provisioning (clawery reference implementation)
Clawery provisions agents asynchronously via a Cloudflare Queue. The UI calls `POST /api/agents/create`, which inserts a local `agents` row with `status: "provisioning"` and enqueues a message. A queue consumer (`workers/app.ts`) processes each message by calling the SDK.

### Why async
Provisioning a main agent requires multiple sequential SDK calls (create assistant, create agent, attach tool, enable ~30 system skills, wire delegation). The total latency is typically several seconds and can exceed request timeouts under load. Running this in a queue consumer avoids blocking the user's HTTP request and allows automatic retries on transient failures.

The create endpoint returns immediately with the local agent record (`status: "provisioning"`). The client should poll (e.g., `GET /api/agents` or a per-agent status endpoint) or listen for a push event until `status` transitions to `"active"` or `"error"`. In clawery the agent list page polls on a short interval and surfaces a spinner for agents still provisioning.

### Agent types and what gets created

**Main agent** (5-step sequence):
1. **Create assistant** — `client.assistants.create(...)` with `code_interpreter` + `file_search` tools and embedding settings. The assistant ID is saved to D1 immediately for idempotent retries.
2. **Create agent** — `client.agents.create(...)` with `agentType: "primary"`, memory extraction enabled, and generated instructions.
3. **Attach assistant as tool** — `client.agents.attachTool(agentId, { type: "assistant", assistantId, ... })`. The tool name is derived from the agent name (kebab-cased + `_ast` suffix).
4. **Enable system skills** (bulk) — `client.agents.enableSystemSkillsBulk(agentId, [...])` enables ~30 system skills covering memory, workspace files, scheduling, skill creation, AI capabilities, events, channels, and MCP server management.
5. **Wire delegation** — grant delegation permission from this main agent to every existing orchestrator in the org via `client.agents.grantDelegationPermission(mainAgentId, orchestratorAgentId, orchestratorName)`.

After step 5, if the org has no orchestrator yet, provisioning auto-creates a companion orchestrator (quota permitting) by enqueuing a second provisioning message.

**Orchestrator** (execution-only, no assistant):
1. **Create agent** — `client.agents.create(...)` with `agentType: "orchestrator"` and `executionMode: "execution-only"`. No assistant, no system skills.
2. **Wire delegation** — grant delegation permission from every existing main agent in the org to this new orchestrator.

**Sub-agent** (minimal):
1. **Create agent** — `client.agents.create(...)` with `agentType: "subagent"`. No assistant, no system skills, no delegation wiring.

### Idempotent retries
Each provisioning step saves progress to D1 (`ragwalla_assistant_id`, `ragwalla_agent_id`) immediately after the SDK call succeeds. On retry, the consumer checks for prior progress and skips already-completed steps. The queue consumer acks 4xx errors permanently and retries 5xx/network errors.

### Deletion
Deletion is also queue-based. The consumer:
1. Deletes the Ragwalla agent (`client.agents.delete`)
2. Deletes the Ragwalla assistant (`client.assistants.delete`) — only for main agents
3. Deletes the local D1 row

Both delete calls tolerate 404 (already deleted).

### Instructions generation
All agent types receive generated instructions via `buildOpenClawAdaptedInstructions`. The instructions include:
- agent profile (name, role label, mission)
- operating style, tooling rules, system skill naming conventions
- workspace files vs memory guidance
- type-specific sections: delegation instructions (main), orchestration instructions (orchestrator), or sub-agent focus rules (sub)

Main agents' assistants get a variant with `forAssistant: true`, which sets the role label to "assistant tool".

### Local data model
```sql
CREATE TABLE agents (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  name                  TEXT NOT NULL,
  description           TEXT,
  agent_type            TEXT NOT NULL,  -- 'main' | 'sub' | 'orchestrator'
  status                TEXT NOT NULL,  -- 'provisioning' | 'active' | 'error' | 'deleting'
  error_message         TEXT,
  ragwalla_agent_id     TEXT,           -- set during provisioning
  ragwalla_assistant_id TEXT,           -- main agents only
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
```

## Practical sequence for a new app
1) Configure client (API key + baseURL).
2) List orgs; pick one. Create a project (if needed).
3) Create/configure an agent; attach skills/system skills.
4) Create a thread (optionally seed messages).
5) For REST: POST `/threads/{id}/messages`, read via `/threads/{id}/messages`.
6) For conversational UX: connect the UI to your WebSocket endpoint, then have the DO proxy frames upstream while enforcing auth/plan/policy.
7) (Optional) Provision endpoints if you need dispatch scripts.

## Notes & gotchas
- Base URL validation is strict; include `/v1` and use the tenant domain.
- WebSocket payloads must have `content`/`role` at the top level.
- Thread creation with org-level keys requires `project_id` in body.
- Endpoint creation is async; poll until `status: 'active'`.
- `debug: true` logs HTTP/WS events for troubleshooting.

## MCP Servers
Register, configure, and connect MCP (Model Context Protocol) servers so agents can invoke their tools.

### CRUD operations
```ts
// Create an MCP server (HTTP transport, no auth)
const server = await client.mcpServers.create({
  name: 'My Tools Server',
  description: 'Internal tooling API',
  url: 'https://tools.example.com/mcp',
  transport_type: 'http',
  // project_id: 'proj_xxx',  // required for org-level API keys
});

// List servers in the project
const { servers } = await client.mcpServers.list();

// Retrieve / update / delete
const s = await client.mcpServers.retrieve(server.id);
await client.mcpServers.update(server.id, { description: 'Updated' });
await client.mcpServers.delete(server.id);
```

### Test before saving
Validate connectivity without persisting:
```ts
const test = await client.mcpServers.test({
  name: 'My Tools Server',
  url: 'https://tools.example.com/mcp',
  transport_type: 'http',
});
// test.success, test.tools, test.serverInfo, test.validation
```

### Discover tools
Connect to the server and list its available tools. Results are cached for 1 hour.
```ts
const { tools, server_info } = await client.mcpServers.discoverTools(server.id);
// tools: Array<{ name, title?, description?, inputSchema? }>
// server_info: { name, version, protocolVersion, capabilities }
```

### Grant agent access
Link a server's tools to an agent. The agent will be able to call the server's tools on subsequent runs.
```ts
// Grant access
await client.mcpServers.grantAgentAccess(server.id, {
  agent_id: agent.id,
  enabled: true,
});

// List which agents have access
const { access } = await client.mcpServers.listAgentAccess(server.id);

// Revoke access
await client.mcpServers.grantAgentAccess(server.id, {
  agent_id: agent.id,
  enabled: false,
});
```

### Refresh tools
After granting access, refresh the agent so it picks up the MCP tool definitions:
```ts
await client.agents.refreshTools(agent.id);
```
This syncs the latest tool schemas from every MCP server the agent has access to and clears the agent's cached state.

### Authentication types
Set `auth_type` and `auth_config` when creating or updating a server.

**No auth** (default):
```ts
{ auth_type: 'none' }
```

**Bearer token**:
```ts
{
  auth_type: 'bearer',
  auth_config: { token: 'sk-...' }
}
```

**API key**:
```ts
{
  auth_type: 'api_key',
  auth_config: { apiKey: 'key_...' }
}
```

**OAuth 2.0**:
```ts
{
  auth_type: 'oauth2',
  auth_config: {
    flow: 'authorization_code',   // or 'client_credentials', 'mcp_native'
    authUrl: 'https://provider.com/authorize',
    tokenUrl: 'https://provider.com/token',
    clientId: 'client_xxx',
    clientSecret: 'secret_xxx',   // encrypted at rest
    scopes: ['read', 'write'],
    redirectUri: 'https://yourapp.com/oauth/mcp/callback',
  }
}
```
Secrets (`token`, `apiKey`, `clientSecret`) are encrypted server-side and never returned in API responses.

### OAuth lifecycle
For `oauth2` servers, the `auth_status` field tracks connection state: `pending` → `connected` or `error`.

```ts
// Start the OAuth flow (returns a URL to open in the browser)
const { auth_url, state } = await client.mcpServers.startOAuth(server.id, 'https://yourapp.com/oauth/mcp/callback');

// Poll until the user completes authorization
const { auth_status } = await client.mcpServers.oauthStatus(server.id);

// Refresh an expired access token
await client.mcpServers.refreshOAuth(server.id);

// Revoke OAuth credentials
await client.mcpServers.revokeOAuth(server.id);
```

### End-to-end: add an MCP server and wire it to an agent
```ts
// 1. Create the server
const server = await client.mcpServers.create({
  name: 'CRM Tools',
  url: 'https://crm.example.com/mcp',
  transport_type: 'http',
  auth_type: 'bearer',
  auth_config: { token: process.env.CRM_MCP_TOKEN! },
});

// 2. Discover its tools (also caches them)
const { tools } = await client.mcpServers.discoverTools(server.id);
console.log('Available tools:', tools.map(t => t.name));

// 3. Grant the agent access
await client.mcpServers.grantAgentAccess(server.id, {
  agent_id: agent.id,
  enabled: true,
});

// 4. Refresh the agent's tool set
await client.agents.refreshTools(agent.id);

// The agent can now call tools from the CRM MCP server during conversations.
```

## Thread events
Tell a conversation that something happened outside it: a deploy finished, a payment cleared, an import failed. Typically a tool starts slow work, records the conversation (`X-Origin-Thread-ID ?? X-Thread-ID`), and your backend posts the event when the work settles.

```ts
await ragwalla.threads.events.create(threadId, {
  type: 'deployment.completed',
  summary: 'Build 14 is live at https://acme.example',   // what the agent reads
  data: { buildId: 'b14', url: 'https://acme.example' },  // for your clients only
  visibility: 'both',                                     // 'client' (default) | 'agent' | 'both'
  idempotency_key: 'build_14:completed',                  // safe to retry
});
```

- **Clients** (`client`, `both`): delivered live to the sockets open on the thread as a `threadEvent`, and included in `thread_history` for sockets connected with `includeEvents: true` (rows with `rowKind: 'thread_event'`, `content` = summary, `event` = `{ type, visibility, data }`). A live event's `messageId` equals its history row id; an event can arrive more than once (a replay, or a socket that was reconnecting), so dedupe by `messageId`.
  ```ts
  const ws = new RagwallaWebSocket({ baseURL, includeEvents: true });
  ws.on('threadEvent', ({ threadId, messageId, event }) => {
    if (event.type === 'deployment.completed') reloadPreview((event.data as { url: string }).url);
  });
  ```
- **Agent** (`agent`, `both`): part of the agent's context from its next turn, as `[Event: <type>] <summary>`. `summary` is required for these; `data` never reaches the model. Recording an event does not start a turn.
- **Requirements:** the thread must name an active, enabled agent in its project (`metadata.agent_id`, fixed once set). With an `idempotency_key`, a replay returns the recorded event with 200 and writes nothing — but delivers to clients again.

## Outbound webhooks

Ragwalla pushes real-time events to your HTTPS endpoint via outbound webhooks. Use them for LLM usage metering, channel activity tracking, and integration with external systems.

### Setup

Register a webhook via the dashboard or REST API:

```ts
const response = await fetch(
  `https://<tenant>.ai.ragwalla.com/v1/organizations/${orgId}/webhooks`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'My app sync',
      endpoint_url: 'https://yourapp.com/api/webhooks/ragwalla',
      event_subscriptions: ['*'],  // or specific patterns like ['llm.*', 'channel.message_sent']
      auto_generate_secret: true,
    }),
  }
);
const { secret } = await response.json();
// Store `secret` — it is shown only once. Use it to verify HMAC-SHA256 signatures.
```

### Subscription patterns

Patterns use glob-style matching:

| Pattern | Matches |
|---|---|
| `*` | All events |
| `llm.*` | All LLM events |
| `channel.*` | All channel events |
| `llm.run_usage` | Only run usage summaries |
| `channel.message_received` | Only inbound channel messages |

### Verifying signatures

Every delivery includes an `X-Webhook-Signature` header (if a secret is configured). Verify it with HMAC-SHA256:

```ts
app.post('/api/webhooks/ragwalla', async (req, res) => {
  const signature = req.headers['x-webhook-signature'] as string;
  const body = JSON.stringify(req.body);
  const expected = 'sha256=' + crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).send('Invalid signature');
  }

  // Process event...
  res.status(200).send('ok');
});
```

### Envelope format

All events share a common envelope:

```json
{
  "id": "evt_abc123def456",
  "type": "llm.run_usage",
  "organization_id": "org_xxx",
  "project_id": "proj_xxx",
  "agent_id": "agent_xxx",
  "timestamp": 1711000000,
  "data": { ... }
}
```

Headers on each delivery:
- `Content-Type: application/json`
- `X-Webhook-Event: <event type>`
- `X-Webhook-Delivery-Id: wdl_xxx`
- `X-Webhook-Timestamp: <unix timestamp>`
- `X-Webhook-Signature: sha256=<hex>` (if secret configured)

### Event reference

#### `llm.run_usage`

Emitted when an agent run completes (or fails). Contains aggregated token totals across all LLM calls in the run.

```json
{
  "data": {
    "source": "interactive",
    "status": "completed",
    "input_tokens": 4200,
    "output_tokens": 1350,
    "total_tokens": 5550,
    "llm_call_count": 3,
    "models": ["gpt-4o"],
    "thread_id": "thread_xxx",
    "run_id": "run_xxx",
    "channel_type": "telegram",
    "task_name": "daily_check"
  }
}
```

| Field | Presence | Description |
|---|---|---|
| `source` | Always | `interactive`, `channel`, `cron`, or `heartbeat` |
| `status` | Always | `completed` or `failed` |
| `input_tokens` | Always | Total prompt tokens across all LLM calls |
| `output_tokens` | Always | Total completion tokens across all LLM calls |
| `total_tokens` | Always | `input_tokens + output_tokens` |
| `llm_call_count` | Always | Number of LLM calls (1 for simple responses, more for tool loops) |
| `models` | Always | Array of distinct model names used |
| `thread_id` | When available | Present for interactive/channel/cron (with tools); absent for heartbeat and tool-less cron |
| `run_id` | Interactive only | Only the interactive WS path creates run objects |
| `channel_type` | Channel only | `telegram`, `whatsapp`, `slack`, `discord`, `teams`, `gmail`, `webhook` |
| `task_name` | Cron only | The scheduled task's tool name |

#### `channel.thread_created`

Emitted when a new conversation thread is created for a channel session.

```json
{
  "data": {
    "thread_id": "thread_xxx",
    "agent_id": "agent_xxx",
    "channel_type": "telegram",
    "channel_config_id": "ch_xxx",
    "session_key": "telegram:agent_xxx:sender:12345",
    "sender_id": "12345",
    "sender_name": "Alice"
  }
}
```

#### `channel.message_received`

Emitted when a user sends a message to an agent via a channel.

```json
{
  "data": {
    "thread_id": "thread_xxx",
    "message_id": "msg_xxx",
    "agent_id": "agent_xxx",
    "channel_type": "telegram",
    "sender_id": "12345",
    "sender_name": "Alice",
    "text": "Hello, can you help?"
  }
}
```

#### `channel.message_sent`

Emitted when the agent sends a response back to the user via a channel.

```json
{
  "data": {
    "thread_id": "thread_xxx",
    "message_id": "msg_xxx",
    "agent_id": "agent_xxx",
    "channel_type": "telegram",
    "text": "Sure! How can I help you today?"
  }
}
```

#### `channel.conversation_reset`

Emitted when a user sends the `/new` command to start a fresh conversation.

```json
{
  "data": {
    "thread_id": "thread_xxx",
    "new_thread_id": "thread_yyy",
    "agent_id": "agent_xxx",
    "channel_type": "telegram",
    "sender_id": "12345"
  }
}
```

### Delivery guarantees

- Delivered asynchronously via Cloudflare Queues (never blocks agent execution).
- Configurable retries: 0–10 attempts with exponential backoff (default: 3 retries, 1s base).
- HTTP status < 300 is success; anything else triggers a retry.
- Full delivery history (status, attempts, response) visible in the dashboard.

### LLM usage metering for client apps

Client apps that need per-user or per-org billing should subscribe to `llm.run_usage` and aggregate by their own user mapping:

- **Interactive sessions**: Your proxy DO knows which user owns the WebSocket connection. Map `thread_id` → your user via the `chat_threads` table described in the WebSocket proxy section.
- **Channel sessions**: `thread_id` is scoped per sender/channel/session. Map it via the channel's session key convention (`{channelType}:{agentId}:sender:{senderId}`).
- **Cron/heartbeat**: Agent-level operations, not user-initiated. Attribute to the agent's owner or the org.

## Passing custom metadata to MCP servers (HTTP headers)
When an agent calls an MCP server, the platform automatically forwards context as HTTP headers. To send your own metadata through to the MCP server, include a `metadata` object on the user message. That metadata will be serialized and attached as `X-Message-Metadata` on every MCP request.

**How it flows**
1) Send a message with `metadata`:
```ts
await ragwalla.threads.messages.create({
  thread_id: threadId,
  role: 'user',
  content: 'Summarize the customer record',
  metadata: { customerId: 'cust_123', surface: 'crm' }
});
```

2) When the agent triggers an MCP tool, the MCP HTTP transport adds these headers (see `tool-execution-service` and MCP HTTP transport):
- `X-Message-Metadata: <JSON string of your metadata>` — the metadata of the message the run answers (not a later message on the same thread). A run that serves no message (for example a continuation after a sub-agent result) sends none.
- `X-User-ID`, `X-Project-ID`, `X-Thread-ID`, `X-Agent-ID`, `X-Run-ID` (execution context: the thread and run actually executing the tool)

When the tool is called by a spawned or delegated **sub-agent**, its `X-Thread-ID` is the sub-agent's own thread, so these identify the conversation turn the work serves:
- `X-Message-Metadata`: the originating message's metadata, forwarded unchanged through nested sub-agents
- `X-Origin-Thread-ID`, `X-Origin-Run-ID`: the conversation thread and run that started the work
- `X-Parent-Agent-ID`, `X-Parent-Run-ID`: the agent and run that started this sub-agent

A call made by the turn's own agent has no `X-Origin-*` headers: its `X-Thread-ID` and `X-Run-ID` already are the origin. Use `X-Origin-Thread-ID ?? X-Thread-ID` as "the conversation this work belongs to", for example to post a thread event when slow work started by the tool finishes (see Thread events).

3) In your MCP server, read and parse the header:
```ts
const metaHeader = request.headers.get('X-Message-Metadata');
const metadata = metaHeader ? JSON.parse(metaHeader) : {};
const customerId = metadata.customerId as string | undefined;
```

Notes:
- Keep metadata JSON-serializable and reasonably small (it is sent in headers).
- The same mechanism works for SSE/HTTP MCP servers; headers are merged with auth headers.
