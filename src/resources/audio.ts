import { HTTPClient, type BinaryResponse } from '../client/http-client.js';
import type { SpeechFormat } from '../types/index.js';

export interface CreateSpeechRequest {
  /** A speech model from `GET /v1/models` (`ragwalla.kind: 'speech'`). */
  model: string;
  /** At most the model's character limit; a longer input is refused. */
  input: string;
  /** One of the model's voices. */
  voice: string;
  /** Default `mp3`. `pcm` is 24 kHz, 16-bit mono. */
  response_format?: SpeechFormat;
}

export interface SpeechResponse extends BinaryResponse {
  /** The audio's sample rate in Hz (`x-ragwalla-sample-rate`). */
  sampleRate: number;
  /** The gateway's record of the call, readable at `GET /v1/generation?id=`. */
  generationId: string | null;
}

export interface CreateTranscriptionRequest {
  /** A transcription model from `GET /v1/models` (`ragwalla.kind: 'transcription'`). */
  model: string;
  /** At most 25 MB. */
  file: Blob;
  filename?: string;
  language?: string;
}

export interface Transcription {
  text: string;
  usage?: { type: 'duration'; seconds: number };
}

/**
 * The gateway's speech routes (`/v1/audio/*`), OpenAI-compatible: synthesis with ElevenLabs and
 * Deepgram, transcription with the catalogue's transcription models, billed as every model call.
 */
export class AudioResource {
  public readonly speech: { create: (request: CreateSpeechRequest) => Promise<SpeechResponse> };
  public readonly transcriptions: { create: (request: CreateTranscriptionRequest) => Promise<Transcription> };

  constructor(private client: HTTPClient) {
    this.speech = {
      create: async (request) => {
        const response = await this.client.postBinary('/v1/audio/speech', request);
        return {
          ...response,
          sampleRate: Number(response.headers.get('x-ragwalla-sample-rate')),
          generationId: response.headers.get('x-ragwalla-generation-id'),
        };
      },
    };
    this.transcriptions = {
      create: async (request) => {
        const form = new FormData();
        form.append('model', request.model);
        form.append('file', request.file, request.filename ?? 'audio');
        if (request.language !== undefined) form.append('language', request.language);
        form.append('response_format', 'json');
        return this.client.postFormData<Transcription>('/v1/audio/transcriptions', form);
      },
    };
  }
}
