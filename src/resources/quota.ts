import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import { QuotaEvent, QuotaStatus } from '../types/index.js';

export class QuotaResource {
  constructor(private client: HTTPClient) {}

  /**
   * Check quota status for a worker/user
   */
  async check(params: {
    userId: string;
    action: string;
  }): Promise<{ allowed: boolean; quota?: QuotaStatus }> {
    return this.client.post<{ allowed: boolean; quota?: QuotaStatus }>('/v1/quotacheck', params);
  }

  /**
   * Send quota event
   */
  async sendEvent(workerId: string, event: QuotaEvent): Promise<void> {
    return this.client.post<void>(path`/v1/quotaevents/${workerId}`, event);
  }

  /**
   * Get quota status for a worker
   */
  async getStatus(workerId: string): Promise<QuotaStatus> {
    return this.client.get<QuotaStatus>(path`/v1/quota/${workerId}`);
  }

  /**
   * Set quota for a worker
   */
  async setQuota(workerId: string, quota: {
    limit: number;
    reset_period?: 'hour' | 'day' | 'month';
  }): Promise<QuotaStatus> {
    return this.client.post<QuotaStatus>(path`/v1/quota/${workerId}`, quota);
  }
}