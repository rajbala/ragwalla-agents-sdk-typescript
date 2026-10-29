import { Ragwalla } from '../src';

// Example: WebSocket chat with debug logging enabled
async function debugWebSocketExample() {
  const ragwalla = new Ragwalla({
    apiKey: process.env.RAGWALLA_API_KEY!,
    debug: true // Enable detailed debug logging
  });

  try {
    console.log('🔍 Debug mode enabled - detailed logs will appear below');
    console.log('=====================================');
    
    // Get or create an agent
    const agents = await ragwalla.agents.list();
    const agent = agents.data[0];

    if (!agent) {
      console.log('No agents available. Create one first.');
      return;
    }

    console.log(`Using agent: ${agent.name}`);

    // Get connection token (with debug logging)
    const tokenResponse = await ragwalla.agents.getToken({
      agent_id: agent.id,
      expires_in: 3600
    });

    // Create WebSocket connection (debug flag is automatically passed)
    const ws = ragwalla.createWebSocket({
      reconnectAttempts: 3,
      reconnectDelay: 1000
    });

    let responseReceived = false;

    // Set up event listeners
    ws.on('connected', () => {
      console.log('✅ WebSocket connected successfully');
      
      // Send a test message
      ws.sendMessage({
        role: 'user',
        content: 'Hello! Please respond with a short greeting.'
      });
    });

    ws.on('message', (message) => {
      console.log('📨 Received message from agent:', message);
      responseReceived = true;
      
      // Disconnect after receiving response
      setTimeout(() => {
        ws.disconnect();
        process.exit(0);
      }, 1000);
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      process.exit(1);
    });

    ws.on('disconnected', ({ code, reason }) => {
      console.log(`🔌 WebSocket disconnected: ${code} - ${reason}`);
      if (!responseReceived) {
        console.log('No response received before disconnection');
        process.exit(1);
      }
    });

    ws.on('reconnectFailed', ({ attempts }) => {
      console.error(`💥 All reconnection attempts failed after ${attempts} tries`);
      process.exit(1);
    });

    // Connect to the agent
    console.log('🔗 Connecting to WebSocket...');
    await ws.connect(agent.id, 'debug-session', tokenResponse.token);

    // Wait for response or timeout
    setTimeout(() => {
      if (!responseReceived) {
        console.error('⏰ Timeout: No response received within 30 seconds');
        ws.disconnect();
        process.exit(1);
      }
    }, 30000);

  } catch (error) {
    console.error('💥 Error:', error);
    process.exit(1);
  }
}

// Run the example
if (require.main === module) {
  debugWebSocketExample();
}