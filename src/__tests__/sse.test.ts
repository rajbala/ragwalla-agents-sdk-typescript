import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { parseServerSentEvents, type ServerSentEvent } from '../client/sse';
import { HTTPClient } from '../client/http-client';
import { AgentRunsResource } from '../resources/agent-runs';

const encoder = new TextEncoder();

/** A body that arrives in exactly these network chunks. */
function body(...chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

async function parse(...chunks: Array<string | Uint8Array>): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = [];
  for await (const event of parseServerSentEvents(body(...chunks))) events.push(event);
  return events;
}

describe('parseServerSentEvents', () => {
  it('reads events whatever the network splits them at', async () => {
    const stream = 'event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\n';
    const whole = await parse(stream);
    const byByte = await parse(...stream.split(''));
    expect(whole).toEqual([
      { event: 'a', data: '{"x":1}', lastEventId: '', retry: null },
      { event: 'b', data: '{"y":2}', lastEventId: '', retry: null },
    ]);
    expect(byByte).toEqual(whole);
  });

  it('ends lines at CRLF, CR or LF, a CRLF split between chunks included', async () => {
    expect(await parse('data: 1\r', '\n\r', '\ndata: 2\r\rdata: 3\n\n')).toEqual([
      { event: 'message', data: '1', lastEventId: '', retry: null },
      { event: 'message', data: '2', lastEventId: '', retry: null },
      { event: 'message', data: '3', lastEventId: '', retry: null },
    ]);
  });

  it('skips heartbeat comments, joins data lines and keeps the last id', async () => {
    expect(await parse(': ping\n\nid: 7\nretry: 2000\ndata: a\ndata:b\n\n: ping\n\ndata: c\n\n')).toEqual([
      { event: 'message', data: 'a\nb', lastEventId: '7', retry: 2000 },
      { event: 'message', data: 'c', lastEventId: '7', retry: 2000 },
    ]);
  });

  it('dispatches an event with empty data, but none for an event with no data', async () => {
    expect(await parse('event: x\n\ndata\n\n')).toEqual([
      { event: 'message', data: '', lastEventId: '', retry: null },
    ]);
  });

  it('drops an event the stream ends in the middle of, and a byte order mark', async () => {
    expect(await parse('﻿data: 1\n\ndata: 2\n')).toEqual([
      { event: 'message', data: '1', lastEventId: '', retry: null },
    ]);
  });

  it('decodes a character split between chunks', async () => {
    const bytes = encoder.encode('data: é\n\n');
    expect((await parse(bytes.slice(0, 7), bytes.slice(7)))[0].data).toBe('é');
  });

  it('closes the connection when its reader stops early', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode('data: 1\n\ndata: 2\n\n')); },
      cancel() { cancelled = true; },
    });
    for await (const _event of parseServerSentEvents(stream)) break;
    expect(cancelled).toBe(true);
  });
});

describe('agents.runs', () => {
  const fetchMock = jest.fn<typeof fetch>();
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
    fetchMock.mockReset();
  });

  const runs = () => {
    global.fetch = fetchMock;
    return new AgentRunsResource(new HTTPClient({ apiKey: 'key', baseURL: 'https://x.ragwalla.com/v1' }));
  };

  const sse = (text: string) => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });

  it('streams a run as its session events', async () => {
    fetchMock.mockResolvedValue(sse(
      'event: agent.session.turn.output_text.delta\ndata: {"type":"agent.session.turn.output_text.delta","event_id":"e1","delta":"Hi"}\n\n'
      + ': ping\n\n'
      + 'event: agent.session.idle\ndata: {"type":"agent.session.idle","event_id":"e2"}\n\n',
    ));
    const stream = await runs().stream('agent 1', { input: 'Hello', thread_id: 't1', idempotencyKey: 'k1' });
    const types: string[] = [];
    for await (const event of stream) types.push(event.type);
    expect(types).toEqual(['agent.session.turn.output_text.delta', 'agent.session.idle']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x.ragwalla.com/v1/agents/agent%201/runs');
    expect(JSON.parse(init!.body as string)).toEqual({ input: 'Hello', thread_id: 't1', mode: 'stream' });
    const headers = init!.headers as Record<string, string>;
    expect(headers['Accept']).toBe('text/event-stream');
    expect(headers['Idempotency-Key']).toBe('k1');
  });

  it('passes the stream on as the bytes it arrived as, once', async () => {
    const text = 'data: {"type":"x","event_id":"e1"}\n\n: ping\n\n';
    fetchMock.mockResolvedValue(sse(text));
    const stream = await runs().stream('a1', { input: 'Hello' });
    expect(await new Response(stream.toReadableStream()).text()).toBe(text);
    expect(() => stream.toReadableStream()).toThrow('already been read');
  });

  it('throws the API error a refused stream answers with', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'No agent', type: 'invalid_request_error', code: 'not_found' } }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    }));
    await expect(runs().stream('a1', { input: 'Hello' })).rejects.toMatchObject({ message: 'No agent', status: 404 });
  });

  it('runs and waits, or runs in the background', async () => {
    fetchMock.mockImplementation(async () => new Response('{"id":"run_1"}', { headers: { 'Content-Type': 'application/json' } }));
    const r = runs();
    await r.create('a1', { input: 'Hello' });
    await r.create('a1', { input: 'Hello', background: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ input: 'Hello', mode: 'wait' });
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ input: 'Hello', mode: 'background' });
  });
});
