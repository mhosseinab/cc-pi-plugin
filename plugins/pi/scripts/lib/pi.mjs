import { capture } from './process.mjs';
import { BUILTIN_TOOLS, REVIEW_TOOLS } from './input.mjs';

export const MIN_VERSION = '1.5.2';
export function binary() {
  return process.env.CC_PI_BIN || 'pi';
}

export function isSupportedVersion(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version,
    );
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major === 1 && (minor > 5 || (minor === 5 && patch >= 2));
}

export async function inspect(root, env = process.env, signal) {
  if (process.platform === 'win32')
    throw new Error('Use WSL2: native Windows process-group cancellation is not supported.');
  const version = (
    await capture(binary(), ['--version'], { cwd: root, env, signal })
  ).stdout.trim();
  if (!isSupportedVersion(version))
    throw new Error(
      `Supported Pi version: >=${MIN_VERSION} <2.0.0 (stable); found ${JSON.stringify(version)}. See RUNTIME.md.`,
    );
  return { version, supported: `>=${MIN_VERSION} <2.0.0`, protocol: 'rpc', binary: binary() };
}

export function runArgs(
  input,
  { sessionDirectory, sessionID, sessionFile, review = false, ephemeral = false } = {},
) {
  const args = [
    '--mode',
    'rpc',
    review || !input.trustProject ? '--no-approve' : '--approve',
    '--no-extensions',
    '--no-mcp',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--tools',
    (review ? REVIEW_TOOLS : (input.tools ?? BUILTIN_TOOLS)).join(','),
  ];
  // Override the project sessionDir lookup, which happens before its trust decision.
  if (sessionDirectory) args.push('--session-dir', sessionDirectory);
  if (ephemeral) args.push('--no-session');
  else if (sessionFile) args.push('--session', sessionFile);
  else if (sessionID) args.push('--session-id', sessionID);
  return args;
}

/** Model headers/config may contain secrets; expose only descriptive catalog fields. */
export function publicModel(model) {
  if (!model || typeof model !== 'object') return null;
  return Object.fromEntries(
    ['provider', 'id', 'name', 'reasoning', 'input', 'contextWindow', 'maxTokens']
      .filter((k) => model[k] !== undefined)
      .map((k) => [k, model[k]]),
  );
}

export function safeRecord(event) {
  if (event.type !== 'response' || !event.success) return event;
  if (event.command === 'set_model') return { ...event, data: publicModel(event.data) };
  if (event.command === 'get_available_models')
    return { ...event, data: { models: event.data?.models?.map(publicModel) } };
  if (event.command === 'get_state')
    return { ...event, data: { ...event.data, model: publicModel(event.data?.model) } };
  return event;
}
