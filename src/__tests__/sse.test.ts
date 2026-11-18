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

  /** A stream that sends `text`, then fails as a dropped connection does. */
  const dropping = (text: string) => {
    let sent = false;
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) controller.error(new TypeError('network error'));
        else controller.enqueue(new TextEncoder().encode(text));
        sent = true;
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  };

  const event = (id: string, type: string, extra = '') =>
    `id: ${id}\nevent: ${type}\ndata: {"type":"${type}","event_id":"${id}","turn_id":"run_1"${extra}}\n\n`;

  it('reconnects after a dropped connection from the last event it saw', async () => {
    fetchMock
      .mockResolvedValueOnce(dropping('retry: 1\n\n' + event('evt_run_1_0_0', 'agent.session.turn.created') + event('evt_run_1_1_0', 'agent.session.turn.output_text.delta', ',"delta":"Hel"')))
      .mockResolvedValueOnce(sse('retry: 1\n\n' + event('evt_run_1_2_0', 'agent.session.turn.output_text.delta', ',"delta":"lo"') + event('evt_run_1_3_0', 'agent.session.turn.completed')));
    const stream = await runs().stream('agent 1', { input: 'Hello' });
    const ids: string[] = [];
    for await (const e of stream) ids.push(e.event_id);
    expect(ids).toEqual(['evt_run_1_0_0', 'evt_run_1_1_0', 'evt_run_1_2_0', 'evt_run_1_3_0']);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://x.ragwalla.com/v1/agents/agent%201/runs/run_1/events');
    expect(init!.method).toBe('GET');
    expect((init!.headers as Record<string, string>)['Last-Event-ID']).toBe('evt_run_1_1_0');
  });

  it('reconnects when the connection closes before the run\'s stream ends', async () => {
    fetchMock
      .mockResolvedValueOnce(sse('retry: 1\n\n' + event('evt_run_1_0_0', 'agent.session.turn.created')))
      .mockResolvedValueOnce(sse(event('evt_run_1_1_0', 'agent.session.requires_action')));
    const types: string[] = [];
    for await (const e of await runs().stream('a1', { input: 'Hello' })) types.push(e.type);
    expect(types).toEqual(['agent.session.turn.created', 'agent.session.requires_action']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up with the error Ragwalla answers a reconnect it cannot serve with', async () => {
    fetchMock
      .mockResolvedValueOnce(dropping('retry: 1\n\n' + event('evt_run_1_0_0', 'agent.session.turn.created')))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'gone', code: 'stream_resume_unavailable' } }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      }));
    const stream = await runs().stream('a1', { input: 'Hello' });
    const read = (async () => { for await (const _ of stream) { /* read */ } })();
    await expect(read).rejects.toMatchObject({ status: 409, code: 'stream_resume_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after reconnects in a row that bring nothing new', async () => {
    fetchMock
      .mockResolvedValueOnce(dropping('retry: 1\n\n' + event('evt_run_1_0_0', 'agent.session.turn.created')))
      .mockRejectedValue(new TypeError('network error'));
    const stream = await runs().stream('a1', { input: 'Hello' }, { maxReconnects: 2 });
    const read = (async () => { for await (const _ of stream) { /* read */ } })();
    await expect(read).rejects.toThrow('network error');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws a dropped stream it has no id to resume from', async () => {
    fetchMock.mockResolvedValueOnce(dropping('data: {"type":"x","event_id":"e1"}\n\n'));
    const stream = await runs().stream('a1', { input: 'Hello' });
    const read = (async () => { for await (const _ of stream) { /* read */ } })();
    await expect(read).rejects.toThrow('network error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads a run\'s events after the id a browser reconnected with', async () => {
    fetchMock.mockResolvedValueOnce(sse(event('evt_run_1_3_0', 'agent.session.turn.completed')));
    const stream = await runs().events('a1', 'run 1', { lastEventId: 'evt_run_1_2_0' });
    expect(await new Response(stream.toReadableStream()).text()).toContain('evt_run_1_3_0');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x.ragwalla.com/v1/agents/a1/runs/run%201/events');
    expect((init!.headers as Record<string, string>)['Last-Event-ID']).toBe('evt_run_1_2_0');
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
