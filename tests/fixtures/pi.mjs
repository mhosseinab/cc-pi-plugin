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
  const finish = (stopReason = 'stop', text = 'Fixture response ✓') => {
    active = false;
    clearInterval(hold);
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text }],
      stopReason,
      ...(stopReason === 'error' ? { errorMessage: 'bad credentials' } : {}),
    };
    emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } });
    emit({ type: 'message_end', message });
    emit({ type: 'agent_end', messages: [message], willRetry: false });
    emit({ type: 'agent_settled', aborted: stopReason === 'aborted' });
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
    if (request.type === 'get_session_stats')
      return respond(request, { tokens: { input: 12, output: 5 }, cost: 0 });
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
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(sessionFile))
      fs.writeFileSync(
        sessionFile,
        `${JSON.stringify({ type: 'session', id: sessionID, cwd: process.cwd(), version: 3 })}\n`,
      );
    active = true;
    scenario = request.message;
    respond(request, { disposition: scenario === 'HANDLED' ? 'handled' : 'started' });
    if (scenario === 'HANDLED') return;
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
      emit({
        type: 'message_end',
        message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'retryable' },
      });
      emit({ type: 'agent_end', messages: [], willRetry: true });
      return setTimeout(() => finish(), 100);
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
