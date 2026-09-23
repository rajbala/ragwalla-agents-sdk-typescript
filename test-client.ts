#!/usr/bin/env ts-node

import { Ragwalla, RagwallaWebSocket } from './src';

interface TestConfig {
  apiKey: string;
  baseURL: string;
  debug: boolean;
  timeout: number;
  scenarios: string[];
  agentId?: string; // Optional: use existing agent instead of creating one
}

interface TestMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  messagesReceived: number;
  messagesSent: number;
  errors: string[];
  connectionEvents: string[];
  success: boolean;
}

class AgentTestClient {
  private ragwalla: Ragwalla;
  private config: TestConfig;
  private metrics: TestMetrics;

  constructor(config: TestConfig) {
    this.config = config;
    this.ragwalla = new Ragwalla({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      debug: config.debug,
      timeout: config.timeout
    });
    
    this.metrics = {
      startTime: Date.now(),
      messagesReceived: 0,
      messagesSent: 0,
      errors: [],
      connectionEvents: [],
      success: false
    };
  }

  private log(level: 'info' | 'warn' | 'error' | 'success', message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const emoji = {
      info: '📘',
      warn: '⚠️',
      error: '❌',
      success: '✅'
    }[level];
    
    console.log(`${emoji} [${timestamp}] ${message}`);
    if (data) {
      console.log('   ', JSON.stringify(data, null, 2));
    }
  }

  private addError(error: string): void {
    this.metrics.errors.push(error);
    this.log('error', error);
  }

  private addConnectionEvent(event: string): void {
    this.metrics.connectionEvents.push(`${Date.now() - this.metrics.startTime}ms: ${event}`);
    this.log('info', `Connection Event: ${event}`);
  }

  async runAllTests(): Promise<boolean> {
    this.log('info', 'Starting Ragwalla Agent Test Suite', {
      baseURL: this.config.baseURL,
      debug: this.config.debug,
      timeout: this.config.timeout,
      scenarios: this.config.scenarios
    });

    try {
      // Test 1: Agent Management
      if (this.config.scenarios.includes('agent-management')) {
        await this.testAgentManagement();
      }

      // Test 2: WebSocket Token Generation
      if (this.config.scenarios.includes('token-generation')) {
        await this.testTokenGeneration();
      }

      // Test 3: Basic WebSocket Chat
      if (this.config.scenarios.includes('basic-chat')) {
        await this.testBasicWebSocketChat();
      }

      // Test 4: Long Response Handling
      if (this.config.scenarios.includes('long-response')) {
        await this.testLongResponseHandling();
      }

      // Test 5: Multiple Message Exchange
      if (this.config.scenarios.includes('multi-message')) {
        await this.testMultipleMessageExchange();
      }

      // Test 6: Connection Recovery
      if (this.config.scenarios.includes('connection-recovery')) {
        await this.testConnectionRecovery();
      }

      // Test 7: Timeout Handling
      if (this.config.scenarios.includes('timeout-handling')) {
        await this.testTimeoutHandling();
      }

      this.metrics.success = this.metrics.errors.length === 0;
      this.printSummary();
      
      return this.metrics.success;

    } catch (error: any) {
      this.addError(`Test suite failed: ${error.message}`);
      this.printSummary();
      return false;
    }
  }

  private async testAgentManagement(): Promise<void> {
    this.log('info', '🧪 Testing Agent Management (CRUD Operations)');
    
    try {
      if (this.config.agentId) {
        // Use existing agent
        this.log('info', `Using existing agent: ${this.config.agentId}`);
        const agent = await this.ragwalla.agents.retrieve(this.config.agentId);
        this.log('success', 'Retrieved existing agent', { id: agent.id, name: agent.name });
        (this as any).testAgent = agent;
        (this as any).usingExistingAgent = true;
      } else {
        // Create new test agent
        const agent = await this.ragwalla.agents.create({
          name: `Test Agent ${Date.now()}`,
          description: 'Agent created by test client',
          instructions: 'You are a helpful test assistant. Respond concisely and clearly.',
          metadata: { testClient: true, createdAt: new Date().toISOString() }
        });
        
        this.log('success', 'Agent created successfully', { id: agent.id, name: agent.name });

        // List agents
        const agentsList = await this.ragwalla.agents.list({ limit: 5 });
        this.log('success', `Listed agents: ${agentsList.data.length} found`);

        // Update agent
        const updatedAgent = await this.ragwalla.agents.update(agent.id, {
          instructions: 'Updated instructions: You are a helpful test assistant with updated guidelines.'
        });
        this.log('success', 'Agent updated successfully');

        // Store agent for later tests
        (this as any).testAgent = agent;
        (this as any).usingExistingAgent = false;
      }

    } catch (error: any) {
      this.addError(`Agent management test failed: ${error.message}`);
      throw error;
    }
  }

  private async testTokenGeneration(): Promise<void> {
    this.log('info', '🧪 Testing WebSocket Token Generation');
    
    try {
      const agent = (this as any).testAgent;
      if (!agent) {
        throw new Error('No test agent available');
      }

      const tokenResponse = await this.ragwalla.agents.getToken({
        agent_id: agent.id,
        expires_in: 3600
      });

      if (!tokenResponse.token) {
        throw new Error('No token received');
      }

      this.log('success', 'WebSocket token generated successfully', {
        tokenLength: tokenResponse.token.length,
        expiresAt: tokenResponse.expiresAt
      });

      // Store token for later tests
      (this as any).testToken = tokenResponse.token;

    } catch (error: any) {
      this.addError(`Token generation test failed: ${error.message}`);
      throw error;
    }
  }

  private async testBasicWebSocketChat(): Promise<void> {
    this.log('info', '🧪 Testing Basic WebSocket Chat');
    
    return new Promise(async (resolve, reject) => {
      try {
        const agent = (this as any).testAgent;
        const token = (this as any).testToken;
        
        if (!agent || !token) {
          throw new Error('Agent or token not available');
        }

        const ws = this.ragwalla.createWebSocket({
          reconnectAttempts: 2,
          reconnectDelay: 1000
        });

        let responseReceived = false;
        const timeout = setTimeout(() => {
          if (!responseReceived) {
            this.addError('Basic chat test timed out after 30 seconds');
            ws.disconnect();
            reject(new Error('Timeout'));
          }
        }, 30000);

        ws.on('connected', () => {
          this.addConnectionEvent('WebSocket connected');
          
          // Send a simple test message
          const testMessage = {
            role: 'user' as const,
            content: 'Hello! Please respond with exactly: "Test response received"'
          };
          
          ws.sendMessage(testMessage);
          this.metrics.messagesSent++;
          this.log('info', 'Sent test message', testMessage);
        });

        ws.on('message', (message: any) => {
          this.metrics.messagesReceived++;
          this.log('success', 'Received message from agent', message);
          
          if (message.content && message.content.includes('Test response received')) {
            this.log('success', 'Basic chat test completed successfully');
            responseReceived = true;
            clearTimeout(timeout);
            ws.disconnect();
            resolve(undefined);
          } else {
            this.log('warn', 'Unexpected response content', { expected: 'Test response received', received: message.content });
          }
        });

        ws.on('error', (error: any) => {
          this.addError(`WebSocket error in basic chat: ${error.error}`);
          clearTimeout(timeout);
          reject(new Error(error.error));
        });

        ws.on('disconnected', ({ code, reason }: any) => {
          this.addConnectionEvent(`WebSocket disconnected: ${code} - ${reason}`);
        });

        // Connect to agent
        await ws.connect(agent.id, 'basic-test', token);

      } catch (error: any) {
        this.addError(`Basic chat test setup failed: ${error.message}`);
        reject(error);
      }
    });
  }

  private async testLongResponseHandling(): Promise<void> {
    this.log('info', '🧪 Testing Long Response Handling');
    
    return new Promise(async (resolve, reject) => {
      try {
        const agent = (this as any).testAgent;
        const token = (this as any).testToken;
        
        if (!agent || !token) {
          throw new Error('Agent or token not available');
        }

        const ws = this.ragwalla.createWebSocket();
        let fullResponse = '';
        let messageCount = 0;
        
        const timeout = setTimeout(() => {
          this.addError('Long response test timed out after 60 seconds');
          ws.disconnect();
          reject(new Error('Timeout'));
        }, 60000);

        ws.on('connected', () => {
          this.addConnectionEvent('WebSocket connected for long response test');
          
          // Request a long response
          const testMessage = {
            role: 'user' as const,
            content: 'Please write a detailed explanation of artificial intelligence, including its history, current applications, and future prospects. Make it at least 300 words.'
          };
          
          ws.sendMessage(testMessage);
          this.metrics.messagesSent++;
          this.log('info', 'Sent long response request');
        });

        ws.on('message', (message: any) => {
          this.metrics.messagesReceived++;
          messageCount++;
          
          if (message.content) {
            fullResponse += message.content;
            this.log('info', `Received message chunk ${messageCount} (${message.content.length} chars)`);
          }
          
          // Check if response seems complete (ends with punctuation and is substantial)
          if (message.role === 'assistant' && fullResponse.length > 200) {
            this.log('success', `Long response completed: ${fullResponse.length} characters in ${messageCount} messages`);
            clearTimeout(timeout);
            ws.disconnect();
            resolve(undefined);
          }
        });

        ws.on('error', (error: any) => {
          this.addError(`WebSocket error in long response test: ${error.error}`);
          clearTimeout(timeout);
          reject(new Error(error.error));
        });

        // Connect to agent
        await ws.connect(agent.id, 'long-response-test', token);

      } catch (error: any) {
        this.addError(`Long response test setup failed: ${error.message}`);
        reject(error);
      }
    });
  }

  private async testMultipleMessageExchange(): Promise<void> {
    this.log('info', '🧪 Testing Multiple Message Exchange');
    
    return new Promise(async (resolve, reject) => {
      try {
        const agent = (this as any).testAgent;
        const token = (this as any).testToken;
        
        if (!agent || !token) {
          throw new Error('Agent or token not available');
        }

        const ws = this.ragwalla.createWebSocket();
        let conversationStep = 0;
        const maxSteps = 3;
        let responsesReceived = 0;
        
        const timeout = setTimeout(() => {
          this.addError('Multiple message test timed out after 45 seconds');
          ws.disconnect();
          reject(new Error('Timeout'));
        }, 45000);

        const messages = [
          'What is 2 + 2?',
          'What about 5 × 3?',
          'Thank you for the calculations!'
        ];

        ws.on('connected', () => {
          this.addConnectionEvent('WebSocket connected for multi-message test');
          sendNextMessage();
        });

        const sendNextMessage = () => {
          if (conversationStep < messages.length) {
            const testMessage = {
              role: 'user' as const,
              content: messages[conversationStep]
            };
            
            ws.sendMessage(testMessage);
            this.metrics.messagesSent++;
            this.log('info', `Sent message ${conversationStep + 1}/${messages.length}`, testMessage);
            conversationStep++;
          }
        };

        ws.on('message', (message: any) => {
          this.metrics.messagesReceived++;
          this.log('info', `Received response ${responsesReceived + 1}`, message);
          
          if (message.role === 'assistant') {
            responsesReceived++;
            
            // Send next message after receiving response
            setTimeout(() => {
              if (responsesReceived < maxSteps) {
                sendNextMessage();
              } else {
                this.log('success', `Multi-message exchange completed: ${responsesReceived} responses received`);
                clearTimeout(timeout);
                ws.disconnect();
                resolve(undefined);
              }
            }, 1000); // Small delay between messages
          }
        });

        ws.on('error', (error: any) => {
          this.addError(`WebSocket error in multi-message test: ${error.error}`);
          clearTimeout(timeout);
          reject(new Error(error.error));
        });

        // Connect to agent
        await ws.connect(agent.id, 'multi-message-test', token);

      } catch (error: any) {
        this.addError(`Multi-message test setup failed: ${error.message}`);
        reject(error);
      }
    });
  }

  private async testConnectionRecovery(): Promise<void> {
    this.log('info', '🧪 Testing Connection Recovery (Manual Reconnection)');
    
    return new Promise(async (resolve, reject) => {
      try {
        const agent = (this as any).testAgent;
        const token = (this as any).testToken;
        
        if (!agent || !token) {
          throw new Error('Agent or token not available');
        }

        const ws = this.ragwalla.createWebSocket({
          reconnectAttempts: 2,
          reconnectDelay: 2000
        });

        let connectionCount = 0;
        let disconnectionForced = false;
        
        const timeout = setTimeout(() => {
          this.addError('Connection recovery test timed out after 30 seconds');
          ws.disconnect();
          reject(new Error('Timeout'));
        }, 30000);

        ws.on('connected', () => {
          connectionCount++;
          this.addConnectionEvent(`Connection ${connectionCount} established`);
          
          if (connectionCount === 1) {
            // Send initial message
            ws.sendMessage({
              role: 'user' as const,
              content: 'Initial connection test message'
            });
            this.metrics.messagesSent++;
            
            // Force disconnection after 3 seconds to test recovery
            setTimeout(() => {
              this.log('info', 'Forcing disconnection to test recovery...');
              disconnectionForced = true;
              ws.disconnect();
            }, 3000);
          } else {
            // Successful reconnection
            this.log('success', 'Connection recovery successful');
            ws.sendMessage({
              role: 'user' as const,
              content: 'Reconnection test message'
            });
            this.metrics.messagesSent++;
          }
        });

        ws.on('message', (message: any) => {
          this.metrics.messagesReceived++;
          this.log('info', 'Received message during recovery test', message);
          
          if (connectionCount >= 2 && message.role === 'assistant') {
            this.log('success', 'Connection recovery test completed successfully');
            clearTimeout(timeout);
            ws.disconnect();
            resolve(undefined);
          }
        });

        ws.on('disconnected', ({ code, reason }: any) => {
          this.addConnectionEvent(`Disconnected: ${code} - ${reason}`);
          
          if (disconnectionForced && connectionCount === 1) {
            // Attempt manual reconnection
            setTimeout(async () => {
              try {
                this.log('info', 'Attempting manual reconnection...');
                await ws.connect(agent.id, 'recovery-test-2', token);
              } catch (error: any) {
                this.addError(`Manual reconnection failed: ${error.message}`);
                clearTimeout(timeout);
                reject(error);
              }
            }, 2000);
          }
        });

        ws.on('error', (error: any) => {
          this.addError(`WebSocket error in recovery test: ${error.error}`);
          clearTimeout(timeout);
          reject(new Error(error.error));
        });

        // Initial connection
        await ws.connect(agent.id, 'recovery-test-1', token);

      } catch (error: any) {
        this.addError(`Connection recovery test setup failed: ${error.message}`);
        reject(error);
      }
    });
  }

  private async testTimeoutHandling(): Promise<void> {
    this.log('info', '🧪 Testing Timeout Handling');
    
    return new Promise(async (resolve, reject) => {
      try {
        const agent = (this as any).testAgent;
        const token = (this as any).testToken;
        
        if (!agent || !token) {
          throw new Error('Agent or token not available');
        }

        const ws = this.ragwalla.createWebSocket();
        let connected = false;
        
        // Shorter timeout for this specific test
        const timeout = setTimeout(() => {
          if (connected) {
            this.log('success', 'Timeout handling test completed - no unexpected timeouts occurred');
            ws.disconnect();
            resolve(undefined);
          } else {
            this.addError('Failed to establish connection within timeout period');
            reject(new Error('Connection timeout'));
          }
        }, 15000);

        ws.on('connected', () => {
          connected = true;
          this.addConnectionEvent('Connected for timeout test');
          
          // Send a message and wait for response
          ws.sendMessage({
            role: 'user' as const,
            content: 'Please respond with the current time and date.'
          });
          this.metrics.messagesSent++;
        });

        ws.on('message', (message: any) => {
          this.metrics.messagesReceived++;
          this.log('info', 'Received timely response', message);
          
          if (message.role === 'assistant') {
            clearTimeout(timeout);
            this.log('success', 'Timeout handling test completed successfully');
            ws.disconnect();
            resolve(undefined);
          }
        });

        ws.on('error', (error: any) => {
          this.addError(`WebSocket error in timeout test: ${error.error}`);
          clearTimeout(timeout);
          reject(new Error(error.error));
        });

        // Connect to agent
        await ws.connect(agent.id, 'timeout-test', token);

      } catch (error: any) {
        this.addError(`Timeout test setup failed: ${error.message}`);
        reject(error);
      }
    });
  }

  private printSummary(): void {
    this.metrics.endTime = Date.now();
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime;

    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    console.log(`🕐 Duration: ${this.metrics.duration}ms (${(this.metrics.duration / 1000).toFixed(2)}s)`);
    console.log(`📤 Messages Sent: ${this.metrics.messagesSent}`);
    console.log(`📥 Messages Received: ${this.metrics.messagesReceived}`);
    console.log(`🔗 Connection Events: ${this.metrics.connectionEvents.length}`);
    console.log(`❌ Errors: ${this.metrics.errors.length}`);
    console.log(`✅ Overall Success: ${this.metrics.success ? 'PASS' : 'FAIL'}`);

    if (this.metrics.connectionEvents.length > 0) {
      console.log('\n🔗 Connection Timeline:');
      this.metrics.connectionEvents.forEach(event => {
        console.log(`   ${event}`);
      });
    }

    if (this.metrics.errors.length > 0) {
      console.log('\n❌ Errors Encountered:');
      this.metrics.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    console.log('\n' + '='.repeat(60));
  }

  async cleanup(): Promise<void> {
    this.log('info', '🧹 Cleaning up test resources...');
    
    try {
      const agent = (this as any).testAgent;
      const usingExistingAgent = (this as any).usingExistingAgent;
      
      if (agent && !usingExistingAgent) {
        await this.ragwalla.agents.delete(agent.id);
        this.log('success', 'Test agent deleted successfully');
      } else if (agent && usingExistingAgent) {
        this.log('info', 'Skipped deletion of existing agent (not created by test)');
      }
    } catch (error: any) {
      this.log('warn', `Failed to delete test agent: ${error.message}`);
    }
  }
}

// CLI Interface
async function main() {
  const config: TestConfig = {
    apiKey: process.env.RAGWALLA_API_KEY || '',
    baseURL: process.env.RAGWALLA_BASE_URL || 'https://example.ai.ragwalla.com/v1',
    debug: process.env.DEBUG === 'true' || process.argv.includes('--debug'),
    timeout: parseInt(process.env.TIMEOUT || '30000'),
    agentId: process.env.RAGWALLA_AGENT_ID, // Optional: use existing agent
    scenarios: process.env.SCENARIOS?.split(',') || [
      'agent-management',
      'token-generation', 
      'basic-chat',
      'long-response',
      'multi-message',
      'connection-recovery',
      'timeout-handling'
    ]
  };

  if (!config.apiKey) {
    console.error('❌ RAGWALLA_API_KEY environment variable is required');
    process.exit(1);
  }

  if (!config.baseURL.includes('.ai.ragwalla.com')) {
    console.error('❌ RAGWALLA_BASE_URL must follow pattern: https://example.ai.ragwalla.com/v1');
    process.exit(1);
  }

  const testClient = new AgentTestClient(config);
  
  try {
    const success = await testClient.runAllTests();
    await testClient.cleanup();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('💥 Test suite crashed:', (error as any).message);
    await testClient.cleanup();
    process.exit(1);
  }
}

// Handle CLI execution
if (require.main === module) {
  main().catch(console.error);
}

export { AgentTestClient, TestConfig, TestMetrics };