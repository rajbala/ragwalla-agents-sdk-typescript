import { RagwallaConfig, RagwallaError } from '../types/index.js';
import { DEFAULT_BASE_URL } from './base-url.js';

export class HTTPClient {
  private apiKey: string;
  private baseURL!: string; // Assigned in validateAndSetBaseURL
  private projectId?: string;
  private endpointId?: string;
  private timeout: number;
  private debug: boolean;

  constructor(config: RagwallaConfig) {
    this.apiKey = config.apiKey;
    this.validateAndSetBaseURL(config.baseURL ?? DEFAULT_BASE_URL);
    this.projectId = config.projectId;
    this.endpointId = config.endpointId;
    this.timeout = config.timeout || 30000;
    this.debug = config.debug || false;
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    if (!this.debug) return;
    
    const timestamp = new Date().toISOString();
    const prefix = `[Ragwalla HTTP ${timestamp}]`;
    
    if (data) {
      console[level](`${prefix} ${message}`, data);
    } else {
      console[level](`${prefix} ${message}`);
    }
  }

  private validateAndSetBaseURL(baseURL: string): void {
    if (!baseURL) {
      throw new Error('baseURL is required');
    }

    let parsed: URL;
    try {
      parsed = new URL(baseURL);
    } catch {
      throw new Error(
        'baseURL must be a valid absolute URL ending in /v1\n' +
        `Received: ${baseURL}`
      );
    }

    if (parsed.protocol !== 'https:') {
      throw new Error(
        'baseURL must use https and end in /v1\n' +
        `Received: ${baseURL}`
      );
    }

    if ((parsed.pathname !== '/v1' && parsed.pathname !== '/v1/') || parsed.search || parsed.hash) {
      throw new Error(
        'baseURL must be a valid absolute URL ending in /v1\n' +
        `Received: ${baseURL}`
      );
    }

    // Remove trailing slash if present
    this.baseURL = baseURL.replace(/\/$/, '');
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ragwalla-agents-sdk-typescript/1.0.0'
    };
    if (this.projectId) {
      headers['X-Project-ID'] = this.projectId;
    }
    if (this.endpointId) {
      headers['X-Worker-ID'] = this.endpointId;
    }
    return headers;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      let body: any = {};
      try {
        body = JSON.parse(rawText);
      } catch {
        // Non-JSON response (e.g. Cloudflare HTML error page)
        console.error(`[RagwallaHTTP] ${response.status} non-JSON response from ${response.url}: ${rawText.slice(0, 500)}`);
      }
      // ragwalla-hono-worker returns either { error: "string" } or { error: { message, type, code } }
      const errorObj = body.error || body;
      const message = typeof errorObj === 'string' ? errorObj : (errorObj.message || `HTTP ${response.status}`);
      const type = typeof errorObj === 'string' ? undefined : errorObj.type;
      const code = typeof errorObj === 'string' ? undefined : errorObj.code;
      const param = typeof errorObj === 'string' ? undefined : errorObj.param;
      throw new RagwallaAPIError(
        message,
        response.status,
        type,
        code,
        param
      );
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }
    
    return response.text() as unknown as T;
  }

  async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    const url = new URL(path, this.baseURL);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    this.log('info', 'Making GET request', { url: url.toString(), params });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      this.log('error', 'Request timeout reached', { url: url.toString(), timeout: this.timeout });
      controller.abort();
    }, this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: this.getHeaders(),
        signal: controller.signal
      });

      this.log('info', 'GET request completed', { 
        url: url.toString(), 
        status: response.status, 
        statusText: response.statusText 
      });

      return this.handleResponse<T>(response);
    } catch (error) {
      this.log('error', 'GET request failed', { url: url.toString(), error });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async post<T>(path: string, data?: any): Promise<T> {
    const url = new URL(path, this.baseURL);
    
    this.log('info', 'Making POST request', { url: url.toString(), hasData: !!data });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      this.log('error', 'Request timeout reached', { url: url.toString(), timeout: this.timeout });
      controller.abort();
    }, this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: this.getHeaders(),
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal
      });

      this.log('info', 'POST request completed', { 
        url: url.toString(), 
        status: response.status, 
        statusText: response.statusText 
      });

      return this.handleResponse<T>(response);
    } catch (error) {
      this.log('error', 'POST request failed', { url: url.toString(), error });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async put<T>(path: string, data?: any): Promise<T> {
    const url = new URL(path, this.baseURL);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'PUT',
        headers: this.getHeaders(),
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal
      });

      return this.handleResponse<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async patch<T>(path: string, data?: any): Promise<T> {
    const url = new URL(path, this.baseURL);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal
      });

      return this.handleResponse<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async delete<T>(path: string, data?: any): Promise<T> {
    const url = new URL(path, this.baseURL);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'DELETE',
        headers: this.getHeaders(),
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal
      });

      return this.handleResponse<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async postFormData<T>(path: string, formData: FormData, options?: {
    timeout?: number;
    headers?: Record<string, string>;
  }): Promise<T> {
    const url = new URL(path, this.baseURL);

    this.log('info', 'Making POST (multipart) request', { url: url.toString() });

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'User-Agent': 'ragwalla-agents-sdk-typescript/1.0.0',
      ...options?.headers
    };
    if (this.projectId) {
      headers['X-Project-ID'] = this.projectId;
    }
    if (this.endpointId) {
      headers['X-Worker-ID'] = this.endpointId;
    }

    const controller = new AbortController();
    const timeoutMs = options?.timeout ?? this.timeout;
    const timeoutId = setTimeout(() => {
      this.log('error', 'Request timeout reached', { url: url.toString(), timeout: timeoutMs });
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal
      });

      this.log('info', 'POST (multipart) request completed', {
        url: url.toString(),
        status: response.status,
        statusText: response.statusText
      });

      return this.handleResponse<T>(response);
    } catch (error) {
      this.log('error', 'POST (multipart) request failed', { url: url.toString(), error });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async postEventStream<T>(path: string, data?: any): Promise<ReadableStream<T>> {
    const url = new URL(path, this.baseURL);
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Accept': 'text/event-stream',
      },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const body: any = await response.json().catch(() => ({}));
      const errorObj = body.error || body;
      const msg = typeof errorObj === 'string' ? errorObj : (errorObj.message || `HTTP ${response.status}`);
      const errType = typeof errorObj === 'string' ? undefined : errorObj.type;
      const errCode = typeof errorObj === 'string' ? undefined : errorObj.code;
      const errParam = typeof errorObj === 'string' ? undefined : errorObj.param;
      throw new RagwallaAPIError(
        msg,
        response.status,
        errType,
        errCode,
        errParam
      );
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    return response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        const decoder = new TextDecoder();
        const text = decoder.decode(chunk);
        const lines = text.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              controller.enqueue(data);
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    }));
  }
}

export class RagwallaAPIError extends Error implements RagwallaError {
  public readonly type: string;
  public readonly code?: string;
  public readonly param?: string;
  public readonly status?: number;

  constructor(
    message: string,
    status?: number,
    type?: string,
    code?: string,
    param?: string
  ) {
    super(message);
    this.name = 'RagwallaAPIError';
    this.status = status;
    this.type = type || 'api_error';
    this.code = code;
    this.param = param;
  }
}
