import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import {
  Endpoint,
  CreateEndpointRequest,
  EndpointList,
  EndpointDeleted,
} from '../types/index.js';

/**
 * Manage WfP endpoints via platform keys (pk-*).
 *
 * Endpoint creation is asynchronous — `create()` returns immediately with
 * `status: 'provisioning'`. Poll via `retrieve()` until `status: 'active'`.
 */
export class EndpointsResource {
  constructor(private client: HTTPClient) {}

  /**
   * Create a new endpoint (dispatch script) in the namespace.
   * Returns immediately with `status: 'provisioning'`.
   */
  async create(request: CreateEndpointRequest): Promise<Endpoint> {
    return this.client.post<Endpoint>('/v1/endpoints', request);
  }

  /**
   * List all endpoints accessible to this platform key.
   */
  async list(): Promise<EndpointList> {
    return this.client.get<EndpointList>('/v1/endpoints');
  }

  /**
   * Retrieve an endpoint by ID. Use this to poll provisioning status.
   */
  async retrieve(endpointId: string): Promise<Endpoint> {
    return this.client.get<Endpoint>(path`/v1/endpoints/${endpointId}`);
  }

  /**
   * Delete (deprovision) an endpoint.
   */
  async delete(endpointId: string): Promise<EndpointDeleted> {
    return this.client.delete<EndpointDeleted>(path`/v1/endpoints/${endpointId}`);
  }
}
