import { RagwallaConfig, RagwallaError } from '../types/index.js';
import { DEFAULT_BASE_URL } from './base-url.js';
import { parseServerSentEvents } from './sse.js';

/** A binary response: its bytes, media type and headers (e.g. `x-ragwalla-sample-rate` on speech). */
export interface BinaryResponse {
  data: ArrayBuffer;
  contentType: string | null;
  headers: Headers;
}

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

  /** A binary response body (audio) and its headers. */
  async getBinary(path: string): Promise<BinaryResponse> {
    return this.binary(path, { method: 'GET', headers: this.getHeaders() });
  }

  /** POSTs JSON and reads a binary response body (audio). */
  async postBinary(path: string, data: unknown): Promise<BinaryResponse> {
    return this.binary(path, { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(data) });
  }

  private async binary(path: string, init: RequestInit): Promise<BinaryResponse> {
    const url = new URL(path, this.baseURL);
    this.log('info', `Making ${init.method} (binary) request`, { url: url.toString() });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(url.toString(), { ...init, signal: controller.signal });
      if (!response.ok) await this.handleResponse<never>(response);
      return {
        data: await response.arrayBuffer(),
        contentType: response.headers.get('content-type'),
        headers: response.headers,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async post<T>(path: string, data?: any, options: { headers?: Record<string, string> } = {}): Promise<T> {
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
        headers: { ...this.getHeaders(), ...options.headers },
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

  /**
   * POSTs JSON and answers with the response once its headers arrive, its body a server-sent
   * event stream still to be read. The client's timeout bounds only the wait for the headers: a
   * stream lasts as long as its turn. `signal` aborts the request and the stream.
   */
  async postStream(
    path: string,
    data: unknown,
    options: { signal?: AbortSignal; headers?: Record<string, string> } = {},
  ): Promise<{ response: Response; abort: () => void }> {
    const url = new URL(path, this.baseURL);
    this.log('info', 'Making POST (stream) request', { url: url.toString() });
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeoutId = setTimeout(abort, this.timeout);
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { ...this.getHeaders(), ...options.headers, 'Accept': 'text/event-stream' },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      if (!response.ok) await this.handleResponse<never>(response);
      if (!response.body) throw new Error(`POST ${url.pathname} answered ${response.status} with no body`);
      return { response, abort };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * POSTs JSON and reads the server-sent event stream it answers with: each event's `data`,
   * parsed as JSON, until the stream ends or sends `[DONE]`.
   */
  async postEventStream<T>(path: string, data?: any): Promise<ReadableStream<T>> {
    const { response } = await this.postStream(path, data);
    const events = parseServerSentEvents(response.body!);
    return new ReadableStream<T>({
      async pull(controller) {
        const next = await events.next();
        // OpenAI-style streams end with a `[DONE]` sentinel, which is not JSON.
        if (next.done || next.value.data === '[DONE]') controller.close();
        else controller.enqueue(JSON.parse(next.value.data) as T);
      },
      async cancel() {
        await events.return(undefined);
      },
    });
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
