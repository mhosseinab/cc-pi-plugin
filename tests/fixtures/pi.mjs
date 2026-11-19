#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  if (process.env.FAKE_VERSION_HANG) setInterval(() => {}, 1000);
  else {
    console.log(process.env.FAKE_VERSION || '1.5.2');
    process.exit(0);
  }
} else {
  const option = (key) => args[args.indexOf(key) + 1];
  const directory = option('--session-dir');
  let sessionID = args.includes('--session-id') ? option('--session-id') : randomUUID();
  let sessionFile = path.join(directory, `fixture_${sessionID}.jsonl`);
  if (args.includes('--session')) {
    sessionFile = option('--session');
    sessionID = JSON.parse(fs.readFileSync(sessionFile, 'utf8').split('\n')[0]).id;
  }
  const entries = fs.existsSync(sessionFile)
    ? fs.readFileSync(sessionFile, 'utf8').trim().split('\n').map(JSON.parse)
    : [];
  let leafId = entries.at(-1)?.type === 'session' ? null : (entries.at(-1)?.id ?? null);
  const ensureSession = () => {
    if (entries.length) return;
    const header = {
      type: 'session',
      version: 3,
      id: sessionID,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    entries.push(header);
    if (!process.env.FAKE_NO_SESSION) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, { mode: 0o600 });
    }
  };
  const appendEntry = (data) => {
    ensureSession();
    const entry = {
      ...data,
      id: randomUUID().slice(0, 8),
      parentId: leafId,
      timestamp: new Date().toISOString(),
    };
    entries.push(entry);
    leafId = entry.id;
    if (!process.env.FAKE_NO_SESSION) fs.appendFileSync(sessionFile, `${JSON.stringify(entry)}\n`);
    return entry;
  };
  const usage = (overrides = {}) => {
    const value = {
      input: 12,
      output: 5,
      cacheRead: 24,
      cacheWrite: 4,
      cost: {
        input: 0.125,
        output: 0.25,
        cacheRead: 0.0625,
        cacheWrite: 0.0625,
        total: 0.5,
        totalFromProvider: false,
      },
      ...overrides,
    };
    value.totalTokens = value.input + value.output + value.cacheRead + value.cacheWrite;
    return value;
  };
  let model = {
    provider: 'test',
    id: 'model',
    reasoning: true,
    headers: { Authorization: 'fixture-secret' },
  };
  let thinkingLevel = 'off';
  let hold,
    active = false,
    scenario = '';
  const requests = [];
  const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  const record = () => {
    if (process.env.FAKE_RECORD)
      fs.writeFileSync(
        process.env.FAKE_RECORD,
        JSON.stringify({
          args,
          requests,
          prompt: requests.find((r) => r.type === 'prompt')?.message,
          cwd: process.cwd(),
          pwd: process.env.PWD,
        }),
      );
  };
  const respond = (request, data, error) =>
    emit({
      id: request.id,
      type: 'response',
      command: request.type,
      success: !error,
      ...(error ? { error } : { data }),
    });
  const publishAssistant = (stopReason, text, errorMessage = 'bad credentials') => {
    const message = {
      role: 'assistant',
      api: 'openai-completions',
      provider: model.provider,
      model: model.id,
      content: [{ type: 'text', text }],
      usage: usage(),
      stopReason,
      timestamp: Date.now(),
      ...(stopReason === 'error' ? { errorMessage } : {}),
    };
    appendEntry({ type: 'message', message });
    emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } });
    emit({ type: 'message_end', message });
    return message;
  };
  const finish = (stopReason = 'stop', text = 'Fixture response ✓') => {
    if (!active) return;
    active = false;
    clearInterval(hold);
    const message = publishAssistant(stopReason, text);
    emit({ type: 'agent_end', messages: [message], willRetry: false });
    emit({ type: 'agent_settled', aborted: stopReason === 'aborted' });
  };
  const stats = () => {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let cost = 0;
    for (const entry of entries) {
      const value = entry.type === 'message' ? entry.message.usage : entry.usage;
      if (!value) continue;
      for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'])
        tokens[field] += value[field];
      cost += value.cost.total;
    }
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    return { sessionId: sessionID, sessionFile, tokens, cost };
  };
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', (line) => {
    const request = JSON.parse(line);
    requests.push(request);
    record();
    if (request.type === 'get_available_models') return respond(request, { models: [model] });
    if (request.type === 'get_state') {
      if (process.env.FAKE_PREFLIGHT_HANG) {
        hold ??= setInterval(() => {}, 1000);
        return;
      }
      return respond(request, {
        model,
        thinkingLevel,
        sessionId: sessionID,
        sessionFile,
        isStreaming: active,
      });
    }
    if (request.type === 'set_model') {
      if (request.provider !== 'test' || !['model', 'another/model'].includes(request.modelId))
        return respond(request, undefined, 'Model not found');
      if (!process.env.FAKE_FALLBACK)
        model = { ...model, provider: request.provider, id: request.modelId };
      return respond(request, model);
    }
    if (request.type === 'get_available_thinking_levels')
      return respond(request, { levels: ['off', 'low', 'medium', 'high'] });
    if (request.type === 'set_thinking_level') {
      thinkingLevel = process.env.FAKE_CLAMP ? 'off' : request.level;
      return respond(request);
    }
    if (request.type === 'get_session_stats') return respond(request, stats());
    if (request.type === 'clear_queue') return respond(request, { steering: [], followUp: [] });
    if (request.type === 'abort') {
      if (scenario === 'DESCENDANT') return;
      if (active) finish('aborted');
      clearInterval(hold);
      return respond(request);
    }
    if (request.type === 'steer') {
      respond(request, { disposition: 'queued' });
      if (scenario === 'STEER_WAIT')
        setTimeout(() => finish('stop', `Steered: ${request.message}`), 20);
      return;
    }
    if (request.type === 'extension_ui_response') return;
    if (request.type !== 'prompt') return respond(request, undefined, 'Unknown command');
    ensureSession();
    active = true;
    scenario = request.message;
    respond(request, { disposition: scenario === 'HANDLED' ? 'handled' : 'started' });
    if (scenario === 'HANDLED') return;
    appendEntry({
      type: 'message',
      message: { role: 'user', content: request.message, timestamp: Date.now() },
    });
    if (scenario === 'MALFORMED') {
      process.stdout.write('{broken}\n');
      return;
    }
    if (scenario === 'EXIT_FAIL') {
      process.stderr.write('provider unavailable');
      process.exit(2);
    }
    if (scenario === 'INCOMPLETE') {
      emit({ type: 'agent_end', messages: [], willRetry: false });
      process.exit(0);
    }
    if (scenario === 'ERROR_ZERO') return finish('error');
    if (scenario === 'LENGTH') return finish('length');
    if (scenario === 'DENIED') {
      emit({ type: 'extension_ui_request', id: 'dialog', method: 'confirm', title: 'Permission' });
      return;
    }
    if (scenario === 'RETRY') {
      publishAssistant('error', '', 'retryable');
      emit({ type: 'agent_end', messages: [], willRetry: true });
      return setTimeout(() => finish(), 100);
    }
    if (scenario === 'USAGE_OVERHEAD') {
      const warm = appendEntry({
        type: 'usage',
        kind: 'cache_warm',
        provider: model.provider,
        model: model.id,
        usage: usage({
          input: 0,
          output: 1,
          cacheRead: 80,
          cacheWrite: 0,
          cost: {
            input: 0,
            output: 0.0625,
            cacheRead: 0.0625,
            cacheWrite: 0,
            total: 0.125,
            totalFromProvider: false,
          },
        }),
      });
      emit({ type: 'entry_appended', entry: warm });
      appendEntry({
        type: 'compaction',
        summary: 'Earlier fixture context',
        firstKeptEntryId: leafId,
        tokensBefore: 1000,
        usage: usage({
          input: 6,
          output: 2,
          cacheRead: 0,
          cacheWrite: 2,
          cost: {
            input: 0.125,
            output: 0.0625,
            cacheRead: 0,
            cacheWrite: 0.0625,
            total: 0.25,
            totalFromProvider: false,
          },
        }),
      });
    }
    if (scenario === 'DESCENDANT') {
      const child = spawn(
        process.execPath,
        [
          '-e',
          'process.on("SIGTERM",()=>{}); const fs=require("node:fs"); if(process.env.FAKE_HEARTBEAT) { fs.writeFileSync(process.env.FAKE_CHILD_PID,String(process.pid)); setInterval(()=>fs.writeFileSync(process.env.FAKE_HEARTBEAT,String(Date.now())),20); } setInterval(()=>{},1000);',
        ],
        { stdio: 'ignore' },
      );
      child.unref();
      hold = setInterval(() => {}, 1000);
      return;
    }
    if (scenario === 'HANG' || scenario === 'STEER_WAIT') {
      hold = setInterval(() => {}, 1000);
      return;
    }
    finish();
  });
  input.on('close', () => {
    clearInterval(hold);
    process.exit(0);
  });
}
