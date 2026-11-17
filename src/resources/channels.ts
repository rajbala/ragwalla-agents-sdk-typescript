import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import {
  Channel,
  CreateChannelRequest,
  CreateChannelResponse,
  ChannelStatus,
  WebhookRetryResponse,
} from '../types/index.js';

export class ChannelsResource {
  constructor(private client: HTTPClient) {}

  /**
   * Configure a channel for an agent (e.g. Telegram, Slack, WhatsApp).
   * If a channel of the same type already exists for the agent, it will be updated.
   */
  async create(agentId: string, request: CreateChannelRequest): Promise<CreateChannelResponse> {
    return this.client.post<CreateChannelResponse>(path`/v1/agents/${agentId}/channels`, request);
  }

  /**
   * List all channels configured for an agent
   */
  async list(agentId: string): Promise<{ channels: Channel[] }> {
    return this.client.get<{ channels: Channel[] }>(path`/v1/agents/${agentId}/channels`);
  }

  /**
   * Delete a channel from an agent.
   * For Telegram channels, this also unregisters the webhook.
   */
  async delete(agentId: string, channelId: string): Promise<{ deleted: boolean }> {
    return this.client.delete<{ deleted: boolean }>(path`/v1/agents/${agentId}/channels/${channelId}`);
  }

  /**
   * Get detailed status of a channel, including live webhook status for Telegram
   */
  async getStatus(agentId: string, channelId: string): Promise<ChannelStatus> {
    return this.client.get<ChannelStatus>(path`/v1/agents/${agentId}/channels/${channelId}/status`);
  }

  /**
   * Retry webhook registration for a failed Telegram channel
   */
  async retryWebhook(agentId: string, channelId: string): Promise<WebhookRetryResponse> {
    return this.client.post<WebhookRetryResponse>(path`/v1/agents/${agentId}/channels/${channelId}/webhook/retry`);
  }
}
