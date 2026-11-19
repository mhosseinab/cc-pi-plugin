#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readInput, validate, RUN_COMMANDS, COMMANDS } from './lib/input.mjs';
import {
  listJobs,
  readJob,
  snapshot,
  stateDirectory,
  workspace,
  jobDirectory,
  atomicJSON,
} from './lib/state.mjs';
import { binary, inspect, runArgs, publicModel } from './lib/pi.mjs';
import { PiRPC } from './lib/rpc.mjs';
import { run } from './lib/runner.mjs';

async function discover(command, root) {
  const controller = new AbortController();
  let rpc;
  const interrupted = () => {
    controller.abort(new Error('Runner interrupted.'));
    rpc?.fail(controller.signal.reason);
  };
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pi-discovery-'));
  try {
    const info = await inspect(root, process.env, controller.signal);
    controller.signal.throwIfAborted();
    rpc = new PiRPC(binary(), runArgs({}, { sessionDirectory: directory, ephemeral: true }), {
      cwd: root,
    });
    const available = await rpc.request('get_available_models');
    if (!Array.isArray(available?.models)) throw new Error('Pi returned an invalid model catalog.');
    const current = await rpc.request('get_state');
    const result = {
      ...info,
      root,
      models: available.models.map(publicModel),
      selectedModel: publicModel(current?.model),
      thinking: current?.thinkingLevel ?? null,
      authentication: 'not_verified',
      note: 'No model prompt was sent. A small task verifies provider access. The user Pi profile is trusted; global package resolution and credential helpers may run.',
    };
    const exit = await rpc.close();
    if (exit.error || exit.code !== 0)
      throw exit.error ?? new Error(`Pi discovery exited ${exit.code}.`);
    if (command === 'setup')
      result.workerPolicy = {
        projectConfiguration: 'ignored_by_default',
        extensions: false,
        mcp: false,
        sandbox: false,
      };
    return result;
  } finally {
    if (rpc) await rpc.close();
    fs.rmSync(directory, { recursive: true, force: true });
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
  }
}

async function main() {
  const command = process.argv[2];
  if (command === '--help' || !command) {
    console.log(
      `Usage: node companion.mjs <${COMMANDS.join('|')}>\nSupply one JSON object on stdin. See RUNTIME.md.`,
    );
    return;
  }
  if (process.argv.length > 3)
    throw new Error('Supply options as JSON on stdin, not shell arguments.');
  const input = validate(command, await readInput(process.stdin));
  const root = workspace(input.cwd);
  if (['setup', 'models'].includes(command)) return discover(command, root);
  const state = stateDirectory(root);
  if (RUN_COMMANDS.includes(command)) {
    const result = await run(command, input, root, state);
    if (result.status !== 'completed') process.exitCode = 1;
    return result;
  }
  if (command === 'status') {
    const jobs = input.job ? [readJob(state, input.job)] : listJobs(state).slice(0, 20);
    return {
      root,
      stateDirectory: state,
      jobs: jobs.map((job) => {
        const { text, ...rest } = snapshot(job);
        return { ...rest, outputCharacters: text.length };
      }),
    };
  }
  const job = snapshot(readJob(state, input.job));
  if (command === 'result') return job;
  const active = ['starting', 'running'].includes(job.status);
  if (command === 'cancel') {
    if (active)
      fs.writeFileSync(path.join(jobDirectory(state, job.id), 'cancel'), '', {
        mode: 0o600,
        flag: 'a',
      });
    return {
      id: job.id,
      status: job.status,
      cancellationRequested: active,
      note: 'Check status for the final outcome. File changes are not rolled back.',
    };
  }
  if (!active)
    throw new Error('Cannot steer a finished job. Resume it explicitly with task and resume.');
  const dir = path.join(jobDirectory(state, job.id), 'controls');
  if (fs.readdirSync(dir).length + (job.controls?.length ?? 0) >= 100)
    throw new Error('Job steering limit reached (100 messages).');
  const requestID = randomBytes(16).toString('hex');
  atomicJSON(path.join(dir, `${Date.now()}-${requestID}.json`), {
    id: requestID,
    prompt: input.prompt,
  });
  return {
    id: job.id,
    requestID,
    deliveryRequested: true,
    note: 'Status/result controls show whether Pi queued the message. A request is not proof the worker used it; inspect the result.',
  };
}

try {
  const result = await main();
  if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = 1;
}
