import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { acquire, atomicJSON, jobDirectory, readJob, snapshot } from './state.mjs';
import { BUILTIN_TOOLS, REVIEW_TOOLS } from './input.mjs';
import { binary, inspect, runArgs, publicModel } from './pi.mjs';
import { PiRPC } from './rpc.mjs';
import { reviewPrompt } from './review.mjs';

const TEXT_LIMIT = 2 * 1024 * 1024;
const ACTIVE = ['starting', 'running'];

function ownedSession(root, state, previous) {
  if (previous.root !== root || previous.command.includes('review'))
    throw new Error("Only this workspace's implementation sessions may be resumed.");
  if (ACTIVE.includes(previous.status)) throw new Error('Cannot resume an active job.');
  if (!previous.sessionID || !previous.sessionFile || !previous.sessionDirectory)
    throw new Error('Job has no resumable Pi session.');
  const directory = fs.realpathSync(previous.sessionDirectory);
  const relative = path.relative(state, directory);
  if (!/^[a-f0-9]{32}[/\\]sessions$/.test(relative))
    throw new Error('Session directory is outside plugin-owned storage.');
  const file = fs.realpathSync(previous.sessionFile);
  if (
    path.dirname(file) !== directory ||
    fs.lstatSync(previous.sessionFile).isSymbolicLink() ||
    !fs.statSync(file).isFile()
  )
    throw new Error('Unsafe session path.');
  const fd = fs.openSync(file, 'r');
  let header;
  try {
    const buffer = Buffer.alloc(16384);
    const n = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const first = buffer.subarray(0, n).toString('utf8').split('\n')[0];
    header = JSON.parse(first);
  } finally {
    fs.closeSync(fd);
  }
  if (
    header.type !== 'session' ||
    header.id !== previous.sessionID ||
    fs.realpathSync(header.cwd) !== root
  )
    throw new Error('Session identity or working directory does not match this job.');
  return file;
}

function verifyState(current, job, requested) {
  if (!current || current.sessionId !== job.sessionID)
    throw new Error('Unexpected Pi session identity.');
  if (
    typeof current.sessionFile !== 'string' ||
    path.dirname(path.resolve(current.sessionFile)) !== job.sessionDirectory
  )
    throw new Error('Pi selected a session outside its assigned directory.');
  if (job.sessionFile && current.sessionFile !== job.sessionFile)
    throw new Error('Pi changed the selected session file.');
  const model = publicModel(current.model);
  if (!model?.provider || !model?.id)
    throw new Error(
      'No Pi model selected. Configure Pi authentication and choose a model with /pi:models.',
    );
  const id = `${model.provider}/${model.id}`;
  if (requested.model && requested.model !== id)
    throw new Error(`Pi selected ${id} instead of ${requested.model}.`);
  if (requested.thinking && requested.thinking !== current.thinkingLevel)
    throw new Error(`Pi changed thinking from ${requested.thinking} to ${current.thinkingLevel}.`);
  job.sessionFile = current.sessionFile;
  job.model = id;
  job.thinking = current.thinkingLevel;
}

export async function run(command, initialInput, root, state) {
  const id = randomBytes(16).toString('hex');
  const release = acquire(state, id);
  const dir = jobDirectory(state, id);
  const review = command.includes('review');
  const controller = new AbortController();
  const { signal } = controller;
  let rpc, timer, poll, cancelPromise, job, stdoutFile, stderrFile;
  let stopping, failure, settled, lastAssistant;
  let controlBusy = false;
  let controlsPromise = Promise.resolve();
  let promptSent = false;
  let resolveSettled, resolveStopped;
  const settledPromise = new Promise((resolve) => {
    resolveSettled = resolve;
  });
  const stoppedPromise = new Promise((resolve) => {
    resolveStopped = resolve;
  });
  const save = () => {
    if (!job) return;
    job.updatedAt = new Date().toISOString();
    atomicJSON(path.join(dir, 'job.json'), job);
  };
  const stop = (status, message) => {
    if (stopping) return;
    stopping = status;
    failure = message;
    controller.abort(new Error(message));
    resolveStopped();
    if (rpc) {
      cancelPromise = (async () => {
        try {
          // Aborting alone can continue queued messages in Pi.
          await rpc.request('clear_queue', {}, 1000);
          await rpc.request('abort', {}, 1500);
        } catch {
          /* Bounded protocol cleanup falls through to owned process cleanup. */
        }
        await rpc.close();
      })();
      cancelPromise.catch(() => {});
    }
  };
  const interrupted = () =>
    stop('cancelled', 'Runner interrupted. Partial file changes may remain.');
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  const controlsDirectory = path.join(dir, 'controls');
  const processControls = async () => {
    if (!rpc || job.status !== 'running' || settled || stopping || controlBusy) return;
    controlBusy = true;
    try {
      for (const name of fs.readdirSync(controlsDirectory).sort()) {
        if (!/^\d{13}-[a-f0-9]{32}\.json$/.test(name)) continue;
        const file = path.join(controlsDirectory, name);
        if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 262144)
          throw new Error('Invalid steering request file.');
        const control = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (
          typeof control.prompt !== 'string' ||
          !control.prompt.trim() ||
          !/^[a-f0-9]{32}$/.test(control.id)
        )
          throw new Error('Invalid steering request.');
        let receipt;
        if (settled || stopping)
          receipt = {
            status: 'not_sent',
            error: 'Worker is no longer running. Resume explicitly to continue.',
          };
        else {
          try {
            const response = await rpc.request('steer', { message: control.prompt });
            receipt =
              response?.disposition === 'queued'
                ? { status: 'queued' }
                : { status: 'not_sent', error: 'Pi did not queue the steering message.' };
          } catch (error) {
            receipt = { status: 'not_sent', error: error.message };
          }
        }
        job.controls.push({ id: control.id, ...receipt, updatedAt: new Date().toISOString() });
        save();
        fs.unlinkSync(file);
      }
    } finally {
      controlBusy = false;
    }
  };
  try {
    let input = { ...initialInput };
    let previous;
    if (input.resume) {
      previous = snapshot(readJob(state, input.resume));
      ownedSession(root, state, previous);
      input = {
        ...input,
        model: input.model ?? previous.model,
        thinking: input.thinking ?? previous.thinking,
        tools: input.tools ?? previous.tools,
      };
    }
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.mkdirSync(controlsDirectory, { mode: 0o700 });
    const sessionDirectory = previous?.sessionDirectory ?? path.join(dir, 'sessions');
    fs.mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
    job = {
      id,
      command,
      root,
      status: 'starting',
      createdAt: new Date().toISOString(),
      ownerPid: process.pid,
      model: input.model ?? null,
      thinking: input.thinking ?? null,
      tools: review ? REVIEW_TOOLS : (input.tools ?? BUILTIN_TOOLS),
      trustProject: input.trustProject === true,
      resume: input.resume ?? null,
      timeoutSeconds: input.timeoutSeconds,
      sessionID: previous?.sessionID ?? randomUUID(),
      sessionFile: previous?.sessionFile ?? null,
      sessionDirectory,
      progress: null,
      text: '',
      error: null,
      controls: [],
      usage: null,
      logDirectory: dir,
    };
    save();
    process.stderr.write(`Pi job ${id}\n`);
    timer = setTimeout(
      () => stop('timed_out', 'Deadline exceeded. Partial file changes may remain.'),
      input.timeoutSeconds * 1000,
    );
    poll = setInterval(() => {
      try {
        if (fs.existsSync(path.join(dir, 'cancel')))
          stop('cancelled', 'Cancellation requested. Partial file changes may remain.');
        save();
        if (!controlBusy)
          controlsPromise = processControls().catch((error) => stop('failed', error.message));
      } catch (error) {
        stop('failed', `Could not persist job: ${error.message}`);
      }
    }, 250);
    const info = await inspect(root, process.env, signal);
    job.piVersion = info.version;
    signal.throwIfAborted();
    const prompt = review
      ? reviewPrompt(root, input, command === 'adversarial-review')
      : input.prompt;
    stdoutFile = fs.openSync(path.join(dir, 'events.jsonl'), 'wx', 0o600);
    stderrFile = fs.openSync(path.join(dir, 'stderr.log'), 'wx', 0o600);
    rpc = new PiRPC(
      binary(),
      runArgs(input, {
        sessionDirectory,
        sessionID: job.sessionID,
        sessionFile: previous?.sessionFile,
        review,
      }),
      {
        cwd: root,
        onRecord: (event) => fs.writeSync(stdoutFile, `${JSON.stringify(event)}\n`),
        onStderr: (chunk) => fs.writeSync(stderrFile, chunk),
        onEvent: (event) => {
          job.progress = event.type;
          if (event.type === 'message_start' && event.message?.role === 'assistant') job.text = '';
          if (
            event.type === 'message_update' &&
            event.assistantMessageEvent?.type === 'text_delta'
          ) {
            job.text += event.assistantMessageEvent.delta ?? '';
          }
          if (event.type === 'message_end' && event.message?.role === 'assistant') {
            lastAssistant = event.message;
            job.text = (lastAssistant.content ?? [])
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n');
          }
          if (Buffer.byteLength(job.text) > TEXT_LIMIT) throw new Error('Pi text exceeds 2 MiB.');
          if (event.type === 'tool_execution_start')
            job.progress = `Tool: ${event.toolName ?? 'unknown'}`;
          if (
            event.type === 'extension_ui_request' &&
            ['select', 'confirm', 'input', 'editor'].includes(event.method)
          ) {
            rpc
              .write({ type: 'extension_ui_response', id: event.id, cancelled: true })
              .catch(() => {});
            stop('blocked', 'Pi requested interaction. The plugin did not approve it.');
          }
          if (event.type === 'agent_settled') {
            if (!promptSent || settled) throw new Error('Unexpected Pi settlement event.');
            settled = event;
            resolveSettled(event);
          }
        },
      },
    );
    if (input.model) {
      const slash = input.model.indexOf('/');
      await rpc.request('set_model', {
        provider: input.model.slice(0, slash),
        modelId: input.model.slice(slash + 1),
      });
    }
    signal.throwIfAborted();
    if (input.thinking) {
      const available = await rpc.request('get_available_thinking_levels');
      if (!available?.levels?.includes(input.thinking))
        throw new Error(
          `Thinking level ${input.thinking} is not supported by this model. Available: ${available?.levels?.join(', ') ?? 'unknown'}.`,
        );
      await rpc.request('set_thinking_level', { level: input.thinking });
    }
    verifyState(await rpc.request('get_state'), job, input);
    signal.throwIfAborted();
    job.status = 'running';
    save();
    promptSent = true;
    const accepted = await rpc.request('prompt', { message: prompt });
    if (accepted?.disposition !== 'started')
      throw new Error(
        `Pi did not start the task (disposition: ${accepted?.disposition ?? 'missing'}).`,
      );
    const finish = await Promise.race([
      settledPromise.then((event) => ({ kind: 'settled', event })),
      stoppedPromise.then(() => ({ kind: 'stopped' })),
      rpc.closed.then((result) => ({ kind: 'closed', result })),
    ]);
    if (finish.kind === 'stopped') throw new Error(failure);
    if (finish.kind === 'closed')
      throw (
        finish.result.error ??
        new Error(`Pi exited without agent_settled (code ${finish.result.code}). ${rpc.stderr}`)
      );
    if (settled.aborted || lastAssistant?.stopReason === 'aborted') {
      stop('cancelled', 'Pi aborted the task. Partial file changes may remain.');
      throw new Error(failure);
    }
    if (lastAssistant?.stopReason !== 'stop' || !job.text.trim())
      throw new Error(
        lastAssistant?.errorMessage ||
          `Incomplete Pi output (stop reason: ${lastAssistant?.stopReason ?? 'missing'}).`,
      );
    verifyState(await rpc.request('get_state'), job, { model: job.model, thinking: job.thinking });
    job.usage = { scope: 'session', ...(await rpc.request('get_session_stats')) };
    signal.throwIfAborted();
    const exit = await rpc.close();
    if (exit.error || exit.code !== 0)
      throw (
        exit.error ??
        new Error(`Pi exited ${exit.code} (${exit.signal ?? 'no signal'}) after settlement.`)
      );
    job.exitCode = exit.code;
    job.status = 'completed';
  } catch (error) {
    failure ??= error.message;
    if (job) job.status = stopping ?? 'failed';
    else throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
    try {
      if (cancelPromise) await cancelPromise;
      else if (rpc) await rpc.close();
      await controlsPromise;
    } catch (error) {
      failure ??= `Process cleanup failed: ${error.message}`;
      if (job) job.status = 'failed';
    }
    if (job) {
      if (stopping) job.status = stopping;
      job.error = failure ?? null;
      job.completedAt = new Date().toISOString();
      // Pending controls are visible as undelivered, never silently reused by a later job.
      for (const name of fs.readdirSync(controlsDirectory)) {
        if (!/^\d{13}-[a-f0-9]{32}\.json$/.test(name)) continue;
        const control = JSON.parse(fs.readFileSync(path.join(controlsDirectory, name), 'utf8'));
        if (!job.controls.some((item) => item.id === control.id))
          job.controls.push({
            id: control.id,
            status: 'not_sent',
            error: 'Worker ended before accepting this message.',
          });
      }
      save();
    }
    if (stdoutFile !== undefined) fs.closeSync(stdoutFile);
    if (stderrFile !== undefined) fs.closeSync(stderrFile);
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    release();
  }
  return job;
}
