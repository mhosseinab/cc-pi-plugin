import { StringDecoder } from 'node:string_decoder';

export const EVENT_LIMIT = 4 * 1024 * 1024;

/** RPC uses LF-delimited JSON, not general Unicode line separators. */
export class EventDecoder {
  constructor(onEvent) {
    this.decoder = new StringDecoder('utf8');
    this.pending = '';
    this.onEvent = onEvent;
  }
  push(chunk) {
    this.pending += this.decoder.write(chunk);
    this.drain();
    if (Buffer.byteLength(this.pending) > EVENT_LIMIT) throw new Error('Pi event exceeds 4 MiB.');
  }
  drain() {
    let index;
    while ((index = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, index).replace(/\r$/, '');
      this.pending = this.pending.slice(index + 1);
      if (Buffer.byteLength(line) > EVENT_LIMIT) throw new Error('Pi event exceeds 4 MiB.');
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error('Malformed Pi JSON event.');
      }
      if (!event || Array.isArray(event) || typeof event.type !== 'string')
        throw new Error('Invalid Pi event.');
      this.onEvent(event);
    }
  }
  end() {
    this.pending += this.decoder.end();
    if (this.pending) this.pending += '\n';
    this.drain();
  }
}
