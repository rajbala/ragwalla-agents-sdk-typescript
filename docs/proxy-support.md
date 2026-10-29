# WebSocket Proxy Support - Copy/Paste Examples

Use these examples when your browser connects to your own server or Cloudflare Worker, and
that server connects upstream to Ragwalla with the SDK.

The proxy path should be:

1. Browser sends Ragwalla frames to your proxy.
2. Proxy sends those frames upstream with `sendAsync()` or `sendMessageAsync()`.
3. Proxy relays upstream `rawFrame` frames back to the browser unchanged.

Do not rebuild typed SDK events into browser frames. `rawFrame` preserves every upstream
frame shape, including future frame types.

## Cloudflare Worker WebSocket Proxy

```ts
import { Ragwalla } from '@ragwalla/agents-sdk/workers';

interface Env {
  RAGWALLA_API_KEY: string;
  RAGWALLA_AGENT_ID: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendJson(socket: WebSocket, value: unknown): void {
  socket.send(JSON.stringify(value));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const url = new URL(request.url);
    const agentId = url.searchParams.get('agentId') ?? env.RAGWALLA_AGENT_ID;
    const threadId = url.searchParams.get('threadId') ?? undefined;
    const connectionId = url.searchParams.get('connectionId') ?? crypto.randomUUID();

    const pair = new WebSocketPair();
    const [clientSocket, browserSocket] = Object.values(pair) as [WebSocket, WebSocket];
    browserSocket.accept();

    const ragwalla = new Ragwalla({
      apiKey: env.RAGWALLA_API_KEY,
    });

    const upstream = ragwalla.createWebSocket({
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      getReconnectToken: async ({ agentId }) => {
        const { token } = await ragwalla.agents.getToken({
          agent_id: agentId,
          expires_in: 300,
        });
        return token;
      },
    });

    let browserOpen = true;

    const closeBoth = (code = 1011, reason = 'Proxy closed') => {
      browserOpen = false;
      upstream.disconnect();
      try {
        browserSocket.close(code, reason);
      } catch {
        // Socket may already be closed.
      }
    };

    upstream.on('rawFrame', (frame: unknown) => {
      if (!browserOpen) return;
      try {
        sendJson(browserSocket, frame);
      } catch (error) {
        console.error('Browser relay failed', error);
        closeBoth(1011, 'Browser relay failed');
      }
    });

    upstream.on('reconnectFailed', () => {
      if (browserOpen) {
        sendJson(browserSocket, { type: 'error', error: 'ragwalla_reconnect_failed' });
      }
      closeBoth(1011, 'Ragwalla reconnect failed');
    });

    upstream.on('error', (event: unknown) => {
      if (browserOpen) {
        sendJson(browserSocket, { type: 'error', error: 'ragwalla_error', detail: event });
      }
    });

    const connectPromise = (async () => {
      const { token } = await ragwalla.agents.getToken({
        agent_id: agentId,
        expires_in: 300,
      });
      await upstream.connect(agentId, connectionId, token, threadId);
    })();

    connectPromise.catch((error) => {
      if (browserOpen) {
        sendJson(browserSocket, {
          type: 'error',
          error: 'ragwalla_connect_failed',
          message: errorMessage(error),
        });
      }
      closeBoth(1011, 'Ragwalla connect failed');
    });

    browserSocket.addEventListener('message', (event) => {
      void (async () => {
        let frame: unknown;
        try {
          frame = JSON.parse(String(event.data));
        } catch {
          sendJson(browserSocket, { type: 'error', error: 'invalid_json' });
          return;
        }

        try {
          await connectPromise;
          await upstream.sendAsync(frame);
        } catch (error) {
          sendJson(browserSocket, {
            type: 'error',
            error: 'ragwalla_send_failed',
            message: errorMessage(error),
          });
          closeBoth(1011, 'Ragwalla send failed');
        }
      })();
    });

    browserSocket.addEventListener('close', () => {
      browserOpen = false;
      upstream.disconnect();
    });

    browserSocket.addEventListener('error', () => {
      closeBoth(1011, 'Browser socket error');
    });

    ctx.waitUntil(connectPromise.catch(() => undefined));

    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    } as ResponseInit & { webSocket: WebSocket });
  },
};
```

## Browser Client For The Proxy

```ts
const socket = new WebSocket(
  'wss://your-worker.example.com/chat?agentId=agent_123&connectionId=browser-main'
);

let activeAssistantMessageId: string | null = null;
const assistantTextByMessageId = new Map<string, string>();

function renderAssistantMessage(messageId: string, text: string): void {
  const el = document.querySelector(`[data-message-id="${messageId}"]`);
  if (el) el.textContent = text;
}

socket.addEventListener('message', (event) => {
  const frame = JSON.parse(event.data);

  switch (frame.type) {
    case 'message_created': {
      activeAssistantMessageId = frame.messageId;
      assistantTextByMessageId.set(frame.messageId, '');
      renderAssistantMessage(frame.messageId, '');
      break;
    }

    case 'resume': {
      // resume.content is a full snapshot. Replace the current text, do not append it.
      activeAssistantMessageId = frame.messageId;
      assistantTextByMessageId.set(frame.messageId, frame.content ?? '');
      renderAssistantMessage(frame.messageId, frame.content ?? '');
      break;
    }

    case 'chunk': {
      const previous = assistantTextByMessageId.get(frame.messageId) ?? '';
      const next = previous + (frame.content ?? '');
      assistantTextByMessageId.set(frame.messageId, next);
      renderAssistantMessage(frame.messageId, next);
      break;
    }

    case 'complete': {
      if (frame.messageId === activeAssistantMessageId) {
        activeAssistantMessageId = null;
      }
      break;
    }

    case 'error': {
      console.error('Proxy/Ragwalla error:', frame);
      break;
    }
  }
});

export function sendUserMessage(content: string): void {
  socket.send(JSON.stringify({
    type: 'message',
    role: 'user',
    content,
  }));
}
```

## Proxy Helper For Any WebSocket Server

Use this when your server already has an accepted browser WebSocket. It works in runtimes
where the SDK can create an outbound WebSocket: Cloudflare Workers, browsers, Deno, Bun,
or Node.js 22+.

```ts
import type { Ragwalla } from '@ragwalla/agents-sdk';

type BrowserSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message' | 'close' | 'error', listener: (event: any) => void): void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function attachRagwallaProxy(options: {
  ragwalla: Ragwalla;
  browserSocket: BrowserSocket;
  agentId: string;
  connectionId: string;
  threadId?: string;
}): Promise<void> {
  const { ragwalla, browserSocket, agentId, connectionId, threadId } = options;

  const upstream = ragwalla.createWebSocket({
    reconnectAttempts: 5,
    reconnectDelay: 1000,
    getReconnectToken: async ({ agentId }) => {
      const { token } = await ragwalla.agents.getToken({
        agent_id: agentId,
        expires_in: 300,
      });
      return token;
    },
  });

  let browserOpen = true;

  const sendToBrowser = (value: unknown) => {
    if (!browserOpen) return;
    browserSocket.send(JSON.stringify(value));
  };

  const closeBoth = (code = 1011, reason = 'Proxy closed') => {
    browserOpen = false;
    upstream.disconnect();
    browserSocket.close(code, reason);
  };

  upstream.on('rawFrame', sendToBrowser);
  upstream.on('reconnectFailed', () => closeBoth(1011, 'Ragwalla reconnect failed'));
  upstream.on('error', (event: unknown) => {
    sendToBrowser({ type: 'error', error: 'ragwalla_error', detail: event });
  });

  const { token } = await ragwalla.agents.getToken({
    agent_id: agentId,
    expires_in: 300,
  });

  await upstream.connect(agentId, connectionId, token, threadId);

  browserSocket.addEventListener('message', (event) => {
    void (async () => {
      try {
        const frame = JSON.parse(String(event.data));
        await upstream.sendAsync(frame);
      } catch (error) {
        sendToBrowser({
          type: 'error',
          error: 'ragwalla_send_failed',
          message: errorMessage(error),
        });
        closeBoth(1011, 'Ragwalla send failed');
      }
    })();
  });

  browserSocket.addEventListener('close', () => {
    browserOpen = false;
    upstream.disconnect();
  });

  browserSocket.addEventListener('error', () => {
    closeBoth(1011, 'Browser socket error');
  });
}
```

## Chat-Only Proxy Writes

If your browser sends only chat text instead of raw Ragwalla frames, use
`sendMessageAsync()` in the proxy:

```ts
browserSocket.addEventListener('message', (event) => {
  void (async () => {
    const { content, metadata } = JSON.parse(String(event.data));

    try {
      await upstream.sendMessageAsync({
        role: 'user',
        content,
        metadata,
      });
    } catch (error) {
      browserSocket.send(JSON.stringify({
        type: 'error',
        error: 'ragwalla_send_failed',
        message: error instanceof Error ? error.message : String(error),
      }));
      browserSocket.close(1011, 'Ragwalla send failed');
    }
  })();
});
```

## Notes

- Relay upstream `rawFrame` frames unchanged.
- Use `sendAsync()` when the browser sends Ragwalla frames.
- Use `sendMessageAsync()` when the browser sends only chat text.
- Use `getReconnectToken` for proxies that mint short-lived WebSocket tokens.
- Handle `browserSocket.send()` failures inside the `rawFrame` listener. SDK listener
  exceptions are caught and logged so one listener cannot break other listeners.
