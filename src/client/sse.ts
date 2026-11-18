/**
 * A server-sent event stream parser that follows the WHATWG HTML standard's algorithm (§9.2.6,
 * "Interpreting an event stream"): lines end at CRLF, LF or CR, wherever the network splits
 * them; a line starting with `:` is a comment (a heartbeat) and is ignored; `data:` lines are
 * joined with LF; `id:` sets the last event id, kept across events; `retry:` sets the reconnection
 * time; an event is dispatched at a blank line when it has data, and an event the stream ends in
 * the middle of is dropped.
 */

export interface ServerSentEvent {
  /** The `event:` field, or `message` when the event has none. */
  event: string;
  /** The `data:` lines, joined with LF. */
  data: string;
  /** The last event id the stream set (an `id:` on this event or an earlier one), `''` when none. */
  lastEventId: string;
  /** The reconnection time in milliseconds the stream last set with `retry:`, or null. */
  retry: number | null;
}

const BOM = '﻿';

export async function* parseServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let started = false;
  let data = '';
  let hasData = false;
  let eventType = '';
  let lastEventId = '';
  let retry: number | null = null;

  const line = (text: string): ServerSentEvent | null => {
    if (text === '') {
      if (!hasData) {
        eventType = '';
        return null;
      }
      const event = { event: eventType || 'message', data, lastEventId, retry };
      data = '';
      hasData = false;
      eventType = '';
      return event;
    }
    if (text.startsWith(':')) return null;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      eventType = value;
    } else if (field === 'data') {
      data = hasData ? `${data}\n${value}` : value;
      hasData = true;
    } else if (field === 'id') {
      if (!value.includes('\0')) lastEventId = value;
    } else if (field === 'retry') {
      if (/^[0-9]+$/.test(value)) retry = Number(value);
    }
    return null;
  };

  let ended = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        ended = true;
        buffer += decoder.decode();
        // A CR held back in case an LF followed ends its line; a line with no end is no line.
        if (buffer.endsWith('\r')) {
          const event = line(buffer.slice(0, -1));
          if (event) yield event;
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      if (!started && buffer.length > 0) {
        started = true;
        if (buffer.startsWith(BOM)) buffer = buffer.slice(1);
      }
      for (;;) {
        const end = buffer.search(/[\r\n]/);
        if (end === -1) break;
        // A CR last in the buffer may be the first half of a CRLF the next chunk completes.
        if (buffer[end] === '\r' && end === buffer.length - 1) break;
        const width = buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1;
        const event = line(buffer.slice(0, end));
        buffer = buffer.slice(end + width);
        if (event) yield event;
      }
    }
  } finally {
    // A reader that stopped early (a `break`, a thrown error) closes the connection.
    if (!ended) await reader.cancel();
    reader.releaseLock();
  }
}
