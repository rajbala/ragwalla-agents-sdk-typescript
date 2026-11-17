import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import {
  CreateOrganizationRequest,
  Organization,
  OrganizationList,
  UpdateOrganizationRequest,
  Project,
  ProjectList,
  CreateProjectRequest,
  UpdateProjectRequest,
  OrganizationWebhook,
  CreateOrganizationWebhookRequest,
  UpdateOrganizationWebhookRequest,
  OrganizationWebhookCreateResponse,
  OrganizationWebhookListResponse,
  OrganizationWebhookDeliveriesResponse,
} from '../types/index.js';

class ProjectsResource {
  constructor(private client: HTTPClient) {}

  /**
   * Create a new project within an organization
   */
  async create(orgId: string, request: CreateProjectRequest): Promise<Project> {
    return this.client.post<Project>(path`/v1/organizations/${orgId}/projects`, request);
  }

  /**
   * List projects within an organization
   */
  async list(orgId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<ProjectList> {
    return this.client.get<ProjectList>(path`/v1/organizations/${orgId}/projects`, params);
  }

  /**
   * Retrieve a project by ID
   */
  async retrieve(orgId: string, projectId: string): Promise<Project> {
    return this.client.get<Project>(path`/v1/organizations/${orgId}/projects/${projectId}`);
  }

  /**
   * Update a project
   */
  async update(orgId: string, projectId: string, request: UpdateProjectRequest): Promise<Project> {
    return this.client.post<Project>(path`/v1/organizations/${orgId}/projects/${projectId}`, request);
  }

  /**
   * Archive a project
   */
  async archive(orgId: string, projectId: string): Promise<Project> {
    return this.client.post<Project>(path`/v1/organizations/${orgId}/projects/${projectId}/archive`);
  }
}

class WebhooksResource {
  constructor(private client: HTTPClient) {}

  /**
   * Create an outbound organization webhook.
   */
  async create(
    orgId: string,
    request: CreateOrganizationWebhookRequest,
  ): Promise<OrganizationWebhookCreateResponse> {
    return this.client.post<OrganizationWebhookCreateResponse>(
      path`/v1/organizations/${orgId}/webhooks`,
      request,
    );
  }

  /**
   * List outbound organization webhooks.
   */
  async list(orgId: string): Promise<OrganizationWebhookListResponse> {
    return this.client.get<OrganizationWebhookListResponse>(
      path`/v1/organizations/${orgId}/webhooks`,
    );
  }

  /**
   * Retrieve one outbound webhook by ID.
   */
  async retrieve(orgId: string, webhookId: string): Promise<OrganizationWebhook> {
    return this.client.get<OrganizationWebhook>(
      path`/v1/organizations/${orgId}/webhooks/${webhookId}`,
    );
  }

  /**
   * Update an outbound organization webhook.
   */
  async update(
    orgId: string,
    webhookId: string,
    request: UpdateOrganizationWebhookRequest,
  ): Promise<OrganizationWebhook> {
    return this.client.put<OrganizationWebhook>(
      path`/v1/organizations/${orgId}/webhooks/${webhookId}`,
      request,
    );
  }

  /**
   * Delete an outbound organization webhook.
   */
  async delete(orgId: string, webhookId: string): Promise<{ ok: boolean }> {
    return this.client.delete<{ ok: boolean }>(
      path`/v1/organizations/${orgId}/webhooks/${webhookId}`,
    );
  }

  /**
   * List delivery attempts for an outbound organization webhook.
   */
  async listDeliveries(
    orgId: string,
    webhookId: string,
    params?: { limit?: number; offset?: number },
  ): Promise<OrganizationWebhookDeliveriesResponse> {
    return this.client.get<OrganizationWebhookDeliveriesResponse>(
      path`/v1/organizations/${orgId}/webhooks/${webhookId}/deliveries`,
      params,
    );
  }
}

export class OrganizationsResource {
  public readonly projects: ProjectsResource;
  public readonly webhooks: WebhooksResource;

  constructor(private client: HTTPClient) {
    this.projects = new ProjectsResource(client);
    this.webhooks = new WebhooksResource(client);
  }

  /**
   * Create a new organization
   */
  async create(request: CreateOrganizationRequest): Promise<Organization> {
    return this.client.post<Organization>('/v1/organizations', request);
  }

  /**
   * List all organizations accessible to the current API key
   */
  async list(): Promise<OrganizationList> {
    return this.client.get<OrganizationList>('/v1/organizations');
  }

  /**
   * Retrieve an organization by ID
   */
  async retrieve(orgId: string): Promise<Organization> {
    return this.client.get<Organization>(path`/v1/organizations/${orgId}`);
  }

  /**
   * Update an organization
   */
  async update(orgId: string, request: UpdateOrganizationRequest): Promise<Organization> {
    return this.client.patch<Organization>(path`/v1/organizations/${orgId}`, request);
  }

  /**
   * Delete an organization
   */
  async delete(orgId: string): Promise<{ ok: boolean }> {
    return this.client.delete<{ ok: boolean }>(path`/v1/organizations/${orgId}`);
  }
}
