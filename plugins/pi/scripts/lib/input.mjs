export const BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];
export const REVIEW_TOOLS = ['read', 'grep', 'find', 'ls'];
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const RUN_COMMANDS = ['task', 'review', 'adversarial-review', 'transfer'];
export const COMMANDS = [...RUN_COMMANDS, 'status', 'result', 'cancel', 'steer', 'setup', 'models'];
const RUN_FIELDS = [
  'prompt',
  'model',
  'thinking',
  'resume',
  'timeoutSeconds',
  'base',
  'tools',
  'trustProject',
];

/** Validate the whole request before invoking a binary or writing state. */
export function validate(command, input) {
  if (!COMMANDS.includes(command)) throw new Error(`Unknown command: ${command}`);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Request must be a JSON object.');
  const run = RUN_COMMANDS.includes(command);
  const fields = ['cwd', ...(run ? RUN_FIELDS : command === 'steer' ? ['job', 'prompt'] : ['job'])];
  for (const [key, value] of Object.entries(input)) {
    if (!fields.includes(key)) throw new Error(`Unknown field: ${key}`);
    if (key === 'timeoutSeconds') {
      if (!Number.isInteger(value) || value < 1 || value > 86400)
        throw new Error('timeoutSeconds must be an integer from 1 to 86400.');
    } else if (key === 'trustProject') {
      if (typeof value !== 'boolean') throw new Error('trustProject must be a boolean.');
    } else if (key === 'tools') {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.some((t) => !BUILTIN_TOOLS.includes(t)) ||
        new Set(value).size !== value.length
      )
        throw new Error(
          `tools must be a nonempty array of unique built-in tools: ${BUILTIN_TOOLS.join(', ')}.`,
        );
    } else if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
      throw new Error(`${key} must be a nonempty string without NUL bytes.`);
    }
  }
  if (['task', 'transfer', 'steer'].includes(command) && !input.prompt)
    throw new Error('A prompt is required.');
  if (input.model && !/^[^/\s]+\/\S+$/.test(input.model))
    throw new Error('model must use exact provider/model format.');
  if (input.thinking && !THINKING_LEVELS.includes(input.thinking))
    throw new Error(`thinking must be one of: ${THINKING_LEVELS.join(', ')}.`);
  for (const key of ['job', 'resume']) {
    if (input[key] && !/^[a-f0-9]{32}$/.test(input[key]))
      throw new Error(`${key} must be a complete 32-character job ID.`);
  }
  const review = command.includes('review');
  if (review && (input.resume || input.tools || input.trustProject === true))
    throw new Error(
      'Reviews use fresh sessions and fixed read tools; resume, tools, and trusted project configuration are not supported.',
    );
  if (!review && input.base) throw new Error('base is only supported for reviews.');
  if (input.base?.startsWith('-')) throw new Error('base must not start with a dash.');
  if (['cancel', 'result', 'steer'].includes(command) && !input.job)
    throw new Error(`${command} requires an explicit job ID.`);
  if (['setup', 'models'].includes(command) && input.job)
    throw new Error(`${command} does not accept job.`);
  return {
    ...input,
    ...(run
      ? { timeoutSeconds: input.timeoutSeconds ?? 1800, trustProject: input.trustProject ?? false }
      : {}),
  };
}

export async function readInput(stream, limit = 262144) {
  let size = 0;
  const chunks = [];
  for await (const chunk of stream) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw new Error(`JSON request exceeds ${limit} bytes.`);
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.trim() ? JSON.parse(text) : {};
}
