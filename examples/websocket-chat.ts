import { Ragwalla } from '../src';

// Example: Real-time WebSocket chat
async function websocketExample() {
  const ragwalla = new Ragwalla({
    apiKey: process.env.RAGWALLA_API_KEY!
  });

  try {
    // Get an agent
    const agents = await ragwalla.agents.list();
    const agent = agents.data[0];

    if (!agent) {
      console.log('No agents available. Create one first.');
      return;
    }

    // Get connection token
    const tokenResponse = await ragwalla.agents.getToken({
      agent_id: agent.id,
      expires_in: 3600 // 1 hour
    });

    console.log(`Connecting to agent: ${agent.name}`);

    // Create WebSocket connection
    const ws = ragwalla.createWebSocket({
      reconnectAttempts: 3,
      reconnectDelay: 1000
    });

    // Set up event listeners
    ws.on('connected', () => {
      console.log('Connected to agent via WebSocket');
      
      // Send initial message
      ws.sendMessage({
        role: 'user',
        content: 'Hello! Can you help me with something?'
      });
    });

    ws.on('message', (message) => {
      console.log('Agent:', message.content);
      
      // Send follow-up message after 3 seconds
      setTimeout(() => {
        ws.sendMessage({
          role: 'user',
          content: 'Thank you for your help!'
        });
      }, 3000);
    });

    ws.on('tokenUsage', (usage) => {
      console.log('Token usage:', usage);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    ws.on('disconnected', ({ code, reason }) => {
      console.log(`Disconnected: ${code} - ${reason}`);
    });

    ws.on('reconnectFailed', ({ attempts }) => {
      console.log(`Reconnection failed after ${attempts} attempts`);
    });

    // Connect to the agent
    await ws.connect(agent.id, 'main', tokenResponse.token);

    // Keep the connection open for demo purposes
    console.log('WebSocket chat session started. Press Ctrl+C to exit.');
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nDisconnecting...');
      ws.disconnect();
      process.exit(0);
    });

    // Keep the process running
    await new Promise(() => {}); // Never resolves

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
if (require.main === module) {
  websocketExample();
}