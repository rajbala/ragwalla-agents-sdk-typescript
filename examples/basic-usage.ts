import { Ragwalla } from '../src';

// Example: Basic SDK usage
async function basicExample() {
  // Initialize the client
  const ragwalla = new Ragwalla({
    apiKey: process.env.RAGWALLA_API_KEY!
  });

  try {
    // Create a new agent
    const agent = await ragwalla.agents.create({
      name: 'Customer Support Agent',
      description: 'An AI agent for handling customer support inquiries',
      model: 'gpt-4',
      instructions: 'You are a helpful customer support representative. Be polite and professional.',
      metadata: {
        department: 'support',
        version: '1.0'
      }
    });

    console.log('Created agent:', agent);

    // List all agents
    const agentsList = await ragwalla.agents.list();
    console.log('All agents:', agentsList.data);

    // Get a WebSocket token for real-time communication
    const tokenResponse = await ragwalla.agents.getToken({
      agent_id: agent.id,
      expires_in: 3600 // 1 hour
    });

    console.log('WebSocket token obtained. Use websocket-chat.ts example for real-time chat.');
    console.log('Note: Chat with agents requires WebSocket connection, not HTTP requests.');

    // Clean up - delete the agent
    await ragwalla.agents.delete(agent.id);
    console.log('Agent deleted');

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
if (require.main === module) {
  basicExample();
}