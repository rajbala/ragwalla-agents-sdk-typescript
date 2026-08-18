# Reconnect & Resume — Client Guide

How a chat client recovers an **in-flight streamed response** after a dropped WebSocket —
using the Ragwalla Agents SDK, or a raw WebSocket for non-TypeScript clients.

## Why this exists

When an agent is streaming a reply and the socket drops — a network blip, a backgrounded
tab, a laptop sleeping, or the server's Durable Object hibernating — the client must, on
reconnect:

1. get the conversation **history**,
2. learn the run's **current status**,
3. recover the **partial text** already streamed for the message that was in flight, and
4. **continue** receiving the rest live,

…in that order, with no duplicated or missing text. The server guarantees the ordering and
the content. The client's only jobs are to **send the right reconnect parameters** and
**render the frames correctly**.

## The one rule that matters most

> **`resume` carries the _full current text_ of the in-flight message — a snapshot, not a
> delta.** On `resume`, **replace** the message bubble's body with `resume.content`, then
> **append** every subsequent `chunk`. If you append `resume.content` instead of replacing
> it, you will duplicate the prefix the user already saw.

---

## Part A — With the SDK

### Connect

```ts
import { Ragwalla } from '@ragwalla/agents-sdk';

const ragwalla = new Ragwalla({ apiKey, baseURL: 'https://<sub>.ai.ragwalla.com/v1' });
const { token } = await ragwalla.agents.getToken({ agent_id: agent.id, expires_in: 3600 });

const ws = ragwalla.createWebSocket({
  continuationMode: 'auto',
  reconnectAttempts: 5,   // automatic reconnection
  reconnectDelay: 1000,
  // Optional for Durable Object proxies: mint a fresh short-lived token before
  // SDK-driven reconnects instead of reusing the original connect() token.
  getReconnectToken: async ({ agentId }) => {
    const { token } = await ragwalla.agents.getToken({ agent_id: agentId, expires_in: 300 });
    return token;
  },
});

// Pass an existing thread id to resume that conversation; omit it for a new thread.
await ws.connect(agent.id, 'main', token, threadId);
```

Reconnection is **automatic**. On a drop, the SDK reconnects and **re-sends `thread_id` and
`resume_message_id` for you** — you never build those yourself.

If you are writing a proxy, keep the browser data plane raw:

```ts
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

await ws.sendAsync(clientFrame); // reconnects first, or rejects before you accept the send
```

`rawFrame` and its alias `frame` fire for every inbound Ragwalla frame before SDK
normalization, including known frame types and future upstream additions. SDK event
listener exceptions are caught and logged, so relay failures must be handled inside the
listener instead of relying on thrown errors for proxy control flow.

For complete copy/paste proxy examples, see [proxy-support.md](proxy-support.md).

### Handle the streaming + resume events

```ts
// the in-flight assistant bubble you're rendering
let bubble = { id: null as string | null, text: '' };

ws.on('messageCreated', ({ messageId }) => { bubble = { id: messageId, text: '' }; });

ws.on('chunk', ({ messageId, content }) => {
  if (messageId === bubble.id) { bubble.text += content; render(bubble); }
});

ws.on('complete', ({ messageId }) => { finalize(bubble); });

// ---- reconnect recovery ----

ws.on('threadHistory', ({ messages }) => renderHistory(messages)); // durable, completed turns

ws.on('runState', ({ runId, runStatus, activeTool }) => {
  setTypingIndicator(runStatus);   // active vs terminal; activeTool is null in v1
});

ws.on('resume', ({ messageId, content }) => {
  bubble = { id: messageId, text: content };  // REPLACE — do not append
  render(bubble);                             // subsequent chunks append from here
});
```

Under the hood, on every connection the SDK:

- persists the thread id from the `connected` frame **and** from `thread_info` — so even a
  drop during the *very first* streamed reply still carries `thread_id` on reconnect;
- tracks the in-flight message id from `message_created` (and from `chunk` as a fallback if
  `message_created` was missed);
- **clears** it on `complete`, `run_cancelled`, or a **terminal** `run_state`, so a later
  reconnect never tries to resume a finished message;
- sends `resume_message_id` **only** alongside `thread_id`.

### The order you'll observe on reconnect

```
connected → threadInfo → threadHistory → runState → messageCreated* → resume* → chunk… → complete
```

`*` only when a run was in flight. A thread with **no** active run reconnects with just
history (no `runState`/`resume`, no ghost bubble).

### `runState` is the single reconnect-status event

An earlier `runResumed` event has been **removed**. `runState` is now the one event for
the run's status on reconnect — it carries `runId`, `runStatus` (any `RunStatus`, including
terminal), and `activeTool`. If you previously listened for `runResumed`, listen for
`runState` instead.

---

## Part B — Without the SDK (raw WebSocket)

For browser JS, Python, Go, or any non-TypeScript client. The SDK is a thin convenience
layer over this protocol — anything it does, you can do directly.

### 1. Get a token and connect

Fetch a short-lived WebSocket token from the REST API (the same call the SDK's `getToken()`
makes), then open:

```
wss://<subdomain>.ai.ragwalla.com/v1/agents/<agentId>/<connectionId>
    ?token=<token>
    &continuation_mode=auto
    [&thread_id=<threadId>]
    [&resume_message_id=<messageId>]
```

- `connectionId` — any stable per-connection identifier (e.g. `main`).
- `thread_id` — include to attach to an existing thread (**required** for resume).
- `resume_message_id` — include **only** on a reconnect where you hold an in-flight message
  id (see §4).

The server authenticates the connection and derives the project/agent context from `token`;
you do not send auth headers from a browser.

### 2. Frames the server sends

All frames are JSON with a `type` field.

| `type` | payload | when |
|---|---|---|
| `connected` | `agentId, authenticated, currentThreadId?, activeRunId?, activeRunStatus?` | on open |
| `thread_info` | `threadId, createdAt` | after open, when on a thread |
| `thread_history` | `threadId, messages[], messageCount, latestRun` | right after `thread_info`, and on connect when the dial URL carried a valid `thread_id` |
| `run_state` | `runId, runStatus, activeTool` | on reconnect, when a run is/was active |
| `message_created` | `messageId, role?` | a new assistant message begins |
| `chunk` | `messageId, content` | a streamed text delta |
| `resume` | `messageId, content` | on reconnect: the in-flight message's **full current text** |
| `complete` | `messageId` | the message is finished |
| `typing` / `status` / `run_paused` / `run_cancelled` / `error` | — | progress & lifecycle |

> The server never emits a `heartbeat` frame — an earlier version of this table listed one. Keepalive is
> client-initiated `{"type":"ping"}`; send that exact literal and the runtime auto-answers `{"type":"pong"}`
> without waking the Durable Object. Any extra field routes it to the slow path instead.

To start a run, send a user message:

```json
{ "type": "message", "content": "…", "role": "user", "timestamp": "<ISO-8601>" }
```

### 3. Client state you must track

- **in-flight `messageId`** — set it from `message_created.messageId`; fall back to
  `chunk.messageId` if you joined mid-stream and missed `message_created`. **Clear** it on
  `complete`, on `run_cancelled`, and on any `run_state` whose `runStatus` is terminal.
- **`threadId`** — set it from `connected.currentThreadId` **and** from `thread_info.threadId`
  (plus whatever you connected with). You need it to reconnect.

### 4. Reconnecting

On an unexpected close, reconnect to the same URL and:

- **always** include `thread_id` (the thread you were on);
- include `resume_message_id` **only if** you currently hold an in-flight message id.

> **Invariant — never send `resume_message_id` without `thread_id`.** The server's resume
> lookup is thread-scoped; an unscoped `resume_message_id` is silently ignored and you get no
> resume. If you don't yet know the thread, reconnect with `thread_id` only and rely on
> `thread_history` + the server recovering the active run by id (see §7).

### 5. Render order and rules (load-bearing)

On reconnect the server emits, in exactly this order:

```
thread_info → thread_history → run_state → message_created → resume → live chunk…
```

- `thread_history` contains only **completed** turns. The in-flight (partial) message is
  **not** in history — it returns via `resume`.
- On `resume`: **replace** the in-flight bubble's text with `content` (the full snapshot),
  then **append** each following `chunk`. Never append `resume.content`.
- `run_state.runStatus` tells you whether to show an active/“typing” affordance. If it is
  terminal, the run finished while you were away: `resume` (if present) carries the final
  text and no further `chunk`s will arrive.

### 6. Run status model

`runStatus` is one of nine values:

- **active** — `queued`, `in_progress`, `requires_action`, `cancelling`
- **terminal** — `completed`, `cancelled`, `failed`, `incomplete`, `expired`

Treat any value not in the active set as terminal: clear the in-flight id and stop expecting
chunks.

### 7. Edge cases

- **Cold resume (server hibernated).** The in-flight text is recovered from the last durable
  flush, so `resume.content` may trail the absolute latest byte by a little; live `chunk`s
  continue from the current position. Still replace-then-append — it reconciles.
- **No active run.** Reconnect yields `thread_history` only (no `run_state`/`resume`) —
  nothing was streaming.
- **Dropped before `message_created`.** You have no `resume_message_id` to send, so reconnect
  with `thread_id` only. The server recovers the active run's in-flight message by run id and
  still sends `message_created` + `resume`.
- **Stale `resume_message_id` from a previous run.** Harmless — the server ignores a resume id
  that doesn't belong to the thread's current in-flight message and resumes the right one.

### 8. Minimal browser example

```js
const SUB = '<subdomain>', AGENT = '<agentId>', TOKEN = '<token>';
const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'incomplete', 'expired']);

let threadId = KNOWN_THREAD_ID ?? null;   // null for a brand-new thread
let inflightId = null;
let bubble = { id: null, text: '' };

function url() {
  const p = new URLSearchParams({ token: TOKEN, continuation_mode: 'auto' });
  if (threadId) p.set('thread_id', threadId);
  if (inflightId && threadId) p.set('resume_message_id', inflightId); // never without thread_id
  return `wss://${SUB}.ai.ragwalla.com/v1/agents/${AGENT}/main?${p}`;
}

function connect() {
  const ws = new WebSocket(url());

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    switch (m.type) {
      case 'connected':       if (m.currentThreadId) threadId = m.currentThreadId; break;
      case 'thread_info':     if (m.threadId) threadId = m.threadId; break;
      case 'thread_history':  renderHistory(m.messages); break;
      case 'message_created': inflightId = m.messageId; bubble = { id: m.messageId, text: '' }; break;
      case 'chunk':
        inflightId = m.messageId;
        if (m.messageId === bubble.id) { bubble.text += m.content; render(bubble); }
        break;
      case 'resume':          bubble = { id: m.messageId, text: m.content }; render(bubble); break; // REPLACE
      case 'run_state':       if (TERMINAL.has(m.runStatus)) inflightId = null; break;
      case 'complete':        inflightId = null; break;
      case 'run_cancelled':   inflightId = null; break;
    }
  };

  // Reconnect on an unclean close. url() automatically carries thread_id + resume_message_id.
  ws.onclose = (ev) => { if (!ev.wasClean) setTimeout(connect, 1000); };
  return ws;
}

connect();
```

---

## Quick reference

- **Resume is a full snapshot** → on `resume`, replace the bubble text, then append chunks.
- **`resume_message_id` requires `thread_id`** → never send it alone (it would be ignored).
- **Reconnect order** → history → `run_state` → `message_created` → `resume` → live chunks.
- **Clear the in-flight id** → on `complete`, `run_cancelled`, or a terminal `run_state`.
- **SDK** → listen for `resume` + `runState` (the single reconnect-status event);
  reconnect parameters are automatic.
