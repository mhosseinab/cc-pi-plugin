import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'];
const READ_LIMIT = 32 * 1024 * 1024;
const LINE_LIMIT = 4 * 1024 * 1024;
const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const identity = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;
const hitRate = (tokens) => {
  const input = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return input > 0 ? tokens.cacheRead / input : null;
};

function bucket() {
  return { records: 0, tokens: zeroTokens(), cost: 0, costSources: new Set(), missingCost: false };
}

const copyBucket = (value) => ({
  ...value,
  tokens: { ...value.tokens },
  costSources: new Set(value.costSources),
});

function summarize(value) {
  const sources = [...value.costSources];
  return {
    records: value.records,
    tokens: { ...value.tokens },
    cost: value.missingCost ? null : sources.length ? value.cost : value.records ? null : 0,
    costSource: value.missingCost
      ? 'unknown'
      : sources.length > 1
        ? 'mixed'
        : (sources[0] ?? 'unknown'),
  };
}

/** Aggregate normalized Pi usage once, without guessing attribution or provider bills. */
class UsageTotals {
  constructor() {
    this.total = bucket();
    this.assistant = zeroTokens();
    this.groups = new Map();
    this.warnings = new Set();
    this.assistantRecords = 0;
  }

  add(entry) {
    let kind, provider, model, usage;
    if (entry?.type === 'message') {
      const message = entry.message;
      if (!['assistant', 'toolResult'].includes(message?.role)) return;
      if (message.role === 'toolResult' && message.usage === undefined) return;
      kind = message.role === 'assistant' ? 'assistant' : 'tool';
      usage = message.usage;
      // Tool and summary usage can combine several models. Do not guess the current one.
      if (kind === 'assistant') {
        provider = identity(message.provider);
        model = identity(message.responseModel ?? message.model);
      }
    } else if (entry?.type === 'usage') {
      kind = identity(entry.kind) ?? 'other';
      provider = identity(entry.provider);
      model = identity(entry.model);
      usage = entry.usage;
    } else if (['compaction', 'branch_summary'].includes(entry?.type)) {
      if (entry.usage === undefined) return;
      kind = entry.type;
      usage = entry.usage;
    } else return;

    if (!usage || !TOKEN_KEYS.every((key) => Number.isSafeInteger(usage[key]) && usage[key] >= 0)) {
      this.warnings.add('Some usage records have missing or invalid token counters.');
      this.total.missingCost = true;
      return;
    }
    const tokens = Object.fromEntries(TOKEN_KEYS.map((key) => [key, usage[key]]));
    // reasoning and cacheWrite1h are subsets, not additional tokens.
    tokens.total = TOKEN_KEYS.reduce((sum, key) => sum + tokens[key], 0);
    if (
      !Number.isSafeInteger(tokens.total) ||
      !Number.isSafeInteger(this.total.tokens.total + tokens.total)
    ) {
      this.warnings.add('Some usage totals exceed the safe numeric range.');
      this.total.missingCost = true;
      return;
    }
    const key = JSON.stringify([kind, provider ?? null, model ?? null]);
    if (!this.groups.has(key)) {
      if (this.groups.size >= 256) {
        this.warnings.add('Usage breakdown exceeds 256 groups; remaining records are omitted.');
        this.total.missingCost = true;
        return;
      }
      this.groups.set(key, { kind, provider: provider ?? null, model: model ?? null, ...bucket() });
    }
    const group = this.groups.get(key);
    const validCost = Number.isFinite(usage.cost?.total) && usage.cost.total >= 0;
    if (!validCost) this.warnings.add('Some usage records have no valid cost total.');
    const costSource = usage.cost?.totalFromProvider === true ? 'provider' : 'estimated';
    for (const value of [this.total, group]) {
      value.records++;
      for (const token of [...TOKEN_KEYS, 'total']) value.tokens[token] += tokens[token];
      if (validCost && Number.isFinite(value.cost + usage.cost.total)) {
        value.cost += usage.cost.total;
        value.costSources.add(costSource);
      } else {
        value.missingCost = true;
        if (validCost) this.warnings.add('Some usage costs exceed the safe numeric range.');
      }
    }
    if (kind === 'assistant') {
      this.assistantRecords++;
      for (const token of [...TOKEN_KEYS, 'total']) this.assistant[token] += tokens[token];
      if (tokens.total === 0)
        this.warnings.add(
          'Pi reported zero tokens for an assistant response; usage may be unavailable.',
        );
    }
  }

  withPending(message) {
    if (!message?.usage) return this;
    const copy = new UsageTotals();
    copy.total = copyBucket(this.total);
    copy.assistant = { ...this.assistant };
    copy.groups = new Map([...this.groups].map(([key, value]) => [key, copyBucket(value)]));
    copy.warnings = new Set(this.warnings);
    copy.assistantRecords = this.assistantRecords;
    copy.add({ type: 'message', message });
    return copy;
  }

  report(source, complete, warnings = []) {
    const allWarnings = [...new Set([...warnings, ...this.warnings])];
    return {
      scope: 'job',
      source,
      complete: complete && allWarnings.length === 0,
      ...summarize(this.total),
      ...(!this.total.records && source !== 'none' ? { cost: null } : {}),
      assistantCacheHitRate: hitRate(this.assistant),
      breakdown: [...this.groups.values()].map((group) => ({
        kind: group.kind,
        provider: group.provider,
        model: group.model,
        ...summarize(group),
        cacheHitRate: hitRate(group.tokens),
      })),
      warnings: allWarnings,
    };
  }
}

function openSession(file, directory, sessionID) {
  if (path.dirname(fs.realpathSync(file)) !== fs.realpathSync(directory))
    throw new Error('Usage session path is outside its assigned directory.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('Usage session is not a regular file.');
    const header = Buffer.alloc(Math.min(stat.size, 16384));
    fs.readSync(fd, header, 0, header.length, 0);
    const end = header.indexOf(10);
    if (end < 0) throw new Error('Usage session has no complete header.');
    const parsed = JSON.parse(header.subarray(0, end).toString('utf8'));
    if (parsed.type !== 'session' || parsed.version !== 3 || parsed.id !== sessionID)
      throw new Error('Usage session identity or format does not match.');
    return { fd, stat };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function anchor(fd, offset) {
  const buffer = Buffer.alloc(Math.min(offset, 1024));
  fs.readSync(fd, buffer, 0, buffer.length, offset - buffer.length);
  if (buffer.length && buffer.at(-1) !== 10)
    throw new Error('Usage session baseline ends with an incomplete entry.');
  return hash(buffer);
}

/** Freeze the actual shared session boundary, not the totals saved by an earlier job. */
export class JobUsage {
  constructor() {
    this.events = new UsageTotals();
    this.started = false;
    this.cursor = null;
    this.warning = null;
    this.eventEntryIDs = new Set();
  }

  start(job) {
    this.started = true;
    this.file = job.sessionFile;
    this.directory = job.sessionDirectory;
    this.sessionID = job.sessionID;
    let opened;
    try {
      opened = openSession(this.file, this.directory, this.sessionID);
      const { fd, stat } = opened;
      this.cursor = {
        offset: stat.size,
        dev: stat.dev,
        ino: stat.ino,
        anchor: anchor(fd, stat.size),
      };
    } catch (error) {
      if (error.code === 'ENOENT' && !job.resume) this.cursor = { offset: 0 };
      else this.warning = 'Could not establish the session usage boundary before this job.';
    } finally {
      if (opened) fs.closeSync(opened.fd);
    }
  }

  observe(event) {
    if (!this.started) return;
    if (event.type === 'message_start' && event.message?.role === 'assistant') {
      this.pending = {
        role: 'assistant',
        provider: event.message.provider,
        model: event.message.model,
        responseModel: event.message.responseModel,
        usage: event.message.usage,
      };
    }
    // Pi sends cumulative usage snapshots while streaming, never usage deltas.
    if (event.type === 'message_update' && event.usage) {
      this.pending ??= { role: 'assistant' };
      this.pending.usage = event.usage;
    }
    if (event.type === 'message_end') {
      this.events.add({ type: 'message', message: event.message });
      if (event.message?.role === 'assistant') this.pending = null;
    }
    // Cache warming emits the persisted usage entry. Never also count it from the ledger.
    if (event.type === 'entry_appended' && event.entry?.type === 'usage') {
      const id = event.entry.id;
      if (id && this.eventEntryIDs.has(id)) return;
      if (id) this.eventEntryIDs.add(id);
      this.events.add(event.entry);
    }
  }

  snapshot() {
    return this.events
      .withPending(this.pending)
      .report(
        this.started ? 'rpc_events' : 'none',
        !this.started,
        this.started ? ['Usage is still being collected; these are observed records only.'] : [],
      );
  }

  finish(status) {
    if (!this.started) return this.events.report('none', true);
    const warnings = [];
    if (status !== 'completed')
      warnings.push('The job did not complete; unreported provider usage may be missing.');
    let opened;
    try {
      if (!this.cursor) throw new Error(this.warning);
      opened = openSession(this.file, this.directory, this.sessionID);
      const { fd, stat } = opened;
      const { offset } = this.cursor;
      if (
        stat.size < offset ||
        (offset > 0 &&
          (stat.dev !== this.cursor.dev ||
            stat.ino !== this.cursor.ino ||
            anchor(fd, offset) !== this.cursor.anchor))
      )
        throw new Error('Usage session was replaced, truncated, or rewritten during this job.');
      if (stat.size - offset > READ_LIMIT)
        throw new Error('New session data exceeds the 32 MiB usage limit.');
      const totals = new UsageTotals();
      let position = offset;
      let pending = Buffer.alloc(0);
      const buffer = Buffer.alloc(65536);
      while (position < stat.size) {
        const length = fs.readSync(
          fd,
          buffer,
          0,
          Math.min(buffer.length, stat.size - position),
          position,
        );
        if (!length) throw new Error('Usage session changed while being read.');
        position += length;
        pending = Buffer.concat([pending, buffer.subarray(0, length)]);
        let end;
        while ((end = pending.indexOf(10)) >= 0) {
          if (end > LINE_LIMIT) throw new Error('Session usage entry exceeds 4 MiB.');
          if (end > 0) totals.add(JSON.parse(pending.subarray(0, end).toString('utf8')));
          pending = pending.subarray(end + 1);
        }
        if (pending.length > LINE_LIMIT) throw new Error('Session usage entry exceeds 4 MiB.');
      }
      if (pending.length) throw new Error('Usage session ends with an incomplete entry.');
      if (this.pending?.usage || totals.assistantRecords < this.events.assistantRecords)
        throw new Error('Some observed assistant usage was not persisted in the session.');
      if (!totals.total.records) warnings.push('No usage records were reported for this job.');
      return totals.report('session_entries', status === 'completed', warnings);
    } catch {
      warnings.push(
        this.warning ??
          'Session usage could not be read safely; only observed RPC usage is included.',
      );
      const observed = this.events.withPending(this.pending);
      if (!observed.total.records) warnings.push('No usage records were reported for this job.');
      return observed.report('rpc_events', false, warnings);
    } finally {
      if (opened) fs.closeSync(opened.fd);
    }
  }
}
