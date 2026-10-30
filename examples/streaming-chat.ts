import { Ragwalla } from '../src';

// Example: Streaming chat via WebSocket
async function streamingExample() {
  const ragwalla = new Ragwalla({
    apiKey: process.env.RAGWALLA_API_KEY!
  });

  try {
    // Get or create an agent
    const agents = await ragwalla.agents.list();
    const agent = agents.data[0]; // Use first available agent

    if (!agent) {
      console.log('No agents available. Create one first.');
      return;
    }

    console.log(`Using agent: ${agent.name}`);

    // Get connection token
    const tokenResponse = await ragwalla.agents.getToken({
      agent_id: agent.id,
      expires_in: 3600 // 1 hour
    });

    // Create WebSocket connection
    const ws = ragwalla.createWebSocket({
      reconnectAttempts: 3,
      reconnectDelay: 1000
    });

    let fullResponse = '';
    let currentMessageId = '';

    // Set up event listeners
    ws.on('connected', () => {
      console.log('Connected to agent via WebSocket');
      console.log('Streaming response:');
      console.log('---');
      
      // Send message
      ws.sendMessage({
        role: 'user',
        content: 'Write a short poem about artificial intelligence.'
      });
    });

    // Listen for streaming chunks (recommended for streaming)
    ws.on('chunk', (chunk) => {
      if (chunk.content) {
        process.stdout.write(chunk.content);
        fullResponse += chunk.content;
        currentMessageId = chunk.messageId;
      }
    });

    // Listen for message completion
    ws.on('complete', (info) => {
      console.log('\n---');
      console.log(`Message ${info.messageId} completed`);
      console.log('Full response:', fullResponse);
      ws.disconnect();
      process.exit(0);
    });

    // Also listen to 'message' events (for compatibility)
    ws.on('message', (message) => {
      // This will also receive chunks, but 'chunk' event is more specific
      // You can use either 'chunk' or 'message' events
    });

    ws.on('error', (error) => {
      console.error('\nWebSocket error:', error);
      process.exit(1);
    });

    ws.on('disconnected', ({ code, reason }) => {
      console.log(`\nDisconnected: ${code} - ${reason}`);
    });

    // Connect to the agent
    await ws.connect(agent.id, 'streaming-session', tokenResponse.token);

    // Keep the process running (will exit when complete event fires)
    await new Promise(() => {}); // Never resolves - process.exit() called in complete handler

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the example
if (require.main === module) {
  streamingExample();
}