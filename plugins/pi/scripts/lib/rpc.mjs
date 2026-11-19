import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventDecoder } from './events.mjs';
import { terminateProcessGroup } from './process.mjs';
import { safeRecord } from './pi.mjs';

const LOG_LIMIT = 32 * 1024 * 1024;

/** One private RPC subprocess, request correlation, bounded framing, and owned cleanup. */
export class PiRPC {
  constructor(
    binary,
    args,
    { cwd, env = process.env, onEvent = () => {}, onRecord = () => {}, onStderr = () => {} } = {},
  ) {
    this.pending = new Map();
    this.stderr = '';
    this.bytes = 0;
    this.failure = null;
    this.ended = false;
    this.closing = false;
    this.child = spawn(binary, args, {
      cwd,
      env: { ...env, PWD: cwd, NO_COLOR: '1', TERM: 'dumb' },
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const rejectPending = (error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    };
    this.fail = (error) => {
      this.failure ??= error;
      rejectPending(this.failure);
      this.cleanup ??= terminateProcessGroup(this.child);
      this.cleanup.catch(() => {});
    };
    const decoder = new EventDecoder((event) => {
      onRecord(safeRecord(event));
      if (event.type === 'response') {
        const pending = this.pending.get(event.id);
        if (!pending)
          throw new Error(`Unexpected Pi response ID: ${String(event.id).slice(0, 100)}`);
        if (event.command !== pending.command || typeof event.success !== 'boolean')
          throw new Error('Mismatched Pi RPC response.');
        this.pending.delete(event.id);
        clearTimeout(pending.timer);
        if (event.success) pending.resolve(event.data);
        else
          pending.reject(
            new Error(
              `Pi ${event.command}: ${String(event.error ?? 'command failed').slice(0, 4000)}`,
            ),
          );
      } else onEvent(event);
    });
    const count = (chunk) => {
      this.bytes += chunk.length;
      if (this.bytes > LOG_LIMIT) throw new Error('Pi logs exceed 32 MiB.');
    };
    this.child.stdout.on('data', (chunk) => {
      try {
        count(chunk);
        decoder.push(chunk);
      } catch (error) {
        this.fail(error);
      }
    });
    this.child.stderr.on('data', (chunk) => {
      try {
        count(chunk);
        this.stderr = (this.stderr + chunk.toString('utf8')).slice(-8000);
        onStderr(chunk);
      } catch (error) {
        this.fail(error);
      }
    });
    this.child.stdin.on('error', (error) => {
      if (!this.closing) this.fail(error);
    });
    this.child.on('error', (error) => this.fail(error));
    this.closed = new Promise((resolve) => {
      this.child.on('close', (code, signal) => {
        this.ended = true;
        try {
          decoder.end();
        } catch (error) {
          this.failure ??= error;
        }
        rejectPending(
          this.failure ??
            new Error(
              `Pi exited before responding (code ${code}, signal ${signal}). ${this.stderr}`,
            ),
        );
        resolve({ code, signal, error: this.failure });
      });
    });
  }

  write(record) {
    return new Promise((resolve, reject) => {
      if (this.ended || this.closing || this.child.stdin.destroyed)
        return reject(new Error('Pi input is closed.'));
      // The write callback waits for the buffer to flush, respecting stream backpressure.
      this.child.stdin.write(`${JSON.stringify(record)}\n`, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  request(command, fields = {}, timeout = 15000) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.ended || this.closing) return Promise.reject(new Error('Pi RPC process is closed.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Pi RPC ${command} timed out.`)), timeout);
      this.pending.set(id, { command, resolve, reject, timer });
      this.write({ ...fields, id, type: command }).catch((error) => this.fail(error));
    });
  }

  /** EOF is Pi's orderly shutdown; escalate if it or its children remain alive. */
  close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      this.closing = true;
      if (!this.child.stdin.destroyed) this.child.stdin.end();
      const timer = setTimeout(() => {
        this.cleanup ??= terminateProcessGroup(this.child);
        this.cleanup.catch(() => {});
      }, 2000);
      try {
        const result = await this.closed;
        await (this.cleanup ??= terminateProcessGroup(this.child));
        return result;
      } finally {
        clearTimeout(timer);
      }
    })();
    return this.closePromise;
  }
}
