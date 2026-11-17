import { HTTPClient } from '../client/http-client.js';
import { path } from '../client/path.js';
import {
  FileObject,
  FileListResponse,
  FileDeleted,
  UploadFileRequest,
} from '../types/index.js';

export class FilesResource {
  constructor(private client: HTTPClient) {}

  /**
   * Upload a file to ragwalla.
   *
   * @param request.file      - A Blob or File to upload
   * @param request.purpose   - The intended purpose (e.g. "assistants")
   * @param request.metadata  - Optional key-value metadata (max 10 fields)
   */
  async upload(request: UploadFileRequest): Promise<FileObject> {
    const formData = new FormData();
    formData.append('file', request.file);
    formData.append('purpose', request.purpose);

    // Metadata is sent via a custom header, not a form field
    const headers: Record<string, string> = {};
    if (request.metadata) {
      headers['x-ragwalla-metadata'] = JSON.stringify(request.metadata);
    }

    return this.client.postFormData<FileObject>('/v1/files', formData, {
      headers: Object.keys(headers).length > 0 ? headers : undefined
    });
  }

  /**
   * Retrieve a file by ID
   */
  async retrieve(fileId: string): Promise<FileObject> {
    return this.client.get<FileObject>(path`/v1/files/${fileId}`);
  }

  /**
   * List uploaded files
   */
  async list(params?: {
    purpose?: string;
    limit?: number;
    order?: 'asc' | 'desc';
    after?: string;
  }): Promise<FileListResponse> {
    return this.client.get<FileListResponse>('/v1/files', params);
  }

  /**
   * Delete a file
   */
  async delete(fileId: string): Promise<FileDeleted> {
    return this.client.delete<FileDeleted>(path`/v1/files/${fileId}`);
  }
}
