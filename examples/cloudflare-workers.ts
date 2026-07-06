import { Ragwalla, RagwallaWebSocket } from '@ragwalla/agents-sdk/workers';

// Cloudflare Workers environment bindings
interface Env {
  RAGWALLA_API_KEY: string;
  RAGWALLA_BASE_URL: string;
}

// Cloudflare Workers example
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Initialize the Ragwalla client with environment variables
    const ragwalla = new Ragwalla({
      apiKey: env.RAGWALLA_API_KEY, // Set this in your Worker environment
      baseURL: env.RAGWALLA_BASE_URL // e.g., 'https://myorg.ai.ragwalla.com/v1'
    });

    try {
      // Example 1: Create an agent
      const agent = await ragwalla.agents.create({
        name: 'Customer Support Agent',
        description: 'AI assistant for customer support',
        instructions: 'You are a helpful customer support agent. Be polite and helpful.',
        model: 'gpt-4',
        tools: []
      });

      // Example 2: Get WebSocket token for real-time chat
      // Note: All agent chat happens via WebSocket, not HTTP
      const tokenResponse = await ragwalla.agents.getToken({
        agent_id: agent.id,
        expires_in: 3600
      });

      // Example 3: Vector search (HTTP endpoint works fine for search)
      const searchResults = await ragwalla.vectorStores.search('your-vector-store-id', {
        query: 'product documentation',
        max_num_results: 5
      });

      // Construct WebSocket URL for the client to connect to
      const wsBaseUrl = env.RAGWALLA_BASE_URL.replace('https://', 'wss://');
      const websocketUrl = `${wsBaseUrl}/agents/${agent.id}/main?token=${tokenResponse.token}`;

      return new Response(JSON.stringify({
        agent: agent,
        websocketToken: tokenResponse.token,
        websocketUrl: websocketUrl,
        searchResults: searchResults,
        message: 'Agent created! Use the websocketUrl to connect and chat in real-time.',
        success: true
      }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : 'An error occurred',
        success: false
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // WebSocket example for real-time chat
  async webSocketHandler(request: Request, env: Env): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected websocket', { status: 400 });
    }

    // WebSocketPair is a Cloudflare Workers global
    // @ts-ignore - WebSocketPair is available in Cloudflare Workers runtime
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];

    // Initialize Ragwalla WebSocket client
    const ragwalla = new Ragwalla({
      apiKey: env.RAGWALLA_API_KEY,
      baseURL: env.RAGWALLA_BASE_URL
    });

    // Get connection token
    const tokenResponse = await ragwalla.agents.getToken({
      agent_id: 'your-agent-id' // Replace with actual agent ID
    });

    // Connect to Ragwalla WebSocket
    const ws = new RagwallaWebSocket({
      baseURL: env.RAGWALLA_BASE_URL // Will auto-convert https:// to wss://
    });

    // Set up event handlers
    ws.on('connected', () => {
      console.log('Connected to Ragwalla');
    });

    ws.on('message', (message: any) => {
      // Forward messages from Ragwalla to the client
      server.send(JSON.stringify(message));
    });

    ws.on('error', (error: any) => {
      console.error('WebSocket error:', error);
      server.close();
    });

    // Handle messages from the client
    server.addEventListener('message', (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data as string);
        ws.sendMessage(message);
      } catch (error) {
        console.error('Failed to parse client message:', error);
      }
    });

    server.addEventListener('close', () => {
      ws.disconnect();
    });

    // Connect to Ragwalla
    await ws.connect('your-agent-id', 'main', tokenResponse.token);

    // Return response with WebSocket (Cloudflare Workers specific)
    // The webSocket property is valid in Cloudflare Workers but not in standard Response type
    return new Response(null, {
      status: 101,
      webSocket: client,
    } as any);
  }
};
